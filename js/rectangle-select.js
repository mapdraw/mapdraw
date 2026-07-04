// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Rectangle Select Module
// Adds an independent "marquee" selection tool: drag a rectangle on the map to
// select multiple existing items at once (highlighted in blue, same as the
// overview panel), then bulk duplicate/delete them. This is fully separate
// from the app's normal single-item selection (globallySelectedItem), though
// entering select mode clears it (same convention as draw/edit/delete modes).

(function () {
  let map = null;
  let isActive = false;
  let otherModeActive = false;
  let isDragging = false;
  let dragStartLatLng = null;
  let tempRectangle = null;
  let button = null;
  let actionsList = null;
  let visibilityAction = null;
  let deleteAction = null;
  let copyAction = null;
  let doneAction = null;

  const selectedLayers = new Set();
  const pathOutlines = new Map(); // layer -> outline copy (mirrors selectedPathOutline)
  const markerOutlines = new Map(); // layer -> outline marker (mirrors selectedMarkerOutline)

  const DRAG_THRESHOLD_PX = 6;
  const preventTouchScroll = (e) => L.DomEvent.preventDefault(e);

  function getHighlightColor() {
    return (
      getComputedStyle(document.documentElement).getPropertyValue("--highlight-color").trim() ||
      "#3388ff"
    );
  }

  function getCandidateLayers() {
    // Only layers actually visible right now can be drag-selected - otherwise
    // you could silently select something you can't see (map.hasLayer() already
    // covers both reasons a layer could be hidden: individually, or its whole
    // category toggled off).
    return [
      ...editableLayers.getLayers(),
      ...stravaActivitiesLayer.getLayers(),
      ...importedItems.getLayers(),
    ].filter((layer) => map.hasLayer(layer));
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

  function layerIntersectsBounds(layer, bounds) {
    if (layer instanceof L.Marker) {
      return bounds.contains(layer.getLatLng());
    }
    if (typeof layer.getLatLngs !== "function") return false;
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

  // --- Highlight: reuses the same outline technique as selectItem/deselectCurrentItem ---

  function applyHighlight(layer) {
    const highlightColor = getHighlightColor();
    if (layer instanceof L.Marker) {
      if (!markerOutlines.has(layer)) {
        const outlineMarker = L.marker(layer.getLatLng(), {
          icon: createMarkerIcon(highlightColor, 1, STYLE_CONFIG.marker.baseSize, 0, true),
          zIndexOffset: 1001,
          interactive: false,
        });
        if (!layer.isManuallyHidden && map.hasLayer(layer)) outlineMarker.addTo(map);
        markerOutlines.set(layer, outlineMarker);
      }
      layer.setIcon(createMarkerIcon(highlightColor, STYLE_CONFIG.marker.highlight.opacity));
      layer.setZIndexOffset(1000);
      return;
    }

    if (!pathOutlines.has(layer)) {
      const outline = STYLE_CONFIG.path.highlight.outline;
      const outlineLayer =
        layer instanceof L.Polygon
          ? L.polygon(layer.getLatLngs()[0], {
              color: highlightColor,
              weight: STYLE_CONFIG.path.highlight.weight + outline.weightOffset,
              opacity: STYLE_CONFIG.path.highlight.opacity,
              interactive: false,
              fill: true,
              fillColor: highlightColor,
              fillOpacity: outline.fillOpacity,
            })
          : L.polyline(layer.getLatLngs(), {
              color: highlightColor,
              weight: STYLE_CONFIG.path.highlight.weight + outline.weightOffset,
              opacity: STYLE_CONFIG.path.highlight.opacity,
              interactive: false,
            });
      if (!layer.isManuallyHidden && map.hasLayer(layer)) outlineLayer.addTo(map).bringToFront();
      pathOutlines.set(layer, outlineLayer);
    }
    layer.setStyle({ ...STYLE_CONFIG.path.highlight, color: highlightColor });
    layer.bringToFront();
  }

  function clearHighlight(layer) {
    const color = layer.feature?.properties?.color || DEFAULT_COLOR;
    if (layer instanceof L.Marker) {
      const outlineMarker = markerOutlines.get(layer);
      if (outlineMarker) {
        map.removeLayer(outlineMarker);
        markerOutlines.delete(layer);
      }
      layer.setIcon(createMarkerIcon(color, STYLE_CONFIG.marker.default.opacity));
      layer.setZIndexOffset(0);
      return;
    }
    const outlineLayer = pathOutlines.get(layer);
    if (outlineLayer) {
      map.removeLayer(outlineLayer);
      pathOutlines.delete(layer);
    }
    layer.setStyle({ ...STYLE_CONFIG.path.default, color: color });
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
    copyAction.classList.toggle("leaflet-disabled", !hasSelection);
    if (hasSelection) {
      visibilityAction.textContent = anySelectedVisible() ? "Hide" : "Show";
    }
  }

  function setSelection(newSet) {
    selectedLayers.forEach((layer) => {
      if (!newSet.has(layer)) clearHighlight(layer);
    });
    newSet.forEach((layer) => {
      if (!selectedLayers.has(layer)) applyHighlight(layer);
    });
    selectedLayers.clear();
    newSet.forEach((layer) => selectedLayers.add(layer));
    syncOverviewHighlight();
    updateActionButtonsState();
  }

  function clearSelection() {
    setSelection(new Set());
  }

  // Called whenever a layer we're tracking gets deleted or duplicated through a
  // different path (e.g. the overview panel's own row buttons). Rather than try
  // to keep partial selection state in sync, just exit the tool entirely - the
  // simplest option that can't leave a stale outline or a half-active tool behind.
  function removeFromSelection(layer) {
    if (selectedLayers.has(layer)) exitSelectMode();
  }

  // Called whenever any layer's visibility changes through any path (our own
  // bulk action, or the overview panel's own row button). Unlike delete/duplicate,
  // visibility doesn't change a layer's identity, so we keep the tool and
  // selection active - but we do keep our own outline's visibility in sync with
  // the real layer's, so hiding an item hides its highlight too instead of
  // leaving a ghost outline behind, and refresh the Hide/Show label/disabled
  // state so it can't go stale relative to what actually happened.
  function refreshIfTracked(layer) {
    if (!selectedLayers.has(layer)) return;
    const outline = layer instanceof L.Marker ? markerOutlines.get(layer) : pathOutlines.get(layer);
    if (outline) {
      // Group-level show/hide (category header, layers panel) adds/removes every
      // member regardless of its own isManuallyHidden flag, so map.hasLayer(layer)
      // alone isn't enough - an item the user hid individually must stay hidden
      // even if its whole group gets shown again. Match how the app's existing
      // single-select outline already handles this in window.onOverlayToggle.
      const shouldShow = !layer.isManuallyHidden && map.hasLayer(layer);
      const isShown = map.hasLayer(outline);
      if (shouldShow && !isShown) {
        outline.addTo(map);
        if (!(layer instanceof L.Marker)) outline.bringToFront();
      } else if (!shouldShow && isShown) {
        map.removeLayer(outline);
      }
    }
    updateActionButtonsState();
  }

  // Called whenever a whole layer-group's visibility is toggled (the overview
  // panel's category header, or the layers panel checkbox) - neither goes
  // through toggleLayerVisibility() for each individual item, so refreshIfTracked
  // never fires for them on its own. Find any of our tracked layers that belong
  // to the toggled group (including nested GeoJSON sub-groups, same as
  // toggleLayerVisibility's own check) and refresh those specifically.
  function refreshGroupMembers(group) {
    if (!group || typeof group.hasLayer !== "function") return;
    selectedLayers.forEach((layer) => {
      if (group.hasLayer(layer)) {
        refreshIfTracked(layer);
        return;
      }
      if (typeof group.eachLayer === "function") {
        group.eachLayer((child) => {
          if (child instanceof L.GeoJSON && child.hasLayer(layer)) {
            refreshIfTracked(layer);
          }
        });
      }
    });
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
    // Rebuilds every row (so each one's own eye icon reflects its new state),
    // which also discards our rectangle-selected highlighting on the old row
    // elements - re-apply it against the freshly rebuilt rows.
    updateOverviewList();
    syncOverviewHighlight();
    updateActionButtonsState();
  }

  function performBulkDelete() {
    if (selectedLayers.size === 0) return;
    const toDelete = Array.from(selectedLayers);
    clearSelection();
    toDelete.forEach((layer) => deleteLayerImmediately(layer));
    exitSelectMode();
  }

  function performBulkCopy() {
    if (selectedLayers.size === 0) return;
    const toDuplicate = Array.from(selectedLayers);
    clearSelection();
    toDuplicate.forEach((layer) => duplicateLayer(layer));
    // duplicateLayer() single-selects each new copy as it's created, so the last
    // one would otherwise linger as globallySelectedItem after we exit.
    deselectCurrentItem();
    exitSelectMode();
  }

  // --- Mode lifecycle ---

  function hasAnyItems() {
    return (
      editableLayers.getLayers().length > 0 ||
      stravaActivitiesLayer.getLayers().length > 0 ||
      importedItems.getLayers().length > 0
    );
  }

  function setOtherModeActive(active) {
    otherModeActive = active;
  }

  function enterSelectMode() {
    if (otherModeActive || isActive || !hasAnyItems()) return;
    deselectCurrentItem();
    isActive = true;
    button.classList.add("active");
    map.dragging.disable();
    map.getContainer().classList.add("rectangle-select-cursor");
    document.addEventListener("touchstart", preventTouchScroll, { passive: false });
    actionsList.style.display = "block";
    updateActionButtonsState();
  }

  function exitSelectMode() {
    if (!isActive) return;
    isActive = false;
    button.classList.remove("active");
    map.dragging.enable();
    map.getContainer().classList.remove("rectangle-select-cursor");
    document.removeEventListener("touchstart", preventTouchScroll);
    actionsList.style.display = "none";
    L.DomEvent.off(document, "mouseup", onMouseUp).off(document, "touchend", onMouseUp);
    if (tempRectangle) {
      map.removeLayer(tempRectangle);
      tempRectangle = null;
    }
    isDragging = false;
    clearSelection();
  }

  // --- Drag handling: mirrors L.Draw.SimpleShape (leaflet-draw-1.0.4) so touch works ---

  function pixelDistance(latlng1, latlng2) {
    const p1 = map.latLngToContainerPoint(latlng1);
    const p2 = map.latLngToContainerPoint(latlng2);
    return p1.distanceTo(p2);
  }

  function onMouseDown(e) {
    if (!isActive) return;
    isDragging = true;
    dragStartLatLng = e.latlng;
    L.DomEvent.on(document, "mouseup", onMouseUp).on(document, "touchend", onMouseUp);
    L.DomEvent.preventDefault(e.originalEvent);
  }

  function onMouseMove(e) {
    if (!isDragging) return;
    const bounds = L.latLngBounds(dragStartLatLng, e.latlng);
    if (!tempRectangle) {
      tempRectangle = L.rectangle(bounds, {
        color: getHighlightColor(),
        weight: 4,
        dashArray: "6,6",
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(map);
    } else {
      tempRectangle.setBounds(bounds);
    }
  }

  function onMouseUp(e) {
    isDragging = false;
    L.DomEvent.off(document, "mouseup", onMouseUp).off(document, "touchend", onMouseUp);

    if (!tempRectangle) {
      clearSelection();
      return;
    }
    const bounds = tempRectangle.getBounds();
    map.removeLayer(tempRectangle);
    tempRectangle = null;

    if (pixelDistance(bounds.getNorthWest(), bounds.getSouthEast()) < DRAG_THRESHOLD_PX) {
      clearSelection();
      return;
    }

    const matched = getCandidateLayers().filter((layer) => layerIntersectsBounds(layer, bounds));
    const newSet = e.shiftKey ? new Set(selectedLayers) : new Set();
    matched.forEach((layer) => newSet.add(layer));
    setSelection(newSet);
  }

  function onKeyDown(e) {
    if (!isActive) return;
    if (e.target.matches("input, textarea")) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selectedLayers.size > 0) {
      e.preventDefault();
      performBulkDelete();
    } else if (e.key === "Escape") {
      exitSelectMode();
    }
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
        container.title = "Select multiple items (drag a rectangle on the map)";
        container.style.position = "relative";
        container.innerHTML =
          '<a href="#" role="button"><span class="material-symbols">ink_selection</span></a>';

        actionsList = L.DomUtil.create("ul", "leaflet-draw-actions", container);
        const visibilityLi = L.DomUtil.create("li", "", actionsList);
        visibilityAction = L.DomUtil.create("a", "leaflet-disabled", visibilityLi);
        visibilityAction.href = "#";
        visibilityAction.title = "Show/hide selected items";
        visibilityAction.textContent = "Hide";
        const deleteLi = L.DomUtil.create("li", "", actionsList);
        deleteAction = L.DomUtil.create("a", "leaflet-disabled", deleteLi);
        deleteAction.href = "#";
        deleteAction.title = "Delete selected items";
        deleteAction.textContent = "Delete";
        const copyLi = L.DomUtil.create("li", "", actionsList);
        copyAction = L.DomUtil.create("a", "leaflet-disabled", copyLi);
        copyAction.href = "#";
        copyAction.title = "Duplicate selected items";
        copyAction.textContent = "Duplicate";
        const doneLi = L.DomUtil.create("li", "", actionsList);
        doneAction = L.DomUtil.create("a", "", doneLi);
        doneAction.href = "#";
        doneAction.title = "Close (keeps any changes already made)";
        doneAction.textContent = "Done";

        L.DomEvent.on(container, "click", (ev) => {
          L.DomEvent.stop(ev);
          if (isActive) {
            exitSelectMode();
          } else {
            enterSelectMode();
          }
        });
        L.DomEvent.on(visibilityAction, "click", (ev) => {
          L.DomEvent.stop(ev);
          performBulkVisibilityToggle();
        });
        L.DomEvent.on(copyAction, "click", (ev) => {
          L.DomEvent.stop(ev);
          performBulkCopy();
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

    map
      .on("mousedown", onMouseDown)
      .on("mousemove", onMouseMove)
      .on("touchstart", onMouseDown)
      .on("touchmove", onMouseMove);
    document.addEventListener("keydown", onKeyDown);

    map.on(L.Draw.Event.DRAWSTART, () => {
      exitSelectMode();
      setOtherModeActive(true);
    });
    map.on(L.Draw.Event.DRAWSTOP, () => setOtherModeActive(false));
    map.on(L.Draw.Event.EDITSTART, () => {
      exitSelectMode();
      setOtherModeActive(true);
    });
    map.on(L.Draw.Event.EDITSTOP, () => setOtherModeActive(false));
    map.on(L.Draw.Event.DELETESTART, () => {
      exitSelectMode();
      setOtherModeActive(true);
    });
    map.on(L.Draw.Event.DELETESTOP, () => setOtherModeActive(false));
  }

  window.app = window.app || {};
  window.app.initRectangleSelect = initRectangleSelect;
  window.app.removeFromRectangleSelection = removeFromSelection;
  window.app.notifyRectangleSelectionVisibilityChange = refreshIfTracked;
  window.app.refreshRectangleSelectionGroupMembers = refreshGroupMembers;
})();
