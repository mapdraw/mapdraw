// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Path & area simplification.
// Reduces the number of points in a path/area geometry using the simplify.js
// library (Douglas-Peucker). Used on demand for items in the Drawn Items layer.

// Degrees per slider-position unit; anchors tolerance at the slider's min/max only (see
// sliderValueToTolerance) - steps in between are non-linear.
const SLIDER_TOLERANCE_STEP = 0.00001;

/**
 * Simplifies a geometry's coordinates using the simplify.js library at the given tolerance.
 * @param {Array} coordinates - Array of coordinates in [lng, lat] or [lng, lat, alt] format
 * @param {string} type - Geometry type ('LineString' or 'Polygon')
 * @param {number} tolerance - Simplify.js tolerance in decimal degrees
 * @param {string|null} logLabel - Prefix for the console.log below - override for a call that's
 *   only checking a hypothetical result (e.g. showSimplificationSlider's max-tolerance probe),
 *   so it doesn't read like a simplification was actually applied to the layer. Pass null to
 *   suppress the log entirely (e.g. setSimplificationTolerance's per-tick slider calls, where
 *   it would otherwise fire dozens of times per drag).
 * @returns {Array} Resulting coordinates
 */
function simplifyPath(coordinates, type, tolerance, logLabel) {
  const simplifySinglePath = (pathCoords) => {
    const hasAltitude = pathCoords.some((c) => c.length === 3 && c[2] !== undefined);

    // Add index to each point so we can track which ones are kept after simplification
    const points = pathCoords.map((c, i) => ({ x: c[0], y: c[1], idx: i }));
    const simplifiedPoints = simplify(points, tolerance, true);

    if (simplifiedPoints.length === pathCoords.length) return pathCoords;

    // If original had altitude, restore it using the index
    if (hasAltitude) {
      return simplifiedPoints.map((p) => {
        const originalCoord = pathCoords[p.idx];
        return originalCoord.length === 3 ? [p.x, p.y, originalCoord[2]] : [p.x, p.y];
      });
    }

    return simplifiedPoints.map((p) => [p.x, p.y]);
  };

  if (type !== "LineString" && type !== "Polygon") return coordinates;

  // LineString and Polygon are both single arrays of coordinates
  // Polygon is treated as a closed LineString for simplification purposes
  let newCoordinates = simplifySinglePath(coordinates);
  if (type === "Polygon" && newCoordinates.length < 3) {
    // Douglas-Peucker treats the ring as an open line, so it can degenerate to just the
    // first/last point (2) - a "polygon" with fewer than 3 points has zero area and isn't
    // a valid shape. Fall back to a first/middle/last triangle instead of the full
    // unsimplified input, so a tiny/dense polygon still ends up reduced.
    newCoordinates = [
      coordinates[0],
      coordinates[Math.floor(coordinates.length / 2)],
      coordinates[coordinates.length - 1],
    ];
  }

  // Logged here, after the polygon fallback above, so this always reflects what's actually
  // being returned - not simplifySinglePath's intermediate result, which the fallback can
  // still override.
  if (logLabel && newCoordinates.length !== coordinates.length) {
    console.log(`${logLabel}: ${coordinates.length} -> ${newCoordinates.length} points`);
  }

  return newCoordinates;
}

/**
 * Extracts a layer's current ring/points as plain [lng, lat(, alt)] coordinate arrays,
 * the format simplifyPath() expects.
 * @param {L.Polygon|L.Polyline} layer
 * @returns {Array} Coordinates array
 */
function getEditingLayerCoords(layer) {
  return flattenRingPoints(layer.getLatLngs()).map(latLngToCoord);
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
  // leaflet-draw's vertex handles hold a direct reference to this exact array, captured
  // once when editing.enable() first ran and never resynced except on Cancel - mutate it
  // in place (mirroring leaflet-draw's own _spliceLatLngs) rather than calling
  // layer.setLatLngs(), which would replace the array and desync the handles from the
  // layer's actual geometry, both this session and every future edit session on it.
  // flattenRingPoints() returns that same live array, not a copy.
  const ring = flattenRingPoints(layer.getLatLngs());
  ring.length = 0;
  for (const c of coords) {
    ring.push(coordToLatLng(c));
  }
  // Only setLatLngs() (not used here, see above) recomputes this normally; redraw() below
  // reprojects the geometry but leaves it as-is, so it would otherwise still reflect the
  // pre-simplification extent.
  layer._bounds = L.latLngBounds(ring);
  layer.redraw();
  layer.editing.updateMarkers();
  // leaflet-draw's own Save handler only includes layers with this flag (normally set by
  // its vertex-drag handlers) in the draw:edited event - without it, a save with no manual
  // vertex edits would skip draw-tools.js's draw:edited handler and leave totalDistance stale.
  layer.edited = true;
  // Unlike a manual vertex drag, this geometry change doesn't fire the drag events distance
  // labels normally stay live from, so they need an explicit refresh to match the new points.
  // refreshDistanceLabels() (not showDistanceLabelsFor()): this runs on every slider tick,
  // and distanceLabelSource is already this exact layer for the whole edit session (set by
  // EDITSTART in draw-tools.js) - re-arming its 4 listeners from scratch every tick would be
  // pure waste on top of the redraw this already needs.
  if (layer instanceof L.Polyline) refreshDistanceLabels();
}

/**
 * Re-simplifies a layer already in Edit mode at an arbitrary tolerance, always re-deriving
 * from its pristine baseline (captured at EDITSTART in draw-tools.js) so repeated adjustments
 * - in either direction - never compound on top of an already-reduced point set. A no-op if
 * no baseline was captured yet (layer isn't actually being edited).
 * @param {L.Polygon|L.Polyline} layer - The layer currently being edited
 * @param {number} tolerance - Simplify.js tolerance in decimal degrees
 */
function setSimplificationTolerance(layer, tolerance) {
  const baseline = layer._simplifyBaseline;
  if (!baseline) return;

  const coords = simplifyPath(
    baseline,
    layer instanceof L.Polygon ? "Polygon" : "LineString",
    tolerance,
    null, // fires on every slider tick - would otherwise spam the console during a single drag
  );
  _applyCoordsToEditingLayer(layer, coords);
}

// Tracks the EDITVERTEX listener registered by showSimplificationSlider(), so
// hideSimplificationSlider() can remove it - see the lock comment below for why one exists.
let _simplifySliderLockHandler = null;

// Tracks the moveend/zoomend/EDITVERTEX listener that keeps LOD handles and the "zoom in to
// see edit points" hint current - see showSimplificationSlider() for why one handler owns both.
let _simplifyLodHandler = null;

/**
 * Shows a range input in the info panel's details area while a complex item is being
 * edited, live-updating the item's shape as it's dragged (see .simplify-panel* in style.css
 * for its styling). Content is rebuilt fresh into #info-panel-details each session rather
 * than toggling pre-existing markup - the existing no-selection-removal mechanism already
 * makes the panel visible on both desktop and mobile, and nothing else can write into it
 * while an edit session is active (selection is blocked), so there was no need to build a
 * persistent state around the content. The "simplify-active" class marks the panel as being
 * in this mode explicitly, independent of "no-selection".
 *
 * Also detaches every ring's vertex/mid-segment handles and skips rebuilding them entirely
 * while the slider is being dragged (harmless for an ordinary layer, and skips real work for
 * one under leaflet-draw-patches.js's level-of-detail system), rebuilding once for real on
 * release. For the rest of the session, this is also the one place keeping those LOD handles -
 * and a "zoom in to see edit points" hint for a layer with at least one dense-enough ring - in
 * sync with pan/zoom and manual vertex edits.
 * @param {L.Polygon|L.Polyline} layer - The layer currently being edited
 */
function showSimplificationSlider(layer) {
  const infoPanel = document.getElementById("info-panel");
  const details = document.getElementById("info-panel-details");
  if (!infoPanel || !details) return;

  const isPolygon = layer instanceof L.Polygon;
  const countPoints = () => flattenRingPoints(layer.getLatLngs()).length;
  const maxValue = 1000;
  const introText = "Simplify points";

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
        <input id="simplify-slider" type="range" class="simplify-panel-slider" min="0" max="${maxValue}" value="0" />
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

  // Everything that can change LOD state this session - pan/zoom, EDITVERTEX, a slider release
  // via restoreHandleGroups below - funnels through here, so the actual handles
  // (refreshEditHandles) and the "zoom in to see edit points" hint are always computed
  // together and can't drift apart.
  const updateLodDisplay = () => {
    refreshEditHandles(layer);
    const lodActive = layer.editing._verticesHandlers.some(isEditLodActive);
    zoomHint.textContent =
      lodActive && map.getZoom() < EDIT_HANDLE_MIN_ZOOM ? "Zoom in to see edit points" : "";
  };
  updateLodDisplay();
  // EDITVERTEX fires synchronously from inside leaflet-draw's own marker click/drag handling
  // (_fireEdit in leaflet.draw-src.js), while that same marker can still have its own listener
  // queued for the same event (e.g. the middle-marker icon cleanup in
  // leaflet-draw-patches.js) - refreshEditHandles removing it here would null its icon out
  // from under that listener. Defer a tick so those finish first; moveend/zoomend share this
  // handler too for simplicity, though they're never at risk. _simplifyBaseline guards against
  // hideSimplificationSlider() already having torn the session down by the time this fires.
  _simplifyLodHandler = () =>
    setTimeout(() => {
      if (layer._simplifyBaseline) updateLodDisplay();
    }, 0);
  map.on("moveend zoomend", _simplifyLodHandler);
  map.on(L.Draw.Event.EDITVERTEX, _simplifyLodHandler);

  // Point count drops fast at low tolerance and flattens at high tolerance, so map slider
  // position to tolerance exponentially instead of linearly. minTolerance floors to 1 step
  // instead of 0, since 0 as the curve's base makes the formula below divide by zero.
  const minTolerance = SLIDER_TOLERANCE_STEP;
  const maxTolerance = maxValue * SLIDER_TOLERANCE_STEP;
  const sliderValueToTolerance = (value) => {
    if (value <= 0) return 0;
    const t = value / maxValue;
    return minTolerance * Math.pow(maxTolerance / minTolerance, t);
  };

  // If even the max tolerance wouldn't remove any more points than are already showing, the
  // whole slider is a no-op - lock it immediately instead of leaving it draggable with
  // nothing to show for it (matches the manual-edit lock below).
  const maxTolerantCount = simplifyPath(
    layer._simplifyBaseline,
    isPolygon ? "Polygon" : "LineString",
    maxTolerance,
    "Max-simplification probe (not applied)",
  ).length;

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
      // The rebuild above may have crossed the LOD threshold either way - refresh the hint to
      // match (refreshEditHandles itself is a no-op here; updateMarkers() already synced the
      // handles).
      updateLodDisplay();
    };
    slider.addEventListener("pointerup", restoreHandleGroups);
    slider.addEventListener("pointercancel", restoreHandleGroups);
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
  if (_simplifyLodHandler) {
    map.off("moveend zoomend", _simplifyLodHandler);
    map.off(L.Draw.Event.EDITVERTEX, _simplifyLodHandler);
    _simplifyLodHandler = null;
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
