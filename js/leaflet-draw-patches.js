// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Leaflet.draw patches
// Small, targeted fixes for leaflet-draw bugs/quirks, plus small extensions built the same
// way (patching a shared prototype). Each one below explains what it works around or adds.
// Applied once at load time, not per map instance.

// Prevent polyline drawing tool from finishing on second tap on touch devices
L.Draw.Polyline.prototype._onTouch = L.Util.falseFn;

// Fix toolbar on iPad with mouse by forcing click events instead of touchstart
if (L.Toolbar) {
  L.Toolbar.prototype._detectIOS = () => false;
}

// _checkDisabled listens to featureGroup layerremove, wrongly disabling buttons on any
// mid-session removal (e.g. the item being edited getting deleted out from under Edit
// mode - see draw-tools.js). Guard it with enabled() (_activeMode !== null); patch
// _handlerDeactivated to call it after the mode ends — save() fires no layerremove so
// _checkDisabled would never run to fix state otherwise.
if (L.EditToolbar) {
  const origCheckDisabled = L.EditToolbar.prototype._checkDisabled;
  L.EditToolbar.prototype._checkDisabled = function () {
    if (this.enabled()) return;
    origCheckDisabled.call(this);
  };
  const origHandlerDeactivated = L.EditToolbar.prototype._handlerDeactivated;
  L.EditToolbar.prototype._handlerDeactivated = function () {
    origHandlerDeactivated.call(this);
    this._checkDisabled();
  };
}

// A hidden marker has no marker.dragging (deleted by Leaflet on removal, recreated on
// add). leaflet-draw touches it unconditionally, throwing "Cannot read properties of
// undefined (reading 'enable'/'disable')" when Edit mode is entered while a marker is
// hidden, or when Save/Cancel is pressed while one is hidden. Paths/polygons don't use
// .dragging, so only markers need this guard.
if (L.EditToolbar && L.EditToolbar.Edit) {
  const origEnableLayerEdit = L.EditToolbar.Edit.prototype._enableLayerEdit;
  L.EditToolbar.Edit.prototype._enableLayerEdit = function (e) {
    const layer = e.layer || e.target || e;
    if (layer instanceof L.Marker && !layer.dragging) {
      // Still back up the latlng even though we can't make it draggable yet -
      // _backupLayer() only touches getLatLng(), never .dragging, so it's safe
      // here. Without this, un-hiding the marker later (toggleLayerVisibility)
      // makes it draggable with no backup taken, so Cancel can't revert it.
      this._backupLayer(layer);
      return;
    }
    origEnableLayerEdit.call(this, e);
  };
  const origDisableLayerEdit = L.EditToolbar.Edit.prototype._disableLayerEdit;
  L.EditToolbar.Edit.prototype._disableLayerEdit = function (e) {
    const layer = e.layer || e.target || e;
    if (layer instanceof L.Marker && !layer.dragging) return;
    origDisableLayerEdit.call(this, e);
  };
}

// Single-item edit mode. Two patches, both required together:
//  1. _enableLayerEdit normally runs once per layer in editableLayers (via featureGroup.eachLayer
//     in addHooks()), giving every one of them vertex handles - that's what makes Edit mode
//     crash-prone with hundreds of items. Restrict it to the one layer that was selected when
//     Edit mode was entered, captured into itemBeingEdited by draw-tools.js (EDITSTART deselects
//     globallySelectedItem before this runs, so that global is already null by the time we'd check it).
//  2. _hasAvailableLayers is leaflet-draw's own gate for whether enable() proceeds at all - it
//     normally only checks whether editableLayers is non-empty. Without also requiring a valid
//     selection here, clicking Edit with nothing selected would still start a session, just one
//     where patch 1 gives handles to nobody. A selected layer that's a featureGroup member
//     already implies the group is non-empty, so this fully replaces the original check.
if (L.EditToolbar && L.EditToolbar.Edit) {
  const origEnableLayerEdit = L.EditToolbar.Edit.prototype._enableLayerEdit;
  L.EditToolbar.Edit.prototype._enableLayerEdit = function (e) {
    const layer = e.layer || e.target || e;
    if (layer !== itemBeingEdited) return;
    origEnableLayerEdit.call(this, e);
    // Color the vertex/mid-segment handles (style.css) to match the item being edited.
    document.documentElement.style.setProperty(
      "--active-item-color",
      layer.feature.properties.color,
    );
  };

  L.EditToolbar.Edit.prototype._hasAvailableLayers = function () {
    return !!globallySelectedItem && this._featureGroup.hasLayer(globallySelectedItem);
  };
}

// leaflet-draw's _defaultShape() calls L.Polyline._flat() on nearly every edit interaction
// (vertex drag, click-to-delete, entering edit mode, ...). Leaflet still ships that method
// for backwards compatibility, but it's just a wrapper that logs a console.warn on every
// call before delegating to L.LineUtil.isFlat. Point it straight at isFlat to drop the warning
// spam without changing behavior.
if (L.Polyline && L.LineUtil && L.LineUtil.isFlat) {
  L.Polyline._flat = L.LineUtil.isFlat;
}

// Mid-segment "add point" handles share the exact same classes as real vertex handles;
// leaflet-draw tells them apart only by an inline opacity set on creation, giving CSS no
// selector to target them separately. Tag them with a real .leaflet-editing-middle-icon class
// instead, so they can be styled or annotated independently of real vertex handles.
if (L.Edit && L.Edit.PolyVerticesEdit) {
  const origCreateMiddleMarker = L.Edit.PolyVerticesEdit.prototype._createMiddleMarker;
  L.Edit.PolyVerticesEdit.prototype._createMiddleMarker = function (marker1, marker2) {
    origCreateMiddleMarker.call(this, marker1, marker2);
    const marker = marker1._middleRight;
    const addMiddleClass = () => L.DomUtil.addClass(marker._icon, "leaflet-editing-middle-icon");
    // Persistent, not once(): Marker._removeIcon() nulls _icon on every removal, and
    // DivIcon.createIcon() builds a brand-new element whenever the old one is gone - so the
    // LOD system above (which repeatedly adds/removes this same marker as it scrolls in and
    // out of view) means a fresh, unclassed icon gets created on every re-add, not just the
    // first. Re-run this every time, not only once, or it renders full-size after the first
    // hide/show cycle.
    if (marker._icon) addMiddleClass();
    marker.on("add", addMiddleClass);
    // leaflet-draw reuses this same marker as the real vertex once it's dragged, clicked, or
    // touch-moved (see the onDragStart closure inside _createMiddleMarker in
    // leaflet.draw-src.js) - a one-time, permanent transition, so both stop the class from
    // reapplying on any future LOD re-add and strip it immediately for this one. Our CSS
    // opacity on this class is !important, so without stripping it the promoted vertex would
    // stay stuck translucent forever instead of looking like a real point.
    marker.once("dragstart click touchmove", () => {
      marker.off("add", addMiddleClass);
      L.DomUtil.removeClass(marker._icon, "leaflet-editing-middle-icon");
    });
  };
}

// Level-of-detail vertex/mid-segment handles for dense paths/areas: at or above
// EDIT_LOD_POINT_THRESHOLD points, a handle only stays on the map while zoomed in enough and
// on/near screen to actually be usable, so rendering cost scales with what's on screen instead
// of with the path's total point count. Below the threshold, a ring behaves exactly like stock
// leaflet-draw - ordinary hand-drawn paths/areas are nowhere near the threshold, so they're
// unaffected either way.
//
// This file loads before the map instance exists (see index.html's script order), so unlike
// the patches above, everything below only ever reads the global `map` when called, never at
// load time. The moveend/zoomend listener that keeps handles in sync as the view changes lives
// in draw-tools.js's EDITSTART/EDITSTOP instead, for that same reason.
const EDIT_HANDLE_MIN_ZOOM = 15;
const EDIT_HANDLE_VIEWPORT_BUFFER = 0.25; // matches distance-labels.js's own pad() convention
const EDIT_LOD_POINT_THRESHOLD = 100;
const EDIT_HANDLE_DEBUG = false; // set true to log live/total handle counts at both syncEditHandles call sites

function editHandleEligible(latlng) {
  return (
    map.getZoom() >= EDIT_HANDLE_MIN_ZOOM &&
    map.getBounds().pad(EDIT_HANDLE_VIEWPORT_BUFFER).contains(latlng)
  );
}

// A mid-segment handle sits at the midpoint of its two neighboring vertices - after
// simplification those can be far enough apart that the midpoint itself falls outside the
// viewport even while the segment between them clearly crosses it. Checking the segment
// (segmentCrossesBounds, from distance-labels.js) instead of just the midpoint's own
// coordinate keeps it in sync with the vertices around it.
function editMidpointEligible(vertexA, vertexB) {
  return (
    map.getZoom() >= EDIT_HANDLE_MIN_ZOOM &&
    segmentCrossesBounds(vertexA, vertexB, map.getBounds().pad(EDIT_HANDLE_VIEWPORT_BUFFER))
  );
}

// Whether a ring is dense enough for LOD to apply at all - path-simplification.js's slider uses
// this to leave a small ring's handles alone entirely, matching the threshold the _initMarkers
// patch below gates on.
function isEditLodActive(handler) {
  return handler._markers.length >= EDIT_LOD_POINT_THRESHOLD;
}

// Adds or removes a single handle from its live group to match whether it's currently
// eligible. Eligibility is computed by the caller, since vertices and midpoints use different
// rules (see editMidpointEligible above).
function toggleEditHandleVisibility(marker, group, eligible) {
  const isShown = group.hasLayer(marker);
  if (eligible && !isShown) group.addLayer(marker);
  else if (!eligible && isShown) group.removeLayer(marker);
}

// Applies current eligibility to every vertex and its _middleRight mid-segment marker - each
// mid-segment marker is reachable from exactly one vertex this way, since its other neighbor
// sees the same object as its _middleLeft. Returns how many ended up live. Shared by the
// _initMarkers patch below and refreshEditHandles below, so both stay in sync by construction
// instead of by keeping two copies of this logic aligned by hand.
// active=false forces every handle eligible regardless of viewport/zoom - used by
// refreshEditHandles below to restore full visibility once a ring drops back under
// EDIT_LOD_POINT_THRESHOLD (manual point add/remove changes the count without ever going
// through a full _initMarkers rebuild, so nothing else would undo a stale filter).
function syncEditHandles(markers, group, active = true) {
  let liveCount = 0;
  for (const marker of markers) {
    const vertexEligible = !active || editHandleEligible(marker.getLatLng());
    toggleEditHandleVisibility(marker, group, vertexEligible);
    if (vertexEligible) liveCount++;

    const mid = marker._middleRight;
    if (!mid) continue;
    const midEligible =
      !active || editMidpointEligible(marker.getLatLng(), marker._next.getLatLng());
    toggleEditHandleVisibility(mid, group, midEligible);
    if (midEligible) liveCount++;
  }
  return liveCount;
}

// Re-syncs every ring's handles on a layer to the current viewport - the only place this
// happens outside a full _initMarkers rebuild, which pan/zoom and a manual vertex edit never
// trigger on their own. Only caller is showSimplificationSlider (path-simplification.js),
// which runs every Polyline/Polygon edit session.
//
// Always runs, even for rings currently under EDIT_LOD_POINT_THRESHOLD: a manual point
// add/remove can cross the threshold in either direction without ever calling _initMarkers,
// so a ring that was LOD-filtered while >= threshold and then dropped back under it (one
// point removed) needs this to force its hidden handles back on - skipping non-LOD-active
// rings here would leave that stale filter in place forever.
function refreshEditHandles(layer) {
  for (const handler of layer.editing._verticesHandlers) {
    const active = isEditLodActive(handler);
    const liveCount = syncEditHandles(handler._markers, handler._markerGroup, active);
    if (EDIT_HANDLE_DEBUG) {
      console.log(`Edit handles: ${liveCount} live out of ~${handler._markers.length * 2}`);
    }
  }
}

if (L.Edit && L.Edit.PolyVerticesEdit) {
  // _initMarkers() runs when Edit mode starts (group not yet on the map - already cheap) and
  // again on every later updateMarkers() call (every slider tick), where the group is normally
  // already attached. There, filtering markers out after creating them is
  // too late: _createMarker's addLayer() already paid the full DOM/icon cost the instant the
  // group is live. Detaching the group first (if attached), creating at no cost, filtering
  // while still detached, then reattaching once - only the eligible subset ever pays that cost.
  const origInitMarkers = L.Edit.PolyVerticesEdit.prototype._initMarkers;
  L.Edit.PolyVerticesEdit.prototype._initMarkers = function () {
    // _defaultShape() is this ring's current point array. Checked before creation, not after,
    // so the detach-first optimization below still applies on the very rebuild that would
    // otherwise pay full DOM cost for every point.
    if (this._defaultShape().length < EDIT_LOD_POINT_THRESHOLD) {
      origInitMarkers.call(this);
      return;
    }

    const polyMap = this._poly._map;
    const wasAttached = !!(polyMap && this._markerGroup && polyMap.hasLayer(this._markerGroup));
    if (wasAttached) polyMap.removeLayer(this._markerGroup);

    origInitMarkers.call(this);
    const liveCount = syncEditHandles(this._markers, this._markerGroup);
    if (EDIT_HANDLE_DEBUG) {
      console.log(`Edit handles: ${liveCount} live out of ~${this._markers.length * 2}`);
    }

    if (wasAttached) polyMap.addLayer(this._markerGroup);
  };
}

// Injects an extra action button (styled like leaflet-draw's own Save/Cancel/Finish/Undo)
// into a toolbar's actions row. ToolbarClass is L.DrawToolbar or L.EditToolbar; filter(handler)
// decides which active handler - e.g. L.Draw.Polyline, L.EditToolbar.Edit - gets the button.
function addToolbarAction(ToolbarClass, filter, { title, text, callback }) {
  const origGetActions = ToolbarClass.prototype.getActions;
  ToolbarClass.prototype.getActions = function (handler) {
    const actions = origGetActions.call(this, handler);
    if (filter(handler)) {
      actions.push({ title, text, callback, context: this });
    }
    return actions;
  };
}
