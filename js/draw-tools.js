// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * Sets leaflet-draw's locale strings, creates drawControl, patches its
 * toolbar buttons to toggle off on a second click, and wires up all
 * draw/edit map event listeners.
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
  L.drawLocal.edit.toolbar.buttons.edit = "Edit items in the Drawn Items layer";
  L.drawLocal.edit.toolbar.buttons.editDisabled = "No items in the Drawn Items layer to edit";

  // Edit toolbar tooltip - text is set per session in EDITSTART below, since only
  // the single selected item is ever edited and its type determines the wording.
  L.drawLocal.edit.handlers.edit.tooltip.subtext = "";

  drawControl = new L.Control.Draw({
    edit: { featureGroup: editableLayers, remove: false },
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

  // Help buttons (Edit and Path toolbars only - the only two with behavior that isn't already
  // self-explanatory from their tooltips/button labels above)
  addToolbarAction(L.EditToolbar, (handler) => handler instanceof L.EditToolbar.Edit, {
    title: "Editing Help",
    text: "Help",
    callback: () =>
      Swal.fire({
        title: "Editing Help",
        html: `
<p style="text-align: left; margin: 0 0 18px 0">
  Applies only to items in the <strong>Drawn Items</strong> layer!
</p>
<p style="text-align: left; margin: 0 0 18px 0">
  <strong>Markers:</strong> Drag to move.
</p>
<p style="text-align: left; margin: 0 0 18px 0">
  <strong>Points:</strong> A path's or area's actual points, shown larger. Drag to move, click to
  remove.
</p>
<p style="text-align: left; margin: 0 0 18px 0">
  <strong>Midpoints:</strong> Smaller points shown between a path's or area's points. Drag or
  click one to add a new point there.
</p>
<p style="text-align: left; margin: 0 0 18px 0">
  <strong>Simplify slider:</strong> Shown in the info panel whenever you edit a path or area.
  Drag it to remove more or fewer points.
</p>
<p style="text-align: left">
  <strong>Dense paths/areas:</strong> On a path or area with a lot of points, points and
  midpoints only show up once you're zoomed in close enough. If none appear, check the info
  panel - it'll say so.
</p>
`,
        confirmButtonText: "Got it!",
      }),
  });
  addToolbarAction(L.DrawToolbar, (handler) => handler.type === L.Draw.Polyline.TYPE, {
    title: "Path Drawing Help",
    text: "Help",
    callback: () =>
      Swal.fire({
        title: "Path Drawing Help",
        html: `
<p style="text-align: left; margin: 0 0 18px 0">
  Applies only to items in the <strong>Drawn Items</strong> layer!
</p>
<p style="text-align: left; margin: 0 0 18px 0">
  <strong>Draw a path:</strong> Click to place each point, then click the last point again (or
  the Finish button) to complete it.
</p>
<p style="text-align: left; margin: 0 0 18px 0">
  <strong>Start on an endpoint:</strong> Every visible existing path shows a black point at each
  end while drawing. Click one as your very first point to extend that path from there, keeping
  its name and color.
</p>
<p style="text-align: left; margin: 0 0 18px 0">
  <strong>End on an endpoint:</strong> Click one of those black points at any later point in your
  drawing to connect your new path to it and finish immediately.
</p>
<p style="text-align: left">
  <strong>Start and end on endpoints:</strong> Do both in the same drawing to merge two paths
  into one. The path you started on keeps its name and color; the other is absorbed into it.
</p>
`,
        confirmButtonText: "Got it!",
      }),
  });

  const cancelDrawTools = () => {
    drawControl._toolbars[L.DrawToolbar.TYPE].disable();
    drawControl._toolbars[L.EditToolbar.TYPE].disable();
  };

  // Every toolbar button's click is hardwired by leaflet-draw to call
  // handler.enable(), with no way to toggle it back off by clicking the
  // same button again. Swap that one listener for a toggle version, using
  // the exact (button, event, fn, context) leaflet-draw itself bound it
  // with, so every draw/edit tool can be toggled off the same way
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
    // path-extend.js has its own draw:created listener that takes over when
    // either end of the new path was snapped onto an existing path's
    // endpoint, splicing/joining the points instead of creating a separate item.
    if (pathExtendTarget || pathExtendFinishTarget) return;
    const layer = e.layer;
    layer.feature = layer.feature || { properties: {} };
    layer.internal = { pathType: "drawn" };
    setLayerColor(layer, DEFAULT_COLOR);
    layer.feature.properties.name = getDefaultLayerName(layer);
    addAsDrawnItem(layer);
    layer.on("click", (ev) => {
      L.DomEvent.stopPropagation(ev);
      selectItem(layer);
    });
    selectItem(layer);
    updateOverviewList();
  });

  map.on("draw:edited", () => {
    updateDrawControlStates();
    // What keeps the GeoJSON Editor tab (data-editor.js) live if it's open - see
    // updateOverviewList()'s own doc comment for why.
    updateOverviewList();
  });

  // EDITSTOP reselects whatever was being edited, but only after a short delay (below).
  // Anything that establishes a new selection state before that delay elapses - a different
  // tool starting (e.g. clicking Path right after Edit, which leaflet-draw's own toolbar
  // exclusivity auto-stops before draw:drawstart even fires), or simply clicking a different
  // item - must cancel it, or the stale reselect lands on top of that newer state. Exposed so
  // selectItem()/deselectCurrentItem() (map-interactions.js) can cancel it on every call,
  // rather than every present and future tool-start handler having to remember to.
  let pendingReselectTimer = null;
  function cancelPendingReselect() {
    clearTimeout(pendingReselectTimer);
    pendingReselectTimer = null;
  }
  window.app.cancelPendingReselect = cancelPendingReselect;

  function onDrawVertex(evt) {
    const newPoints = evt.layers.getLayers().map((l) => l.getLatLng());
    // path-extend.js's own listener (bound after this one) seeds the label for
    // the first vertex once pathExtendTarget is set; nothing to show before that.
    if (newPoints.length < 2) return;
    // Extending an existing path: prepend its points so its labels stay visible.
    // newPoints[0] is the marker path-extend.js snapped onto that same path's
    // endpoint - already the lead-in's own last point - so drop it to avoid a
    // zero-length segment at the join (mirrors path-extend.js's own draw:created
    // handler, which slices its drawnPoints the same way for the final shape).
    const points = pathExtendTarget
      ? [...pathExtendLeadInPoints(pathExtendTarget), ...newPoints.slice(1)]
      : newPoints;
    showDistanceLabelsFor(points);
  }

  map.on(L.Draw.Event.DRAWSTART, function (e) {
    // draw:created (which selects the newly-drawn shape) fires before
    // draw:drawstop deactivates this mode, so selection must stay allowed
    // throughout - unlike the edit sub-mode below, which blocks it.
    window.app.activateMode("draw-tools", { onCancel: cancelDrawTools, canSelect: () => true });
    deselectCurrentItem();
    L.DomUtil.addClass(document.body, "leaflet-is-drawing");
    window.app.setDrawnItemsCheckboxLocked(true);
    hideDistanceLabels();

    if (e.layerType === "polyline" || e.layerType === "polygon") {
      // Matches leaflet-draw's own shapeOptions.color above - keeps the in-progress
      // vertex handles (style.css) the same color the shape will get once created.
      document.documentElement.style.setProperty("--active-item-color", DEFAULT_COLOR);
      map.on("draw:drawvertex", onDrawVertex);
    }
  });

  map.on(L.Draw.Event.DRAWSTOP, function () {
    window.app.deactivateMode("draw-tools");
    L.DomUtil.removeClass(document.body, "leaflet-is-drawing");
    window.app.setDrawnItemsCheckboxLocked(false);
    document.documentElement.style.removeProperty("--active-item-color");
    // Only clear if the draw was cancelled - a finished shape's draw:created already
    // handed the labels off to it via selectItem(), which fires before this.
    if (isDistanceLabelSourceInProgress()) {
      hideDistanceLabels();
    }
    // Precisely, not map.off("draw:drawvertex") - the no-handler form would also
    // remove path-extend.js's listener on the same event.
    map.off("draw:drawvertex", onDrawVertex);
  });

  map.on(L.Draw.Event.EDITSTART, () => {
    window.app.activateMode("draw-tools", { onCancel: cancelDrawTools });
    isEditMode = true;
    // Captured before deselecting so leaflet-draw-patches.js's _enableLayerEdit guard
    // still knows which layer to give vertex handles to.
    itemBeingEdited = globallySelectedItem;
    // leaflet-draw reads this text into its tooltip synchronously right after this
    // event finishes firing (L.EditToolbar.Edit.prototype.enable), so it's set fresh
    // per session rather than once at init - only the selected item is ever edited.
    L.drawLocal.edit.handlers.edit.tooltip.text =
      itemBeingEdited instanceof L.Marker
        ? "Drag marker to move<br>Click cancel to undo"
        : itemBeingEdited instanceof L.Polygon
          ? "Drag points to edit area<br>Click cancel to undo"
          : "Drag points to edit path<br>Click cancel to undo";
    deselectCurrentItem({ skipControlUpdate: true });
    L.DomUtil.addClass(map.getContainer(), "map-is-editing");
    window.app.setDrawnItemsCheckboxLocked(true);
    updateDrawControlStates();

    // Markers have no vertices to show distances along. showDistanceLabelsFor() itself
    // stays live for the rest of the edit session - no extra wiring needed here.
    if (itemBeingEdited instanceof L.Polyline) {
      showDistanceLabelsFor(itemBeingEdited);

      // Deferred to the next tick: leaflet-draw enables this layer's editing handler
      // synchronously right after this EDITSTART handler returns, as part of the same
      // enable() call chain (see L.EditToolbar.Edit.prototype.enable in
      // leaflet.draw-src.js) - showSimplificationSlider() needs layer.editing to
      // already exist for its LOD handle sync.
      const editedLayer = itemBeingEdited;
      setTimeout(() => {
        if (itemBeingEdited !== editedLayer) return; // session ended/changed already
        // Captured fresh every session so the manual slider can always re-derive from
        // full detail, regardless of what a previous session already reduced it to.
        editedLayer._simplifyBaseline = getEditingLayerCoords(editedLayer);
        // Also keeps the LOD vertex/mid-segment handles (leaflet-draw-patches.js's
        // refreshEditHandles) synced for the rest of the session - see
        // showSimplificationSlider for why it owns that instead of a listener here.
        showSimplificationSlider(editedLayer);
      }, 0);
    }
  });

  map.on(L.Draw.Event.EDITSTOP, () => {
    window.app.deactivateMode("draw-tools");
    isEditMode = false;
    L.DomUtil.removeClass(map.getContainer(), "map-is-editing");
    window.app.setDrawnItemsCheckboxLocked(false);
    document.documentElement.style.removeProperty("--active-item-color");
    hideDistanceLabels();
    hideSimplificationSlider(itemBeingEdited);

    const itemToReselect = itemBeingEdited;
    itemBeingEdited = null;
    // Not tracked anymore if this EDITSTOP was forced by the layerremove guard
    // below (the item was deleted out from under an active edit session) -
    // reselecting it would resurrect a detached, no-longer-on-the-map layer.
    if (itemToReselect && editableLayers.hasLayer(itemToReselect)) {
      pendingReselectTimer = setTimeout(() => {
        pendingReselectTimer = null;
        selectItem(itemToReselect);
        if (itemToReselect instanceof L.Marker) {
          itemToReselect.setZIndexOffset(1000);
        }
      }, 50);
    }
    updateDrawControlStates();
    // leaflet-draw's own _checkDisabled() runs after us in this same synchronous
    // chain (via _handlerDeactivated) and only knows hasLayers, not selection - it
    // would otherwise leave the edit button looking enabled for the ~50ms until the
    // reselect above actually runs. Re-assert once that chain has unwound.
    queueMicrotask(updateDrawControlStates);
  });

  // If the item currently being edited gets removed through some other UI surface -
  // e.g. the Data editor's Apply button, which isn't blocked while Edit mode is
  // active (unlike the overview panel) - leaflet-draw's own vertex handles are torn
  // down (_disableLayerEdit reacts to the layer's removal) but the toolbar itself
  // has no idea the session is over: EDITSTOP never fires, so isEditMode/the
  // "Drawn Items" checkbox lock/the overview-panel lock/mode-manager's active mode
  // (which blocks all selection) would otherwise stay stuck until a page reload.
  // Mirrors path-extend.js's own layerremove guard for the equivalent draw-mode case.
  editableLayers.on("layerremove", (e) => {
    if (e.layer === itemBeingEdited) {
      drawControl._toolbars[L.EditToolbar.TYPE].disable();
    }
  });
}
