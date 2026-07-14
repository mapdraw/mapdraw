// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * Sets leaflet-draw's locale strings, creates drawControl, patches its
 * toolbar buttons to toggle off on a second click, and wires up all
 * draw/edit/delete map event listeners.
 */
function initDrawTools() {
  // Path
  L.drawLocal.draw.toolbar.buttons.polyline = "Draw path";
  L.drawLocal.draw.handlers.polyline.tooltip.start = "Click to start drawing path";
  L.drawLocal.draw.handlers.polyline.tooltip.cont = "Click to continue path";
  L.drawLocal.draw.handlers.polyline.tooltip.end = "Click last point to finish path";

  // Area
  L.drawLocal.draw.toolbar.buttons.polygon = "Draw area";
  L.drawLocal.draw.handlers.polygon.tooltip.start = "Click to start drawing area";
  L.drawLocal.draw.handlers.polygon.tooltip.cont = "Click to continue area";
  L.drawLocal.draw.handlers.polygon.tooltip.end = "Click first point to close area";

  // Marker
  L.drawLocal.draw.toolbar.buttons.marker = "Place marker";
  L.drawLocal.draw.handlers.marker.tooltip.start = "Click to place marker";

  // Edit toolbar buttons
  L.drawLocal.edit.toolbar.buttons.edit = "Edit";
  L.drawLocal.edit.toolbar.buttons.remove = "Delete";
  L.drawLocal.edit.toolbar.buttons.editDisabled = "No items to edit";
  L.drawLocal.edit.toolbar.buttons.removeDisabled = "No items to delete";
  L.drawLocal.edit.toolbar.actions.clearAll.text = "Clear All (Drawn)";
  L.drawLocal.edit.toolbar.actions.clearAll.title =
    "Clear all drawn items (not imported files or Strava activities)";

  // Edit toolbar tooltips
  L.drawLocal.edit.handlers.edit.tooltip.text =
    "Drag handles or markers to edit<br>Click cancel to undo";
  L.drawLocal.edit.handlers.edit.tooltip.subtext = "";
  L.drawLocal.edit.handlers.remove.tooltip.text = "Click an item to delete<br>Click cancel to undo";

  drawControl = new L.Control.Draw({
    edit: { featureGroup: editableLayers },
    draw: {
      polyline: {
        shapeOptions: { ...STYLE_CONFIG.path.default, color: DEFAULT_COLOR },
        metric: true,
        feet: false,
        showLength: false,
      },
      polygon: {
        shapeOptions: { ...STYLE_CONFIG.path.default, color: DEFAULT_COLOR },
        showArea: true,
        metric: true,
      },
      rectangle: false,
      circle: false,
      marker: {
        icon: createMarkerIcon(DEFAULT_COLOR, STYLE_CONFIG.marker.default.opacity),
      },
      circlemarker: false,
    },
  });
  map.addControl(drawControl);

  const cancelDrawTools = () => {
    drawControl._toolbars[L.DrawToolbar.TYPE].disable();
    drawControl._toolbars[L.EditToolbar.TYPE].disable();
  };

  // Every toolbar button's click is hardwired by leaflet-draw to call
  // handler.enable(), with no way to toggle it back off by clicking the
  // same button again. Swap that one listener for a toggle version, using
  // the exact (button, event, fn, context) leaflet-draw itself bound it
  // with, so every draw/edit/delete tool can be toggled off the same way
  // rectangle-select already can. Always "click", never "touchstart" -
  // the _detectIOS patch above forces that regardless of device.
  [L.DrawToolbar.TYPE, L.EditToolbar.TYPE].forEach((toolbarType) => {
    Object.values(drawControl._toolbars[toolbarType]._modes).forEach(({ handler, button }) => {
      L.DomEvent.off(button, "click", handler.enable, handler);
      L.DomEvent.on(
        button,
        "click",
        () => (handler.enabled() ? handler.disable() : handler.enable()),
        handler,
      );
    });
  });

  // Map event listeners
  map.on("draw:created", (e) => {
    const layer = e.layer;
    layer.pathType = "drawn";
    layer.feature = layer.feature || { properties: {} };
    layer.feature.properties.color = DEFAULT_COLOR;
    layer.feature.properties.name = getDefaultLayerName(layer);
    drawnItems.addLayer(layer);
    editableLayers.addLayer(layer);
    layer.on("click", (ev) => {
      L.DomEvent.stopPropagation(ev);
      selectItem(layer);
    });
    if (e.layerType === "polyline" || e.layerType === "polygon") {
    }
    selectItem(layer);
    if (!map.hasLayer(drawnItems)) {
      map.addLayer(drawnItems);
    }
    updateDrawControlStates();
    updateOverviewList();
  });

  map.on("draw:edited", (e) => {
    e.layers.eachLayer((layer) => {
      if (layer instanceof L.Polyline || layer instanceof L.Polygon) {
        const newDistance = calculatePathDistance(layer);
        if (layer.feature && layer.feature.properties) {
          layer.feature.properties.totalDistance = newDistance;
        }
        if (globallySelectedItem === layer) selectItem(layer);
      }
    });
    updateDrawControlStates();
  });

  map.on(L.Draw.Event.DELETED, (e) => {
    e.layers.eachLayer((layer) => {
      deleteLayerImmediately(layer, { skipUiUpdate: true });
      layer.isDeletedFromToolbar = false;
    });
    updateDrawControlStates();
    updateOverviewList();
  });

  // Distance labels for drawing
  let distanceLabels = [];
  let totalDistance = 0;

  map.on(L.Draw.Event.DRAWSTART, function (e) {
    // draw:created (which selects the newly-drawn shape) fires before
    // draw:drawstop deactivates this mode, so selection must stay allowed
    // throughout - unlike the delete/edit sub-modes below, which block it.
    window.app.activateMode("draw-tools", { onCancel: cancelDrawTools, canSelect: () => true });
    deselectCurrentItem();
    L.DomUtil.addClass(document.body, "leaflet-is-drawing");
    totalDistance = 0;
    distanceLabels.forEach((label) => map.removeLayer(label));
    distanceLabels = [];

    if (e.layerType === "polyline" || e.layerType === "polygon") {
      map.on("draw:drawvertex", function (evt) {
        const points = evt.layers.getLayers().map((l) => l.getLatLng());
        if (points.length < 2) return;

        const prevPoint = points[points.length - 2];
        const newPoint = points[points.length - 1];
        totalDistance += prevPoint.distanceTo(newPoint);

        const label = L.marker(newPoint, {
          icon: L.divIcon({
            className: "distance-label",
            html: formatDistance(totalDistance),
            iconSize: [60, 20],
            iconAnchor: [30, -10],
          }),
          interactive: false,
        }).addTo(map);

        distanceLabels.push(label);
      });
    }
  });

  map.on(L.Draw.Event.DRAWSTOP, function () {
    window.app.deactivateMode("draw-tools");
    L.DomUtil.removeClass(document.body, "leaflet-is-drawing");
    distanceLabels.forEach((label) => map.removeLayer(label));
    distanceLabels = [];
    map.off("draw:drawvertex");
  });

  map.on(L.Draw.Event.DELETESTART, () => {
    window.app.activateMode("draw-tools", { onCancel: cancelDrawTools });
    isDeleteMode = true;
    deselectCurrentItem();
    editableLayers.eachLayer((layer) => {
      if (map.hasLayer(layer)) {
        layer.on("click", onFeatureClickToDelete);
      }
    });
    L.DomUtil.addClass(map.getContainer(), "map-is-editing");
    updateDrawControlStates();
  });

  map.on(L.Draw.Event.DELETESTOP, () => {
    window.app.deactivateMode("draw-tools");
    isDeleteMode = false;
    updateDrawControlStates();
    editableLayers.eachLayer((layer) => {
      layer.off("click", onFeatureClickToDelete);
    });
    L.DomUtil.removeClass(map.getContainer(), "map-is-editing");

    editableLayers.eachLayer((layer) => {
      if (!map.hasLayer(layer) && !layer.isManuallyHidden) {
        map.addLayer(layer);
      }
      layer.isDeletedFromToolbar = false;
    });

    if (globallySelectedItem) {
      selectItem(globallySelectedItem);
    }
  });

  map.on(L.Draw.Event.EDITSTART, () => {
    window.app.activateMode("draw-tools", { onCancel: cancelDrawTools });
    isEditMode = true;
    deselectCurrentItem();
    if (selectedPathOutline) map.removeLayer(selectedPathOutline);
    if (selectedMarkerOutline) map.removeLayer(selectedMarkerOutline);
    L.DomUtil.addClass(map.getContainer(), "map-is-editing");
    updateDrawControlStates();
  });

  map.on(L.Draw.Event.EDITSTOP, () => {
    window.app.deactivateMode("draw-tools");
    isEditMode = false;
    L.DomUtil.removeClass(map.getContainer(), "map-is-editing");

    if (globallySelectedItem) {
      const itemToReselect = globallySelectedItem;
      deselectCurrentItem();
      setTimeout(() => {
        selectItem(itemToReselect);
        if (itemToReselect instanceof L.Marker) {
          itemToReselect.setZIndexOffset(1000);
        }
      }, 50);
    }
    updateDrawControlStates();
  });
}
