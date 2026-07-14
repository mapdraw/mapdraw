// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Leaflet.draw patches
// Small, targeted fixes for leaflet-draw bugs/quirks. Each patch below
// explains the specific problem it works around. Applied once at load time
// since they patch shared prototypes, not any particular map instance.

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

// Patch deprecated _flat method
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
  };
}
