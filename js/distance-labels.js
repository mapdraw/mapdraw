// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * Zoom-adaptive distance/area labels for a path or area, shown while drawing,
 * selected, or being edited. Each end gets a label - "0" at the start, the
 * total at the finish - combined into one when they land on (or near) the same
 * point, whether that's a closed ring's start/finish or an open path that just
 * happens to end near where it began; that combined label drops the "0" down to
 * just the total whenever there's no interval label nearby for it to distinguish
 * itself from. A ring also gets a separate label for its surface area at the
 * shape's center - generally the more sought-after figure for a polygon than its
 * perimeter, so if the two would overlap, the start/total label is the one dropped
 * instead (with the reverse priority everywhere else: intervals defer to endpoints).
 * Extra labels are placed at round distances (1/10/100 km or mi, scaling up by 10x
 * as needed for a longer path) along the way, with the step chosen from the current
 * zoom so on-screen spacing stays roughly constant.
 */

const DISTANCE_LABEL_MIN_PIXEL_GAP = 100;
// Below this on-screen length, a path/area is basically a speck at the current
// zoom - annotating it with floating labels looks disconnected from the shape
// they describe, so nothing shows at all until it's zoomed in past this.
const DISTANCE_LABEL_MIN_VISIBLE_PIXELS = 50;
// Nudges labels up off the point itself, so they don't sit directly on a vertex
// handle during draw/edit.
const DISTANCE_LABEL_VERTICAL_OFFSET_PX = 15;
// Every label - interval, single endpoint, the combined start+total, the area label -
// renders and gets overlap-tested as this same square, so there's exactly one box
// shape to reason about instead of one per label type/line-count.
const DISTANCE_LABEL_SIZE_PX = 60;
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

function distanceLabelIcon(html, verticalOffset = DISTANCE_LABEL_VERTICAL_OFFSET_PX) {
  return L.divIcon({
    className: "distance-label",
    html,
    iconSize: [DISTANCE_LABEL_SIZE_PX, DISTANCE_LABEL_SIZE_PX],
    iconAnchor: [DISTANCE_LABEL_SIZE_PX / 2, DISTANCE_LABEL_SIZE_PX / 2 + verticalOffset],
  });
}

// The on-screen square a label at latlng would occupy in container-pixel space - mirrors
// distanceLabelIcon()'s own anchor math exactly, so two labels can be tested for real box
// overlap instead of a fixed path-distance margin.
function distanceLabelScreenBounds(latlng, verticalOffset = DISTANCE_LABEL_VERTICAL_OFFSET_PX) {
  const anchor = L.point(DISTANCE_LABEL_SIZE_PX / 2, DISTANCE_LABEL_SIZE_PX / 2 + verticalOffset);
  const topLeft = map.latLngToContainerPoint(latlng).subtract(anchor);
  return L.bounds(topLeft, topLeft.add([DISTANCE_LABEL_SIZE_PX, DISTANCE_LABEL_SIZE_PX]));
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

function placeDistanceLabel(latlng, html, verticalOffset = DISTANCE_LABEL_VERTICAL_OFFSET_PX) {
  ensureDistanceLabelPane();
  const marker = L.marker(latlng, {
    icon: distanceLabelIcon(html, verticalOffset),
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

// Walks the path once, placing a label at every multiple of stepMeters crossed. Every
// segment is checked in O(1), but a segment outside the viewport skips the interpolation
// and label placement below - so that more expensive work stays bounded to what's
// actually on screen, even for a path far longer than what's visible.
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

// Drops an interval label whose actual box would overlap any of the given endpoint
// label boxes - only while it's really overlapping, not the whole step, so it doesn't
// stay hidden long after passing it.
function dropDistanceLabelsNearEndpoints(protectionBoundsList) {
  distanceLabelMarkers = distanceLabelMarkers.filter((marker) => {
    const labelBounds = distanceLabelScreenBounds(marker.getLatLng());
    const overlaps = protectionBoundsList.some((bounds) => labelBounds.intersects(bounds));
    if (overlaps) {
      map.removeLayer(marker);
      return false;
    }
    return true;
  });
}

// A ring's start and "end" are the exact same point, so it gets one combined label
// there instead of two - dropped entirely in favor of the area label if the two would
// overlap (areaOverlapsStart below). An open path's two ends usually land far apart and
// get one label each - but when their actual label boxes would overlap on screen (e.g. a
// loop walked with the path tool rather than closed into an area), it gets the same
// combined label instead, at their midpoint rather than one specific end - unlike a ring,
// neither end is more "the" point here, they just happen to land close together.
// openPathEndsCoincide/mergedAnchor/areaCenter/areaOverlapsStart/isSelfIntersecting are all
// decided once by refreshDistanceLabels() below, before its interval-label pass runs, and
// reused as-is here, so its interval-label protection boxes (dropDistanceLabelsNearEndpoints
// above) always match exactly what actually gets drawn below. noIntervalLabelsVisible is
// decided the opposite way around - from that pass's own outcome, after it's run - and only
// affects the combined label's text content (see combinedHtml below), not any box.
function placeDistanceLabelEndpoints(
  points,
  totalDistance,
  isClosedRing,
  openPathEndsCoincide,
  mergedAnchor,
  areaCenter,
  areaOverlapsStart,
  isSelfIntersecting,
  noIntervalLabelsVisible,
) {
  const start = points[0];
  const end = points[points.length - 1];
  // The "0" line only earns its place when an interval label is around for it to
  // distinguish this from - with none visible, the total alone is the only figure
  // worth showing.
  const combinedHtml = noIntervalLabelsVisible
    ? formatDistance(totalDistance)
    : `${formatDistance(totalDistance)}<br>${formatDistanceLabelInterval(0)}`;

  if (isClosedRing) {
    // Suppressed in favor of the area label below when the two would overlap - a
    // ring's area is generally the more sought-after figure than its perimeter.
    if (!areaOverlapsStart) placeDistanceLabel(start, combinedHtml);
    const areaText = isSelfIntersecting
      ? "Self-intersecting shape"
      : formatArea(calculatePolygonArea(distanceLabelSource));
    placeDistanceLabel(areaCenter, areaText);
  } else if (openPathEndsCoincide) {
    // No offset: unlike every other label here, there's no single vertex directly
    // below this anchor to nudge clear of - the midpoint has two real vertex handles
    // around it, at whatever relative position they happen to be in, so a fixed upward
    // nudge isn't guaranteed to clear both (it can even move toward one while moving
    // away from the other). Centered is the neutral choice that doesn't favor either.
    placeDistanceLabel(mergedAnchor, combinedHtml, 0);
  } else {
    placeDistanceLabel(start, formatDistanceLabelInterval(0));
    placeDistanceLabel(end, formatDistance(totalDistance));
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

  const startBounds = distanceLabelScreenBounds(points[0]);
  const endBounds = distanceLabelScreenBounds(points[points.length - 1]);
  const openPathEndsCoincide = !isClosedRing && startBounds.intersects(endBounds);
  // Only computed when actually needed below - an open path's own midpoint, where its
  // merged label (see placeDistanceLabelEndpoints below) actually gets drawn.
  const mergedAnchor = openPathEndsCoincide
    ? L.latLng(
        (points[0].lat + points[points.length - 1].lat) / 2,
        (points[0].lng + points[points.length - 1].lng) / 2,
      )
    : null;
  // Only a ring gets a separate area label (see placeDistanceLabelEndpoints below) - it's
  // generally the more sought-after figure for a polygon than its perimeter, so when the
  // two would overlap, the start/total label is the one suppressed instead - the
  // opposite priority from how an interval label defers to either of them.
  // A self-intersecting ring's lobes wind in opposite directions and partially cancel in
  // getCenter()'s signed-area centroid math, which can throw the result far outside the
  // shape entirely - the bounding-box center is a duller but stable fallback for that case.
  const isSelfIntersecting = isClosedRing && isSelfIntersectingRing(points);
  const areaCenter = isClosedRing
    ? isSelfIntersecting
      ? distanceLabelSource.getBounds().getCenter()
      : distanceLabelSource.getCenter()
    : null;
  const areaBounds = areaCenter ? distanceLabelScreenBounds(areaCenter) : null;
  const areaOverlapsStart = isClosedRing && areaBounds.intersects(startBounds);
  // The real box(es) placeDistanceLabelEndpoints() below will actually draw: a ring's
  // area box, plus its start box too unless the two overlap; an open path's two
  // individual boxes; or - once those two would already overlap each other - the single
  // combined box at their midpoint instead. Interval labels are dropped against these
  // directly, so the protection always matches what's actually on screen instead of a
  // box for a label that no longer gets drawn.
  const protectionBounds = isClosedRing
    ? areaOverlapsStart
      ? [areaBounds]
      : [startBounds, areaBounds]
    : openPathEndsCoincide
      ? [distanceLabelScreenBounds(mergedAnchor, 0)]
      : [startBounds, endBounds];

  const stepMeters = computeDistanceLabelStepMeters(metersPerPx);
  const bounds = map.getBounds().pad(0.25);
  walkDistanceLabels(points, cumulative, stepMeters, bounds);
  dropDistanceLabelsNearEndpoints(protectionBounds);
  // No interval label survived to be confused with - a ring's area label is never at
  // risk of that mix-up (it reads nothing like a distance), so its presence doesn't
  // factor in here.
  const noIntervalLabelsVisible = distanceLabelMarkers.length === 0;
  placeDistanceLabelEndpoints(
    points,
    totalDistance,
    isClosedRing,
    openPathEndsCoincide,
    mergedAnchor,
    areaCenter,
    areaOverlapsStart,
    isSelfIntersecting,
    noIntervalLabelsVisible,
  );
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
