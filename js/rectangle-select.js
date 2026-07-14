// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Rectangle Select Module
// Adds an independent "marquee" selection tool: drag a rectangle on the map to
// select multiple existing items at once (highlighted in blue, same as the
// overview panel), then bulk duplicate/delete/recolor them. The selection
// state itself (this module's own Set) stays fully separate from the app's
// normal single-item selection (globallySelectedItem) - entering select mode
// clears the latter (same convention as draw/edit/delete modes) - but the info
// panel and elevation profile are shared: a single rect-selected item shows
// info and enables elevation exactly like a normal selection does (see
// map-interactions.js), while a multi-item selection gets its own dedicated
// count/bulk-color state (see showMultiSelectInfoPanel in ui-handlers.js).

(function () {
  let map = null;
  let isActive = false;
  let isDragging = false;
  let dragStartLatLng = null;
  let tempRectangle = null;
  let button = null;
  let actionsList = null;
  let selectTooltip = null;
  let visibilityAction = null;
  let deleteAction = null;
  let duplicateAction = null;
  let selectAllAction = null;
  let invertAction = null;
  let doneAction = null;
  let spacePanActive = false;

  const selectedLayers = new Set();

  const DRAG_THRESHOLD_PX = 6;
  const CLICK_HIT_RADIUS_PX = 8;
  const NO_SELECTION_HINT = "Select items first";
  const DRAG_TOOLTIP_START = "Click or drag to select/deselect items<br>Hold Space to move the map";
  const DRAG_TOOLTIP_END = "Release to update selection";
  // Skip Leaflet controls and anything outside the map so their taps still work.
  const preventTouchScroll = (e) => {
    if (map.getContainer().contains(e.target) && !e.target.closest(".leaflet-control-container")) {
      L.DomEvent.preventDefault(e);
    }
  };

  function getHighlightColor() {
    return (
      getComputedStyle(document.documentElement).getPropertyValue("--highlight-color").trim() ||
      "#3388ff"
    );
  }

  // Single source of truth for "every LayerGroup that makes up the map's
  // content" - isLayerStillTracked() and hasAnyItems() each apply their own
  // semantics (group-membership, non-empty) on top of this instead of
  // re-listing the groups themselves, so a new group-based layer source only
  // needs to be added here (and to getAllExportableLayers() in
  // file-handlers.js, which getAllLayers() below delegates to for the
  // flattened/ordered list). The live route stays a special case in each,
  // since it's a lone layer, not a group.
  function getAllGroups() {
    return [editableLayers, stravaActivitiesLayer, importedItems];
  }

  // Delegates to file-handlers.js's canonical export-order list instead of
  // re-deriving its own traversal order, so selection order always matches
  // "All" export order with no reconciliation needed downstream.
  function getAllLayers() {
    return getAllExportableLayers();
  }

  function getCandidateLayers() {
    // Only layers actually visible right now can be drag-selected - otherwise
    // you could silently select something you can't see (map.hasLayer() already
    // covers both reasons a layer could be hidden: individually, or its whole
    // category toggled off).
    return getAllLayers().filter((layer) => map.hasLayer(layer));
  }

  // --- Segment-aware hit-testing (so a box over the middle of a segment counts too) ---

  function orientation(p, q, r) {
    const val = (q.lng - p.lng) * (r.lat - q.lat) - (q.lat - p.lat) * (r.lng - q.lng);
    if (Math.abs(val) < 1e-12) return 0;
    return val > 0 ? 1 : 2;
  }

  function onSegment(p, q, r) {
    return (
      q.lng <= Math.max(p.lng, r.lng) &&
      q.lng >= Math.min(p.lng, r.lng) &&
      q.lat <= Math.max(p.lat, r.lat) &&
      q.lat >= Math.min(p.lat, r.lat)
    );
  }

  function segmentsIntersect(p1, q1, p2, q2) {
    const o1 = orientation(p1, q1, p2);
    const o2 = orientation(p1, q1, q2);
    const o3 = orientation(p2, q2, p1);
    const o4 = orientation(p2, q2, q1);
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(p1, p2, q1)) return true;
    if (o2 === 0 && onSegment(p1, q2, q1)) return true;
    if (o3 === 0 && onSegment(p2, p1, q2)) return true;
    if (o4 === 0 && onSegment(p2, q1, q2)) return true;
    return false;
  }

  function segmentIntersectsBounds(p1, p2, bounds) {
    if (bounds.contains(p1) || bounds.contains(p2)) return true;
    const nw = L.latLng(bounds.getNorth(), bounds.getWest());
    const ne = L.latLng(bounds.getNorth(), bounds.getEast());
    const se = L.latLng(bounds.getSouth(), bounds.getEast());
    const sw = L.latLng(bounds.getSouth(), bounds.getWest());
    return (
      segmentsIntersect(p1, p2, nw, ne) ||
      segmentsIntersect(p1, p2, ne, se) ||
      segmentsIntersect(p1, p2, se, sw) ||
      segmentsIntersect(p1, p2, sw, nw)
    );
  }

  function getRings(layer) {
    function isFlatArray(arr) {
      return Array.isArray(arr) && arr.length > 0 && !Array.isArray(arr[0]);
    }
    function extractRings(arr, out) {
      if (isFlatArray(arr)) {
        out.push(arr);
      } else if (Array.isArray(arr)) {
        arr.forEach((sub) => extractRings(sub, out));
      }
      return out;
    }
    return extractRings(layer.getLatLngs(), []);
  }

  // Marker icons (e.g. the 50px pin glyph from createMarkerIcon) are anchored
  // near their tip, not their visual center, so the clickable glyph sits mostly
  // above the marker's actual latlng. Hit-test against the icon's real rendered
  // box - the same area Leaflet's own marker click listener responds to -
  // instead of just the anchor point, otherwise clicking the visible pin often
  // misses in this tool while working fine in normal single-item selection.
  function getMarkerIconBounds(layer) {
    const icon = layer.options.icon;
    const size = icon?.options?.iconSize;
    const anchor = icon?.options?.iconAnchor;
    const anchorPoint = map.latLngToContainerPoint(layer.getLatLng());
    if (!size || !anchor) {
      return L.latLngBounds(layer.getLatLng(), layer.getLatLng());
    }
    const topLeft = anchorPoint.subtract(anchor);
    const bottomRight = topLeft.add(size);
    return L.latLngBounds(
      map.containerPointToLatLng(topLeft),
      map.containerPointToLatLng(bottomRight),
    );
  }

  function layerIntersectsBounds(layer, bounds) {
    if (layer instanceof L.Marker) {
      return bounds.overlaps(getMarkerIconBounds(layer));
    }
    if (typeof layer.getLatLngs !== "function") return false;
    // Cheap reject first: Leaflet caches getBounds(), so this skips the
    // per-segment scan entirely for layers nowhere near the hit box.
    if (!layer.getBounds().intersects(bounds)) return false;
    const closed = layer instanceof L.Polygon;
    return getRings(layer).some((ring) => {
      for (let i = 0; i < ring.length - 1; i++) {
        if (segmentIntersectsBounds(ring[i], ring[i + 1], bounds)) return true;
      }
      if (
        closed &&
        ring.length > 2 &&
        segmentIntersectsBounds(ring[ring.length - 1], ring[0], bounds)
      ) {
        return true;
      }
      return false;
    });
  }

  function syncOverviewHighlight() {
    const selectedIds = new Set(Array.from(selectedLayers, (layer) => L.Util.stamp(layer)));
    document
      .querySelectorAll("#overview-panel-list .overview-list-item[data-layer-id]")
      .forEach((el) => {
        const id = Number(el.getAttribute("data-layer-id"));
        el.classList.toggle("rectangle-selected", selectedIds.has(id));
      });
  }

  // Mirrors the overview panel's own row icon: reflects the manual override
  // (isManuallyHidden), not effective on-map visibility (which can also depend
  // on a hidden parent category).
  function anySelectedVisible() {
    return Array.from(selectedLayers).some((layer) => !layer.isManuallyHidden);
  }

  function updateActionButtonsState() {
    const hasSelection = selectedLayers.size > 0;
    visibilityAction.classList.toggle("leaflet-disabled", !hasSelection);
    deleteAction.classList.toggle("leaflet-disabled", !hasSelection);
    duplicateAction.classList.toggle("leaflet-disabled", !hasSelection);
    if (hasSelection) {
      const showing = anySelectedVisible();
      visibilityAction.textContent = showing ? "Hide" : "Show";
      visibilityAction.title = showing ? "Hide selected items" : "Show selected items";
      deleteAction.title = "Delete selected items";
      duplicateAction.title = "Duplicate selected items";
    } else {
      visibilityAction.title = NO_SELECTION_HINT;
      deleteAction.title = NO_SELECTION_HINT;
      duplicateAction.title = NO_SELECTION_HINT;
    }

    selectAllAction.textContent = hasSelection ? "Deselect all" : "Select all";
    selectAllAction.title = hasSelection ? "Deselect all items" : "Select all visible items";
  }

  // Returns the shared color if every selected layer already has the same
  // one, or undefined if the selection's colors are mixed.
  function getCommonSelectionColor() {
    let common;
    for (const layer of selectedLayers) {
      const color = layer.feature?.properties?.color || DEFAULT_COLOR;
      if (common === undefined) common = color;
      else if (common !== color) return undefined;
    }
    return common;
  }

  function getSingleSelectedLayer() {
    return selectedLayers.size === 1 ? selectedLayers.values().next().value : null;
  }

  // Mirrors the normal single-item info panel for 0/1 selected items, and adds
  // a dedicated multi-selection state (count + bulk color swatch) otherwise.
  function syncInfoPanelWithSelection() {
    if (selectedLayers.size === 0) {
      resetInfoPanel();
    } else if (selectedLayers.size === 1) {
      showInfoPanel(getSingleSelectedLayer());
    } else {
      showMultiSelectInfoPanel(selectedLayers.size, getCommonSelectionColor());
    }
  }

  // Mirrors the normal single-item elevation behavior: enabled only when
  // exactly one path (Polyline, not Polygon) is selected. Reuses
  // selectedElevationPath (the previously enabled path, if any) the same way
  // selectItem() does, so switching directly between two single-path
  // selections (e.g. via Invert) keeps the panel open instead of flickering
  // closed and reopening.
  function syncElevationWithSelection() {
    const singleLayer = getSingleSelectedLayer();
    const isPath = singleLayer instanceof L.Polyline && !(singleLayer instanceof L.Polygon);
    if (isPath && selectedElevationPath === singleLayer) return; // already showing this one

    const keepVisible = isElevationProfileVisible && isPath && selectedElevationPath !== null;
    disableElevation();
    if (keepVisible) isElevationProfileVisible = true;
    if (isPath) enableElevationForPath(singleLayer);
  }

  // Applies a color to every selected layer's data. Doesn't touch the on-map
  // style - selected layers stay in the blue selection highlight until
  // deselected, at which point resetLayerStyle() picks up the new color.
  function applyBulkColor(hex) {
    selectedLayers.forEach((layer) => {
      layer.feature = layer.feature || {};
      layer.feature.properties = layer.feature.properties || {};
      layer.feature.properties.color = hex;
    });
  }

  function setSelection(newSet) {
    selectedLayers.forEach((layer) => {
      if (!newSet.has(layer)) resetLayerStyle(layer);
    });
    const highlightColor = getHighlightColor();
    newSet.forEach((layer) => {
      if (!selectedLayers.has(layer)) applyLayerHighlight(layer, highlightColor);
    });
    selectedLayers.clear();
    newSet.forEach((layer) => selectedLayers.add(layer));
    syncOverviewHighlight();
    updateActionButtonsState();
    syncInfoPanelWithSelection();
    syncElevationWithSelection();
    syncSelectedDownloadButtonsState();
  }

  function clearSelection() {
    setSelection(new Set());
  }

  // Mirrors the Select all/Deselect all label logic in updateActionButtonsState():
  // any existing selection - even a partial one - clears entirely rather than
  // growing to "all". That's the direct way to drop a partial selection without
  // leaving select mode; Invert can't produce an empty result from a partial
  // selection, since it always yields the complement.
  function performSelectAllToggle() {
    if (selectedLayers.size > 0) clearSelection();
    else setSelection(new Set(getCandidateLayers()));
  }

  function performInvertSelection() {
    const newSet = new Set(getCandidateLayers().filter((layer) => !selectedLayers.has(layer)));
    setSelection(newSet);
  }

  // True group membership - unlike getCandidateLayers()'s map.hasLayer() check,
  // this is unaffected by hide/show (toggleLayerVisibility only adds/removes the
  // layer from the map, never from its owning group), so it only returns false
  // once a layer has actually been deleted, not just hidden.
  function isLayerStillTracked(layer) {
    return getAllGroups().some((group) => group.hasLayer(layer)) || layer === currentRoutePath;
  }

  // Reconciles the selection against reality: drops any layer that got deleted
  // through some other path (an overview panel row button, a whole category
  // cleared, the GeoJSON data-editor replacing everything, etc.) instead of
  // nuking the whole selection over one stale entry, and only exits the tool
  // once there's genuinely nothing left on the map to select.
  // skipUiUpdate defers the hasAnyItems()/exitSelectMode() check - callers
  // driving a bulk loop (performBulkAction) already run that check once via
  // updateDrawControlStates() after the loop, so doing it per-item here would
  // just rebuild the layer groups' arrays N times over for no benefit.
  function pruneSelection({ skipUiUpdate = false } = {}) {
    if (!isActive) return;
    const newSet = new Set(Array.from(selectedLayers).filter(isLayerStillTracked));
    if (newSet.size !== selectedLayers.size) setSelection(newSet);
    if (skipUiUpdate) return;
    if (!hasAnyItems()) exitSelectMode();
  }

  // Called whenever any layer's visibility changes through any path (our own
  // bulk action, or the overview panel's own row button). Unlike delete/duplicate,
  // visibility doesn't change a layer's identity, so we keep the tool and
  // selection active - just refresh the button states so they can't go stale
  // relative to what actually happened. Runs unconditionally (not gated on
  // whether `layer` itself is selected) since that's the simplest way to keep
  // the Hide/Show label - which reflects whichever selected layers are
  // currently visible - always in sync, regardless of which layer changed.
  function refreshIfTracked(layer) {
    if (!isActive || !isLayerStillTracked(layer)) return;
    updateActionButtonsState();
  }

  // Called whenever a whole layer-group's visibility is toggled (the overview
  // panel's category header, or the layers panel checkbox) - neither goes
  // through toggleLayerVisibility() for each individual item, so refreshIfTracked
  // never fires for them on its own. Kept as an unconditional refresh so the
  // button states can't drift from a category-wide change, even though none
  // of today's button states happen to depend on the candidate set.
  function refreshGroupMembers(group) {
    if (!group || typeof group.hasLayer !== "function" || !isActive) return;
    updateActionButtonsState();
  }

  // Converges all selected layers to a single target state (hide all if any are
  // currently visible, otherwise show all) - keeps the tool and selection active,
  // since nothing was removed or duplicated.
  function performBulkVisibilityToggle() {
    if (selectedLayers.size === 0) return;
    const shouldHide = anySelectedVisible();
    selectedLayers.forEach((layer) => {
      if (layer.isManuallyHidden !== shouldHide) {
        toggleLayerVisibility(layer);
      }
    });
    // Rebuilds every row so each one's own eye icon reflects its new state;
    // updateOverviewList() re-applies our rectangle-selected highlighting to
    // the freshly rebuilt rows itself.
    updateOverviewList();
    updateActionButtonsState();
  }

  // Skips the per-layer UI refresh (and, for duplication, the simplification
  // toast) - otherwise acting on hundreds of items is O(n^2) and visibly slow,
  // and duplication would spam a toast per item. Refreshes once at the end instead.
  function performBulkAction(perLayerAction) {
    if (selectedLayers.size === 0) return;
    const layers = Array.from(selectedLayers);
    clearSelection();
    layers.forEach((layer) => perLayerAction(layer, { skipUiUpdate: true }));
    updateDrawControlStates();
    updateOverviewList();
    exitSelectMode();
  }

  function performBulkDelete() {
    performBulkAction(deleteLayerImmediately);
  }

  function performBulkDuplicate() {
    performBulkAction(duplicateLayer);
  }

  // --- Mode lifecycle ---

  function hasAnyItems() {
    return getAllGroups().some((group) => group.getLayers().length > 0) || !!currentRoutePath;
  }

  function enterSelectMode() {
    if (isActive || !hasAnyItems()) return;
    deselectCurrentItem();
    isActive = true;
    window.app.activateMode("select", { onCancel: exitSelectMode });
    button.classList.add("active");
    map.dragging.disable();
    document.addEventListener("touchstart", preventTouchScroll, { passive: false });
    actionsList.style.display = "block";
    updateActionButtonsState();
    selectTooltip = new L.Draw.Tooltip(map);
    selectTooltip.updateContent({ text: DRAG_TOOLTIP_START });
  }

  function exitSelectMode() {
    if (!isActive) return;
    window.app.deactivateMode("select");
    isActive = false;
    spacePanActive = false;
    button.classList.remove("active");
    map.dragging.enable();
    document.removeEventListener("touchstart", preventTouchScroll);
    actionsList.style.display = "none";
    cancelDrag();
    clearSelection();
    selectTooltip.dispose();
    selectTooltip = null;
  }

  // --- Drag handling: mirrors L.Draw.SimpleShape (leaflet-draw-1.0.4) so touch works ---

  function pixelDistance(latlng1, latlng2) {
    const p1 = map.latLngToContainerPoint(latlng1);
    const p2 = map.latLngToContainerPoint(latlng2);
    return p1.distanceTo(p2);
  }

  // Small lat/lng box around a single point, so a tap can hit-test through the
  // same layerIntersectsBounds() logic a drag rectangle uses.
  function pointBounds(latlng) {
    const point = map.latLngToContainerPoint(latlng);
    const nw = map.containerPointToLatLng(
      point.subtract([CLICK_HIT_RADIUS_PX, CLICK_HIT_RADIUS_PX]),
    );
    const se = map.containerPointToLatLng(point.add([CLICK_HIT_RADIUS_PX, CLICK_HIT_RADIUS_PX]));
    return L.latLngBounds(nw, se);
  }

  function cancelDrag() {
    isDragging = false;
    map.getContainer().classList.remove("leaflet-crosshair");
    L.DomEvent.off(document, "mouseup", onMouseUp)
      .off(document, "touchend", onMouseUp)
      .off(document, "touchcancel", cancelDrag);
    if (tempRectangle) {
      map.removeLayer(tempRectangle);
      tempRectangle = null;
    }
  }

  function onMouseDown(e) {
    if (!isActive || spacePanActive) return;
    // Right-click is reserved for the context menu, which stays suppressed while a mode
    // is active; don't also treat it as a marquee-select click/drag.
    if (e.originalEvent?.button === 2) return;
    // A second finger joining mid-gesture means the user wants to pinch/pan,
    // not marquee-select - leave it to Leaflet's own touchZoom handler.
    if (e.originalEvent?.touches?.length > 1) return;
    isDragging = true;
    dragStartLatLng = e.latlng;
    // touchcancel (OS-interrupted touch: incoming call, edge-swipe, etc.) is
    // routed to cancelDrag() rather than onMouseUp() - there's no valid end
    // position for an aborted gesture, so it must discard rather than select.
    L.DomEvent.on(document, "mouseup", onMouseUp)
      .on(document, "touchend", onMouseUp)
      .on(document, "touchcancel", cancelDrag);
    L.DomEvent.preventDefault(e.originalEvent);
  }

  function onMouseMove(e) {
    if (!isActive) return;
    selectTooltip.updatePosition(e.latlng);
    if (!isDragging) return;
    if (e.originalEvent?.touches?.length > 1) {
      cancelDrag();
      return;
    }
    const bounds = L.latLngBounds(dragStartLatLng, e.latlng);
    if (!tempRectangle) {
      selectTooltip.updateContent({ text: DRAG_TOOLTIP_END });
      map.getContainer().classList.add("leaflet-crosshair");
      tempRectangle = L.rectangle(bounds, {
        color: getHighlightColor(),
        weight: 4,
        dashArray: "6,6",
        lineCap: "square",
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(map);
    } else {
      tempRectangle.setBounds(bounds);
    }
  }

  function onMouseUp(e) {
    const wasDragging = isDragging;
    let bounds = tempRectangle?.getBounds();
    // If the cursor left the map before any mousemove fired there, tempRectangle
    // stays null - fall back to the actual release point instead of silently
    // downgrading the whole gesture into a click at the start point. Guarded to
    // mouse events only: this handler is also bound to touchend, and touch events
    // don't have a top-level clientX for mouseEventToLatLng() to read.
    if (wasDragging && !bounds && typeof e?.clientX === "number") {
      bounds = L.latLngBounds(dragStartLatLng, map.mouseEventToLatLng(e));
    }
    cancelDrag();
    if (!wasDragging) return;
    selectTooltip.updateContent({ text: DRAG_TOOLTIP_START });

    const isClick =
      !bounds || pixelDistance(bounds.getNorthWest(), bounds.getSouthEast()) < DRAG_THRESHOLD_PX;
    const hitBounds = isClick ? pointBounds(dragStartLatLng) : bounds;

    const matched = getCandidateLayers().filter((layer) => layerIntersectsBounds(layer, hitBounds));
    if (matched.length === 0) return;
    const newSet = new Set(selectedLayers);
    matched.forEach((layer) => {
      if (newSet.has(layer)) newSet.delete(layer);
      else newSet.add(layer);
    });
    setSelection(newSet);
  }

  function onKeyDown(e) {
    if (!isActive) return;
    if (e.target.matches("input, textarea")) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selectedLayers.size > 0) {
      e.preventDefault();
      performBulkDelete();
      return;
    }
    if (e.code === "Space" && !isDragging && !spacePanActive) {
      e.preventDefault();
      spacePanActive = true;
      map.dragging.enable();
    }
  }

  function onKeyUp(e) {
    if (!spacePanActive || e.code !== "Space") return;
    spacePanActive = false;
    map.dragging.disable();
  }

  // If the window loses focus mid-gesture (e.g. alt-tab), no keyup/mouseup
  // ever arrives - without this, spacePanActive/isDragging would stay stuck
  // and either block the tool's own mousedown handling or leave the temp
  // selection rectangle following the cursor with no button held.
  function onWindowBlur() {
    if (spacePanActive) {
      spacePanActive = false;
      map.dragging.disable();
    }
    if (isDragging) cancelDrag();
  }

  function initRectangleSelect(mapInstance) {
    map = mapInstance;

    const RectangleSelectControl = L.Control.extend({
      options: { position: "topleft" },
      onAdd: function () {
        const container = L.DomUtil.create(
          "div",
          "leaflet-bar leaflet-control leaflet-control-custom",
        );
        container.id = "rectangle-select-button";
        container.style.position = "relative";
        container.innerHTML =
          '<a href="#" role="button"><span class="material-symbols">ink_selection</span></a>';

        actionsList = L.DomUtil.create("ul", "leaflet-draw-actions", container);
        const selectAllLi = L.DomUtil.create("li", "", actionsList);
        selectAllAction = L.DomUtil.create("a", "", selectAllLi);
        selectAllAction.href = "#";
        selectAllAction.title = "Select all visible items";
        selectAllAction.textContent = "Select all";
        const invertLi = L.DomUtil.create("li", "", actionsList);
        invertAction = L.DomUtil.create("a", "", invertLi);
        invertAction.href = "#";
        invertAction.title = "Invert selection of visible items";
        invertAction.textContent = "Invert";
        const visibilityLi = L.DomUtil.create("li", "", actionsList);
        visibilityAction = L.DomUtil.create("a", "leaflet-disabled", visibilityLi);
        visibilityAction.href = "#";
        visibilityAction.textContent = "Hide";
        const deleteLi = L.DomUtil.create("li", "", actionsList);
        deleteAction = L.DomUtil.create("a", "leaflet-disabled", deleteLi);
        deleteAction.href = "#";
        deleteAction.textContent = "Delete";
        const duplicateLi = L.DomUtil.create("li", "", actionsList);
        duplicateAction = L.DomUtil.create("a", "leaflet-disabled", duplicateLi);
        duplicateAction.href = "#";
        duplicateAction.textContent = "Duplicate";
        const doneLi = L.DomUtil.create("li", "", actionsList);
        doneAction = L.DomUtil.create("a", "", doneLi);
        doneAction.href = "#";
        doneAction.title = "Exit selection mode";
        doneAction.textContent = "Done";

        L.DomEvent.on(container, "click", (ev) => {
          L.DomEvent.stop(ev);
          if (L.DomUtil.hasClass(container, "disabled")) return;
          if (isActive) {
            exitSelectMode();
          } else {
            // Cancel any other active mode first, same as clicking between
            // draw tools does, so this switches straight into select mode
            // instead of being blocked until the other tool is finished.
            window.app.cancelActiveMode();
            enterSelectMode();
          }
        });
        L.DomEvent.on(selectAllAction, "click", (ev) => {
          L.DomEvent.stop(ev);
          performSelectAllToggle();
        });
        L.DomEvent.on(invertAction, "click", (ev) => {
          L.DomEvent.stop(ev);
          performInvertSelection();
        });
        L.DomEvent.on(visibilityAction, "click", (ev) => {
          L.DomEvent.stop(ev);
          performBulkVisibilityToggle();
        });
        L.DomEvent.on(duplicateAction, "click", (ev) => {
          L.DomEvent.stop(ev);
          performBulkDuplicate();
        });
        L.DomEvent.on(deleteAction, "click", (ev) => {
          L.DomEvent.stop(ev);
          performBulkDelete();
        });
        L.DomEvent.on(doneAction, "click", (ev) => {
          L.DomEvent.stop(ev);
          exitSelectMode();
        });

        button = container;
        return container;
      },
    });
    new RectangleSelectControl().addTo(map);

    // Core Leaflet never forwards touchstart/touchmove as map events - they only
    // fire here because leaflet-draw's L.Map.TouchExtend handler (auto-enabled on
    // every map, see leaflet.draw.js) bridges raw touch DOM events into
    // map.fire("touchstart"/"touchmove", {latlng, originalEvent, ...}). Do not
    // remove these two bindings: confirmed by testing on Android/iOS that dragging
    // a selection rectangle via touch stops working entirely without them.
    map
      .on("mousedown", onMouseDown)
      .on("mousemove", onMouseMove)
      .on("touchstart", onMouseDown)
      .on("touchmove", onMouseMove);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
  }

  window.app = window.app || {};
  window.app.initRectangleSelect = initRectangleSelect;
  window.app.notifyRectangleSelectionVisibilityChange = refreshIfTracked;
  window.app.refreshRectangleSelectionGroupMembers = refreshGroupMembers;
  // Called whenever a layer we're tracking gets deleted or duplicated through a
  // different path (e.g. the overview panel's own row buttons). The specific
  // layer isn't needed beyond triggering a reconcile - updateDrawControlStates()
  // (called by every mutation path, including this one's caller) would catch it
  // moments later regardless, but pruning immediately here means the tool's own
  // UI never shows stale state even for one intermediate render.
  window.app.pruneRectangleSelection = pruneSelection;
  window.app.getRectangleSelectionCount = () => selectedLayers.size;
  window.app.getRectangleSelectionSingleLayer = getSingleSelectedLayer;
  window.app.getRectangleSelectionLayers = () => Array.from(selectedLayers);
  window.app.applyBulkColor = applyBulkColor;
  window.app.syncRectangleSelectionHighlight = syncOverviewHighlight;
  window.app.hasAnyItems = hasAnyItems;
})();
