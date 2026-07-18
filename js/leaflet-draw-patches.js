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

// _checkDisabled listens to featureGroup layerremove. In delete mode, _removeLayer moves layers
// from featureGroup to _deletedLayers, firing layerremove mid-session and wrongly disabling buttons.
// Guard it with enabled() (_activeMode !== null); patch _handlerDeactivated to call it after the
// mode ends — save() fires no layerremove so _checkDisabled would never run to fix state otherwise.
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
    // On initial edit-mode entry the marker group isn't added to the map yet at this
    // point (leaflet-draw does that right after _initMarkers() finishes), so the icon
    // element doesn't exist until the marker's own "add" event fires.
    if (marker._icon) {
      L.DomUtil.addClass(marker._icon, "leaflet-editing-middle-icon");
    } else {
      marker.once("add", () => L.DomUtil.addClass(marker._icon, "leaflet-editing-middle-icon"));
    }
    // leaflet-draw reuses this same marker as the real vertex once it's dragged, clicked,
    // or touch-moved (see the onDragStart closure inside _createMiddleMarker in
    // leaflet.draw-src.js), restoring full opacity via setOpacity(1). Our CSS opacity on
    // this class is !important, so without stripping the class the promoted vertex would
    // stay stuck translucent forever instead of looking like a real point.
    marker.once("dragstart click touchmove", () => {
      L.DomUtil.removeClass(marker._icon, "leaflet-editing-middle-icon");
    });
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
