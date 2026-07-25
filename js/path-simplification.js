// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Path & area simplification.
// Reduces the number of points in a path/area geometry using the simplify.js
// library (Douglas-Peucker). Used on demand for items in the Drawn Items layer.

/**
 * Simplification settings for paths and areas.
 * Tolerance is in decimal degrees (~0.00005° ≈ 5.5m at equator).
 */
const pathSimplificationConfig = {
  TOLERANCE: 0.00015,
  MIN_POINTS: 100,
};

// Degrees per slider-position unit; anchors tolerance at the slider's min/max only (see
// sliderValueToTolerance) - steps in between are non-linear.
const SLIDER_TOLERANCE_STEP = 0.00001;

/**
 * Simplifies a geometry's coordinates using the simplify.js library and provided configuration.
 * @param {Array} coordinates - Array of coordinates in [lng, lat] or [lng, lat, alt] format
 * @param {string} type - Geometry type ('LineString' or 'Polygon')
 * @param {object} config - Configuration object with TOLERANCE and MIN_POINTS properties
 * @param {string|null} [logLabel] - Prefix for the console.log below - override for a call that's
 *   only checking a hypothetical result (e.g. showSimplificationSlider's max-tolerance probe),
 *   so it doesn't read like a simplification was actually applied to the layer. Pass null to
 *   suppress the log entirely (e.g. setSimplificationTolerance's per-tick slider calls, where
 *   it would otherwise fire dozens of times per drag).
 * @returns {{simplified: boolean, coords: Array}} Object with simplification flag and resulting coordinates
 */
function simplifyPath(coordinates, type, config, logLabel = "Path simplified") {
  let overallSimplified = false;
  let newCoordinates;

  const simplifySinglePath = (pathCoords) => {
    if (pathCoords.length <= config.MIN_POINTS) {
      return { simplified: false, coords: pathCoords };
    }

    // Check if coordinates have altitude data (3D coordinates)
    const hasAltitude = pathCoords.some((c) => c.length === 3 && c[2] !== undefined);

    // Add index to each point so we can track which ones are kept after simplification
    const points = pathCoords.map((c, i) => ({ x: c[0], y: c[1], idx: i }));
    const simplifiedPoints = simplify(points, config.TOLERANCE, true);

    if (simplifiedPoints.length < pathCoords.length) {
      if (logLabel)
        console.log(`${logLabel}: ${pathCoords.length} -> ${simplifiedPoints.length} points`);

      // If original had altitude, restore it using the index
      if (hasAltitude) {
        const simplifiedWithAlt = simplifiedPoints.map((p) => {
          const originalCoord = pathCoords[p.idx];
          return originalCoord.length === 3 ? [p.x, p.y, originalCoord[2]] : [p.x, p.y];
        });
        return { simplified: true, coords: simplifiedWithAlt };
      }

      return { simplified: true, coords: simplifiedPoints.map((p) => [p.x, p.y]) };
    }

    return { simplified: false, coords: pathCoords };
  };

  if (type === "LineString" || type === "Polygon") {
    // LineString and Polygon are both single arrays of coordinates
    // Polygon is treated as a closed LineString for simplification purposes
    const result = simplifySinglePath(coordinates);
    if (type === "Polygon" && result.coords.length < 3) {
      // Douglas-Peucker treats the ring as an open line, so it can degenerate to just the
      // first/last point (2) - a "polygon" with fewer than 3 points has zero area and isn't
      // a valid shape. Fall back to a first/middle/last triangle instead of the full
      // unsimplified input, so a tiny/dense polygon still ends up reduced.
      newCoordinates = [
        coordinates[0],
        coordinates[Math.floor(coordinates.length / 2)],
        coordinates[coordinates.length - 1],
      ];
      overallSimplified = newCoordinates.length < coordinates.length;
    } else {
      overallSimplified = result.simplified;
      newCoordinates = result.coords;
    }
  } else {
    return { simplified: false, coords: coordinates };
  }

  return { simplified: overallSimplified, coords: newCoordinates };
}

/**
 * Extracts a layer's current ring/points as plain [lng, lat(, alt)] coordinate arrays,
 * the format simplifyPath() expects.
 * @param {L.Polygon|L.Polyline} layer
 * @returns {Array} Coordinates array
 */
function _getEditingLayerCoords(layer) {
  const ring = layer instanceof L.Polygon ? layer.getLatLngs()[0] : layer.getLatLngs();
  return ring.map((latlng) =>
    latlng.alt !== undefined ? [latlng.lng, latlng.lat, latlng.alt] : [latlng.lng, latlng.lat],
  );
}

/**
 * Applies simplified coordinates to a layer that's currently in leaflet-draw Edit mode and
 * rebuilds its vertex handles to match. Must only be called once the layer's own editing
 * handler is active (layer.editing.enable() has already run) - callers driven by EDITSTART
 * need to defer past leaflet-draw's own synchronous backup/enable sequence first, see
 * draw-tools.js.
 * @param {L.Polygon|L.Polyline} layer - The layer currently being edited
 * @param {Array} coords - New coordinates in [lng, lat(, alt)] format
 */
function _applyCoordsToEditingLayer(layer, coords) {
  const isPolygon = layer instanceof L.Polygon;
  // leaflet-draw's vertex handles hold a direct reference to this exact array, captured
  // once when editing.enable() first ran and never resynced except on Cancel - mutate it
  // in place (mirroring leaflet-draw's own _spliceLatLngs) rather than calling
  // layer.setLatLngs(), which would replace the array and desync the handles from the
  // layer's actual geometry, both this session and every future edit session on it.
  const ring = isPolygon ? layer.getLatLngs()[0] : layer.getLatLngs();
  // Single source of truth for "was this layer actually reduced this session" - covers both
  // the auto pass and every manual slider tick, since both apply coords through here.
  if (coords.length < ring.length) layer._wasSimplified = true;
  ring.length = 0;
  for (const c of coords) {
    ring.push(c.length === 3 ? L.latLng(c[1], c[0], c[2]) : L.latLng(c[1], c[0]));
  }
  layer._bounds = L.latLngBounds(ring);
  layer.redraw();
  layer.editing.updateMarkers();
  // leaflet-draw's own Save handler only includes layers with this flag (normally set by
  // its vertex-drag handlers) in the draw:edited event - without it, a save with no manual
  // vertex edits would skip draw-tools.js's draw:edited handler and leave totalDistance stale.
  layer.edited = true;
  // Unlike a manual vertex drag, this geometry change doesn't fire the drag events distance
  // labels normally stay live from, so they need an explicit refresh to match the new points.
  if (layer instanceof L.Polyline) showDistanceLabelsFor(layer);
}

/**
 * Simplifies a layer that's currently in leaflet-draw Edit mode. Must only be called once
 * the layer's own editing handler is active (layer.editing.enable() has already run) -
 * callers driven by EDITSTART need to defer past leaflet-draw's own synchronous
 * backup/enable sequence first, see draw-tools.js.
 * @param {L.Polygon|L.Polyline} layer - The layer currently being edited
 * @param {object} [config] - Simplification config; defaults to pathSimplificationConfig
 * @returns {boolean} Whether the geometry was actually simplified
 */
function applySimplificationToEditingLayer(layer, config = pathSimplificationConfig) {
  // Runs exactly once per EDITSTART (see draw-tools.js), before any manual slider tick can
  // reach _applyCoordsToEditingLayer - the right point to clear last session's flag.
  layer._wasSimplified = false;
  const coords = _getEditingLayerCoords(layer);
  // Refreshed unconditionally at the start of every edit session (this runs exactly once
  // per EDITSTART, before any other simplification call) so a later tolerance adjustment
  // can always re-derive from full detail, regardless of what this or a previous session
  // already simplified away.
  layer._simplifyBaseline = coords;

  const result = simplifyPath(
    coords,
    layer instanceof L.Polygon ? "Polygon" : "LineString",
    config,
  );
  if (!result.simplified) return false;

  _applyCoordsToEditingLayer(layer, result.coords);
  return true;
}

/**
 * Re-simplifies a layer already in Edit mode at an arbitrary tolerance, always re-deriving
 * from its pristine baseline (see applySimplificationToEditingLayer) so repeated adjustments
 * - in either direction - never compound on top of an already-reduced point set. A no-op if
 * no baseline was captured yet (layer isn't actually being edited).
 * @param {L.Polygon|L.Polyline} layer - The layer currently being edited
 * @param {number} tolerance - Simplify.js tolerance in decimal degrees
 */
function setSimplificationTolerance(layer, tolerance) {
  const baseline = layer._simplifyBaseline;
  if (!baseline) return;

  const result = simplifyPath(
    baseline,
    layer instanceof L.Polygon ? "Polygon" : "LineString",
    {
      TOLERANCE: tolerance,
      MIN_POINTS: 0, // a manual adjustment should apply regardless of the auto-simplify threshold
    },
    null, // fires on every slider tick - would otherwise spam the console during a single drag
  );
  _applyCoordsToEditingLayer(layer, result.coords);
}

// Tracks the EDITVERTEX listener registered by showSimplificationSlider(), so
// hideSimplificationSlider() can remove it - see the lock comment below for why one exists.
let _simplifySliderLockHandler = null;

// Tracks the moveend/zoomend listener that keeps the "zoom in to see edit points" hint current
// - see showSimplificationSlider() below for why one exists.
let _simplifyZoomHintHandler = null;

/**
 * Shows a range input in the info panel's details area while a complex item is being
 * edited, live-updating vertex handles as it's dragged (see .simplify-panel* in style.css
 * for its styling). Content is rebuilt fresh into #info-panel-details each session rather
 * than toggling pre-existing markup - the existing no-selection-removal mechanism already
 * makes the panel visible on both desktop and mobile, and nothing else can write into it
 * while an edit session is active (selection is blocked), so there was no need to build a
 * persistent state around the content. The "simplify-active" class marks the panel as being
 * in this mode explicitly, independent of "no-selection".
 *
 * The slider's minimum is clamped to whatever applySimplificationToEditingLayer() already
 * applied, never lower - the whole reason for auto-simplifying on entry is to cap how many
 * vertex handles get rendered, so letting the slider go back toward the full original while
 * they're all still live on screen would undo that protection entirely.
 *
 * Also detaches every ring's vertex/mid-segment handles and skips rebuilding them entirely
 * while the slider is being dragged (harmless for an ordinary layer, and skips real work for
 * one under leaflet-draw-patches.js's level-of-detail system), rebuilding once for real on
 * release; and shows a "zoom in to see edit points" hint specifically for a layer with at
 * least one ring dense enough for that system to be active (isEditLodActive).
 * @param {L.Polygon|L.Polyline} layer - The layer currently being edited
 * @param {boolean} wasAutoSimplified - Return value of the applySimplificationToEditingLayer()
 *   call that just ran for this session
 */
function showSimplificationSlider(layer, wasAutoSimplified) {
  const infoPanel = document.getElementById("info-panel");
  const details = document.getElementById("info-panel-details");
  if (!infoPanel || !details) return;

  const isPolygon = layer instanceof L.Polygon;
  const countPoints = () => (isPolygon ? layer.getLatLngs()[0].length : layer.getLatLngs().length);
  const minValue = wasAutoSimplified
    ? Math.round(pathSimplificationConfig.TOLERANCE / SLIDER_TOLERANCE_STEP)
    : 0;
  const maxValue = 1000;

  // Line 1 always says something - it's the only indication, when nothing was auto-simplified,
  // that this slider has anything to do with simplification at all.
  const introText = wasAutoSimplified
    ? `Auto-simplified from ${layer._simplifyBaseline.length} to ${countPoints()} points`
    : "Simplify points";

  infoPanel.classList.remove("no-selection");
  infoPanel.classList.add("simplify-active");
  // #info-panel-details is a row flexbox (for its normal single-line content); .simplify-panel
  // switches it to a column so this stacks instead of cramming side by side.
  details.innerHTML = `
    <div class="simplify-panel">
      <div id="simplify-zoom-hint" class="simplify-zoom-hint"></div>
      <div>${introText}</div>
      <div class="simplify-panel-row">
        <span id="simplify-slider-current" class="simplify-panel-count"></span>
        <input id="simplify-slider" type="range" class="simplify-panel-slider" min="${minValue}" max="${maxValue}" value="${minValue}" />
      </div>
      <div id="simplify-slider-lock-message" class="simplify-panel-lock-message"></div>
    </div>
  `;

  const currentSpan = document.getElementById("simplify-slider-current");
  const slider = document.getElementById("simplify-slider");
  const lockMessage = document.getElementById("simplify-slider-lock-message");
  const zoomHint = document.getElementById("simplify-zoom-hint");

  const updateCurrent = () => {
    currentSpan.textContent = countPoints();
  };
  updateCurrent();

  // Point count drops fast at low tolerance and flattens at high tolerance, so map slider
  // position to tolerance exponentially instead of linearly.
  // minValue is 0 when nothing was auto-simplified - floor to 1 step, since 0 as the curve's
  // base makes the formula below divide by zero.
  const minTolerance = (minValue > 0 ? minValue : 1) * SLIDER_TOLERANCE_STEP;
  const maxTolerance = maxValue * SLIDER_TOLERANCE_STEP;
  const sliderValueToTolerance = (value) => {
    if (value <= minValue) return minValue * SLIDER_TOLERANCE_STEP; // exact 0 when minValue is 0
    const t = (value - minValue) / (maxValue - minValue);
    return minTolerance * Math.pow(maxTolerance / minTolerance, t);
  };

  // If even the max tolerance wouldn't remove any more points than are already showing, the
  // whole slider is a no-op - lock it immediately instead of leaving it draggable with
  // nothing to show for it (matches the manual-edit lock below).
  const maxTolerantCount = simplifyPath(
    layer._simplifyBaseline,
    isPolygon ? "Polygon" : "LineString",
    { TOLERANCE: maxTolerance, MIN_POINTS: 0 },
    "Max-simplification probe (not applied)",
  ).coords.length;

  if (maxTolerantCount === countPoints()) {
    slider.disabled = true;
    lockMessage.textContent = "Already fully simplified";
  } else {
    const updateMaxMessage = () => {
      lockMessage.textContent =
        Number(slider.value) >= maxValue ? "Already at maximum simplification" : "";
    };
    updateMaxMessage();

    slider.addEventListener("input", (e) => {
      setSimplificationTolerance(layer, sliderValueToTolerance(Number(e.target.value)));
      updateCurrent();
      updateMaxMessage();
    });

    // Vertex/mid-segment handles (leaflet-draw-patches.js's LOD system) are pure visual noise
    // while dragging this slider, but rebuilding them every tick still isn't free - a fresh
    // marker object gets constructed for every point on every "input" event regardless of how
    // many end up visible. Detaching each ring's marker group for the drag's duration skips
    // the DOM/icon cost (the LOD _initMarkers patch sees the group already detached and leaves
    // it that way); reattaching once on release shows the final, filtered result in one shot
    // instead of on every intermediate tick.
    // Deliberately NOT gated by isEditLodActive - that reflects the *current* point
    // count, which can cross the LOD threshold in either direction mid-drag (e.g. dragged past
    // it, then eased back under it before releasing). Detach/reattach must stay unconditional
    // and symmetric regardless of where the ring ends up, or a release that lands below the
    // threshold skips reattaching entirely and leaves the group permanently hidden.
    const setHandleGroupsAttached = (attached) => {
      for (const handler of layer.editing._verticesHandlers) {
        const isAttached = map.hasLayer(handler._markerGroup);
        if (attached && !isAttached) map.addLayer(handler._markerGroup);
        else if (!attached && isAttached) map.removeLayer(handler._markerGroup);
      }
    };
    slider.addEventListener("pointerdown", () => {
      setHandleGroupsAttached(false);
      // Detaching the group only skips the DOM/icon cost - _applyCoordsToEditingLayer()
      // still calls layer.editing.updateMarkers() on every tick, which still reconstructs a
      // fresh marker *object* for every point still remaining, even with nowhere to attach
      // them. That's real cost while a lot of points are still left (e.g. early in a drag
      // toward more aggressive simplification, before the count has dropped much yet).
      // Shadowing this instance's updateMarkers with a no-op skips that reconstruction
      // entirely; deleting the shadow on release restores leaflet-draw's real one.
      layer.editing.updateMarkers = () => {};
    });
    // Not "change": a range input only fires that when the committed value differs from where
    // it was when the interaction started - dragging away and back to the exact same value
    // (e.g. all the way right then back to minValue) nets to "no change" and never fires it at
    // all, leaving the group detached permanently. pointerup fires on every release regardless.
    // pointercancel (second finger joining as a pinch, OS-interrupted touch) must run the same
    // restore - the browser fires one or the other, never both, so this can't double-run.
    const restoreHandleGroups = () => {
      delete layer.editing.updateMarkers;
      layer.editing.updateMarkers(); // one real rebuild, into the still-detached group
      setHandleGroupsAttached(true);
    };
    slider.addEventListener("pointerup", restoreHandleGroups);
    slider.addEventListener("pointercancel", restoreHandleGroups);
  }

  // Below EDIT_HANDLE_MIN_ZOOM, LOD-active rings (leaflet-draw-patches.js) show no handles at
  // all - without this, that just looks like the feature is broken rather than a "zoom in"
  // affordance. Only shown for layers actually under LOD; an ordinary small path's handles are
  // always visible regardless of zoom, so it'd never need this hint.
  if (layer.editing._verticesHandlers.some(isEditLodActive)) {
    const updateZoomHint = () => {
      zoomHint.textContent =
        map.getZoom() < EDIT_HANDLE_MIN_ZOOM ? "Zoom in to see edit points" : "";
    };
    updateZoomHint();
    _simplifyZoomHintHandler = updateZoomHint;
    map.on("moveend zoomend", _simplifyZoomHintHandler);
  }

  // setSimplificationTolerance() always re-derives from the pristine baseline, so a slider
  // move after a manual vertex edit (drag, mid-point add, or delete - EDITVERTEX covers all
  // three) would silently overwrite it. Lock instead of allowing that; keeps re-firing
  // harmlessly (just re-asserts the same locked state) so further manual edits still update
  // the live "current" count without ever re-enabling the slider.
  _simplifySliderLockHandler = () => {
    slider.disabled = true;
    lockMessage.textContent = "Locked after a manual point edit"; // shown via the :empty CSS rule
    updateCurrent();
  };
  map.on(L.Draw.Event.EDITVERTEX, _simplifySliderLockHandler);
}

/**
 * Tears down the slider from showSimplificationSlider().
 * @param {L.Polygon|L.Polyline} layer - The layer that was being edited
 */
function hideSimplificationSlider(layer) {
  if (_simplifySliderLockHandler) {
    map.off(L.Draw.Event.EDITVERTEX, _simplifySliderLockHandler);
    _simplifySliderLockHandler = null;
  }
  if (_simplifyZoomHintHandler) {
    map.off("moveend zoomend", _simplifyZoomHintHandler);
    _simplifyZoomHintHandler = null;
  }
  // Backstop for the pointerdown shadow in showSimplificationSlider(): Escape can end the
  // session without pointerup/pointercancel ever firing to clean it up.
  delete layer.editing.updateMarkers;
  // Only needed while the slider can re-derive from it - once the session ends there's no
  // more use for it until the next edit re-populates it, so don't hold onto the full-res
  // array for the rest of the layer's lifetime.
  delete layer._simplifyBaseline;
  // resetInfoPanel() doesn't know about this class - it would otherwise leak onto every
  // future selection until the app is reloaded.
  document.getElementById("info-panel")?.classList.remove("simplify-active");
  resetInfoPanel();
}
