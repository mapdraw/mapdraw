// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * Zoom-adaptive distance/area labels for a path or area, shown while drawing,
 * selected, or being edited. Each end gets a label - "0" at the start, the
 * total at the finish - combined into one when they land on (or near) the same
 * point, whether that's a closed ring's start/finish or an open path that just
 * happens to end near where it began; a ring also gets a separate label for its
 * surface area at the shape's center. Extra labels are placed at round distances
 * (1/10/100/1,000/10,000 km or mi) along the way, with the step chosen from the
 * current zoom so on-screen spacing stays roughly constant.
 */

const DISTANCE_LABEL_MIN_PIXEL_GAP = 100;
// Below this on-screen length, a path/area is basically a speck at the current
// zoom - annotating it with floating labels looks disconnected from the shape
// they describe, so nothing shows at all until it's zoomed in past this.
const DISTANCE_LABEL_MIN_VISIBLE_PIXELS = 50;
// Nudges labels up off the point itself, so they don't sit directly on a vertex
// handle during draw/edit.
const DISTANCE_LABEL_VERTICAL_OFFSET_PX = 15;
// A label's default height is one line; the combined ring label below is two.
const DISTANCE_LABEL_LINE_HEIGHT_PX = 20;
// Actual rendered width of a label's box (its CSS is nowrap/no-reflow, so this is fixed
// regardless of text length).
const DISTANCE_LABEL_WIDTH_PX = 60;
// Width used for the overlap test only (distanceLabelScreenBounds() below), wider than
// the box actually rendered - a cheap safety margin for text that runs past it (e.g. a
// long round-trip distance) without measuring real rendered text width.
const DISTANCE_LABEL_OVERLAP_WIDTH_PX = 80;
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;

let distanceLabelMarkers = [];
let distanceLabelSource = null; // an L.Polyline/L.Polygon, or a plain array of L.LatLng (in-progress draw)
let distanceLabelMoveEndHandler = null;
let distanceLabelVisibilityHandler = null;
let distanceLabelEditDragHandler = null;
let distanceLabelEditVertexHandler = null;
// Read directly by settings-panel.js for its toggle's initial checked state - not just
// "false" so any pre-existing value (or none, for users who've never touched it) defaults on.
let distanceLabelsEnabled = localStorage.getItem("distanceLabelsEnabled") !== "false";

// Interval labels are always exact round units, so unlike formatDistance() they
// don't need decimal precision.
function formatDistanceLabelInterval(meters) {
  const unitMeters = useImperialUnits ? METERS_PER_MILE : METERS_PER_KM;
  const unitLabel = useImperialUnits ? "mi" : "km";
  return `${Math.round(meters / unitMeters)} ${unitLabel}`;
}

function distanceLabelIcon(html, heightPx, verticalOffset = DISTANCE_LABEL_VERTICAL_OFFSET_PX) {
  return L.divIcon({
    className: "distance-label",
    html,
    iconSize: [DISTANCE_LABEL_WIDTH_PX, heightPx],
    // Bottom line's own center, not the box's - keeps it on the point even
    // when extra lines are stacked above (e.g. the combined start+total label).
    iconAnchor: [
      DISTANCE_LABEL_WIDTH_PX / 2,
      heightPx - DISTANCE_LABEL_LINE_HEIGHT_PX / 2 + verticalOffset,
    ],
  });
}

// The on-screen rectangle a label of the given height/offset would occupy at latlng,
// in container-pixel space - mirrors distanceLabelIcon()'s own anchor math (widened
// per DISTANCE_LABEL_OVERLAP_WIDTH_PX above), so two labels can be tested for real box
// overlap instead of a fixed path-distance margin.
function distanceLabelScreenBounds(latlng, heightPx, verticalOffset) {
  const anchor = L.point(
    DISTANCE_LABEL_OVERLAP_WIDTH_PX / 2,
    heightPx - DISTANCE_LABEL_LINE_HEIGHT_PX / 2 + verticalOffset,
  );
  const topLeft = map.latLngToContainerPoint(latlng).subtract(anchor);
  return L.bounds(topLeft, topLeft.add([DISTANCE_LABEL_OVERLAP_WIDTH_PX, heightPx]));
}

// A dedicated pane above the selected-path outline (which can reach z-index 601,
// see map-interactions.js), so labels always render on top. 651 rather than
// Leaflet's own 650, to avoid tying with its built-in tooltipPane.
function ensureDistanceLabelPane() {
  if (!map.getPane("distanceLabelPane")) {
    map.createPane("distanceLabelPane");
    map.getPane("distanceLabelPane").style.zIndex = 651;
  }
}

function placeDistanceLabel(
  latlng,
  html,
  heightPx = DISTANCE_LABEL_LINE_HEIGHT_PX,
  verticalOffset = DISTANCE_LABEL_VERTICAL_OFFSET_PX,
) {
  ensureDistanceLabelPane();
  const marker = L.marker(latlng, {
    icon: distanceLabelIcon(html, heightPx, verticalOffset),
    interactive: false,
    pane: "distanceLabelPane",
  }).addTo(map);
  distanceLabelMarkers.push(marker);
}

function clearDistanceLabelMarkers() {
  distanceLabelMarkers.forEach((marker) => map.removeLayer(marker));
  distanceLabelMarkers = [];
}

// Unlike calculatePathDistance() in utils.js, this doesn't close a polygon's ring
// back to its first vertex - getDistanceLabelClosingSegment() below adds that
// length to the total separately, without walking it for interval labels.
function getDistanceLabelSourcePoints(source) {
  return Array.isArray(source) ? source : flattenRingPoints(source.getLatLngs());
}

/** Length of a polygon's closing edge (last vertex back to first) - 0 for anything else. */
function getDistanceLabelClosingSegment(source, points) {
  if (Array.isArray(source) || !(source instanceof L.Polygon) || points.length < 2) return 0;
  return points[points.length - 1].distanceTo(points[0]);
}

function buildCumulativeDistances(points) {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + points[i - 1].distanceTo(points[i]));
  }
  return cumulative;
}

// Standard Web Mercator meters-per-pixel at zoom 0, i.e. earth's equatorial
// circumference / 256px tiles (2 * PI * 6378137 / 256).
const EQUATOR_METERS_PER_PIXEL_AT_ZOOM_0 = 156543.03392;

// Zoom-only (not the map's actual latitude) so this only changes on an actual zoom
// change - a latitude-based version would drift while merely panning and could
// flip the step ladder below near its threshold with no zoom change to explain it.
function metersPerPixel() {
  return EQUATOR_METERS_PER_PIXEL_AT_ZOOM_0 / 2 ** map.getZoom();
}

// A power of ten times 1 km/mi, keeping labels at least DISTANCE_LABEL_MIN_PIXEL_GAP
// px apart. Never below 1 unit, so a shorter path just gets no interval labels.
function computeDistanceLabelStepMeters(metersPerPx) {
  const unitMeters = useImperialUnits ? METERS_PER_MILE : METERS_PER_KM;
  const minStepMeters = metersPerPx * DISTANCE_LABEL_MIN_PIXEL_GAP;
  const stepInUnits = Math.max(1, 10 ** Math.ceil(Math.log10(minStepMeters / unitMeters)));
  return stepInUnits * unitMeters;
}

// Checks the segment's endpoints, then its 4 crossings with bounds' edges (via
// utils.js's segmentsIntersect) - catches a segment passing through the viewport
// with both endpoints outside it, not just endpoints alone.
function segmentCrossesBounds(prev, next, bounds) {
  if (bounds.contains(prev) || bounds.contains(next)) return true;
  const corners = [
    bounds.getNorthWest(),
    bounds.getNorthEast(),
    bounds.getSouthEast(),
    bounds.getSouthWest(),
  ];
  return corners.some((corner, i) =>
    segmentsIntersect(prev, next, corner, corners[(i + 1) % corners.length]),
  );
}

// Walks the path once, placing a label at every multiple of stepMeters crossed.
// Segments outside the viewport are skipped in O(1) so cost stays bounded to the
// visible portion, even for a path far longer than what's on screen.
function walkDistanceLabels(points, cumulative, stepMeters, bounds) {
  let nextMultiple = stepMeters;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const next = points[i];
    const segStartAbs = cumulative[i - 1];
    const segEndAbs = cumulative[i];
    if (nextMultiple > segEndAbs) continue;

    if (!segmentCrossesBounds(prev, next, bounds)) {
      nextMultiple = Math.max(nextMultiple, Math.ceil(segEndAbs / stepMeters) * stepMeters);
      continue;
    }

    const segLength = segEndAbs - segStartAbs;
    while (nextMultiple <= segEndAbs) {
      // Always true under exact arithmetic - the continue and bounds-skip branches
      // above both guarantee nextMultiple is already >= this segment's start. Kept
      // as a guard against float drift between two independently-computed values.
      if (nextMultiple >= segStartAbs) {
        const fraction = segLength === 0 ? 0 : (nextMultiple - segStartAbs) / segLength;
        const latlng = L.latLng(
          prev.lat + (next.lat - prev.lat) * fraction,
          prev.lng + (next.lng - prev.lng) * fraction,
        );
        placeDistanceLabel(latlng, formatDistanceLabelInterval(nextMultiple));
      }
      nextMultiple += stepMeters;
    }
  }
}

// Drops an interval label whose actual box would overlap a start/total marker's -
// only while it's really overlapping, not the whole step, so it doesn't stay hidden
// long after passing it. A ring's combined marker only needs the start side protected.
function dropDistanceLabelsNearEndpoints(startBounds, endBounds, isClosedRing) {
  distanceLabelMarkers = distanceLabelMarkers.filter((marker) => {
    const labelBounds = distanceLabelScreenBounds(
      marker.getLatLng(),
      DISTANCE_LABEL_LINE_HEIGHT_PX,
      DISTANCE_LABEL_VERTICAL_OFFSET_PX,
    );
    const overlapsStart = labelBounds.intersects(startBounds);
    const overlapsEnd = !isClosedRing && labelBounds.intersects(endBounds);
    if (overlapsStart || overlapsEnd) {
      map.removeLayer(marker);
      return false;
    }
    return true;
  });
}

// A ring's start and "end" are the exact same point, so it always gets one combined
// two-line label there instead of two, plus a surface-area label at its center. An
// open path's two ends usually land far apart and get one label each - but when their
// actual label boxes would overlap on screen (e.g. a loop walked with the path tool
// rather than closed into an area), it gets the same combined label instead, at their
// midpoint rather than one specific end - unlike a ring, neither end is more "the"
// point here, they just happen to land close together.
function placeDistanceLabelEndpoints(points, totalDistance, isClosedRing, startBounds, endBounds) {
  const start = points[0];
  const end = points[points.length - 1];
  const openPathEndsCoincide = !isClosedRing && startBounds.intersects(endBounds);

  if (isClosedRing || openPathEndsCoincide) {
    const html = `${formatDistance(totalDistance)}<br>${formatDistanceLabelInterval(0)}`;
    // A ring's anchor is a real vertex, nudged up like any other label so it clears
    // its own vertex handle. An open path's midpoint is empty space with no handle
    // to clear, so it sits centered on it with no offset instead.
    const anchor = isClosedRing
      ? start
      : L.latLng((start.lat + end.lat) / 2, (start.lng + end.lng) / 2);
    const verticalOffset = isClosedRing ? DISTANCE_LABEL_VERTICAL_OFFSET_PX : 0;
    placeDistanceLabel(anchor, html, DISTANCE_LABEL_LINE_HEIGHT_PX * 2, verticalOffset);
  } else {
    placeDistanceLabel(start, formatDistanceLabelInterval(0));
    placeDistanceLabel(end, formatDistance(totalDistance));
  }

  if (isClosedRing) {
    const areaText = isSelfIntersectingRing(points)
      ? "Self-intersecting shape"
      : formatArea(calculatePolygonArea(distanceLabelSource));
    placeDistanceLabel(distanceLabelSource.getBounds().getCenter(), areaText);
  }
}

/**
 * Recomputes and redraws every currently-shown distance label from scratch,
 * using whatever showDistanceLabelsFor() is currently tracking. Safe to call
 * on its own (view change, edit, unit/setting toggle) without re-establishing
 * the moveend/edit listeners set up by showDistanceLabelsFor().
 */
function refreshDistanceLabels() {
  clearDistanceLabelMarkers();
  if (!distanceLabelsEnabled || !distanceLabelSource) return;
  // A real layer may have been hidden since last shown - caught immediately by the
  // layerremove listener below, but also guarded here for e.g. the next moveend.
  if (!Array.isArray(distanceLabelSource) && !map.hasLayer(distanceLabelSource)) return;

  const points = getDistanceLabelSourcePoints(distanceLabelSource);
  if (points.length < 2) return;

  const cumulative = buildCumulativeDistances(points);
  const closingSegment = getDistanceLabelClosingSegment(distanceLabelSource, points);
  const totalDistance = cumulative[cumulative.length - 1] + closingSegment;
  const isClosedRing = closingSegment > 0;
  const metersPerPx = metersPerPixel();

  // Too small on screen to be worth labeling at all, regardless of real-world length.
  if (totalDistance / metersPerPx < DISTANCE_LABEL_MIN_VISIBLE_PIXELS) return;

  // A ring's start always ends up as the taller 2-line combined label (see
  // placeDistanceLabelEndpoints below) - known upfront, unlike an open path's
  // possible merge, so its protection box can match the real box exactly.
  const startBounds = distanceLabelScreenBounds(
    points[0],
    isClosedRing ? DISTANCE_LABEL_LINE_HEIGHT_PX * 2 : DISTANCE_LABEL_LINE_HEIGHT_PX,
    DISTANCE_LABEL_VERTICAL_OFFSET_PX,
  );
  const endBounds = distanceLabelScreenBounds(
    points[points.length - 1],
    DISTANCE_LABEL_LINE_HEIGHT_PX,
    DISTANCE_LABEL_VERTICAL_OFFSET_PX,
  );
  const stepMeters = computeDistanceLabelStepMeters(metersPerPx);
  const bounds = map.getBounds().pad(0.25);
  walkDistanceLabels(points, cumulative, stepMeters, bounds);
  dropDistanceLabelsNearEndpoints(startBounds, endBounds, isClosedRing);
  placeDistanceLabelEndpoints(points, totalDistance, isClosedRing, startBounds, endBounds);
}

/**
 * Starts tracking `source` (an L.Polyline/L.Polygon, or a plain array of
 * L.LatLng for an in-progress draw) for distance labels, replacing whatever
 * was tracked before, and recomputing on every pan/zoom/vertex-edit/visibility
 * change. Tracking itself ignores distanceLabelsEnabled - refreshDistanceLabels()
 * is the actual rendering gate, so re-enabling the setting shows this instantly.
 * @param {L.Polyline|L.Polygon|L.LatLng[]} source
 */
function showDistanceLabelsFor(source) {
  hideDistanceLabels();
  distanceLabelSource = source;
  distanceLabelMoveEndHandler = refreshDistanceLabels;
  map.on("moveend", distanceLabelMoveEndHandler);

  // Reacts immediately to a real layer's own visibility toggling (its eye icon or
  // its category's checkbox - both fire these events, even cascaded from a group),
  // and, while under active Edit, to its vertices changing (editdrag per drag frame,
  // draw:editvertex per add/remove/drop). Safe to arm unconditionally - leaflet-draw
  // only ever fires either for the one layer actually being edited.
  if (!Array.isArray(source)) {
    distanceLabelVisibilityHandler = (e) => {
      if (e.layer === distanceLabelSource) refreshDistanceLabels();
    };
    map.on("layeradd layerremove", distanceLabelVisibilityHandler);

    distanceLabelEditDragHandler = refreshDistanceLabels;
    source.on("editdrag", distanceLabelEditDragHandler);

    distanceLabelEditVertexHandler = (e) => {
      if (e.poly === distanceLabelSource) refreshDistanceLabels();
    };
    map.on(L.Draw.Event.EDITVERTEX, distanceLabelEditVertexHandler);
  }

  refreshDistanceLabels();
}

// Used by draw-tools.js's DRAWSTOP so it doesn't wipe out labels that draw:created's
// selectItem() already handed off to the finished layer moments earlier.
function isDistanceLabelSourceInProgress() {
  return Array.isArray(distanceLabelSource);
}

/** Stops showing distance labels and cleans up all listeners/markers. Safe to call when nothing is showing. */
function hideDistanceLabels() {
  clearDistanceLabelMarkers();
  if (distanceLabelMoveEndHandler) {
    map.off("moveend", distanceLabelMoveEndHandler);
    distanceLabelMoveEndHandler = null;
  }
  if (distanceLabelVisibilityHandler) {
    map.off("layeradd layerremove", distanceLabelVisibilityHandler);
    distanceLabelVisibilityHandler = null;
  }
  if (distanceLabelEditDragHandler) {
    distanceLabelSource.off("editdrag", distanceLabelEditDragHandler);
    distanceLabelEditDragHandler = null;
  }
  if (distanceLabelEditVertexHandler) {
    map.off(L.Draw.Event.EDITVERTEX, distanceLabelEditVertexHandler);
    distanceLabelEditVertexHandler = null;
  }
  distanceLabelSource = null;
}

/**
 * Called by settings-panel.js's toggle. Applies immediately to whatever's
 * currently tracked - selected, being drawn, or being edited.
 */
function setDistanceLabelsEnabled(enabled) {
  distanceLabelsEnabled = enabled;
  localStorage.setItem("distanceLabelsEnabled", enabled);
  refreshDistanceLabels();
}
