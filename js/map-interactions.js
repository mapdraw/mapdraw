// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

let elevationHoverMarker = null;
let downloadButtonsCache = null;
window.mapInteractions = {};

/**
 * Displays or moves a temporary circle marker on the map when hovering over the elevation profile.
 * @param {L.LatLng} latlng - The geographical coordinate to show the marker at
 */
window.mapInteractions.showElevationMarker = function (latlng) {
  if (!latlng) return;

  const markerStyle = {
    color: "var(--color-white)",
    weight: 2,
    fillColor: "var(--highlight-color)",
    fillOpacity: 1,
    radius: 6,
  };

  if (elevationHoverMarker) {
    elevationHoverMarker.setLatLng(latlng);
  } else {
    elevationHoverMarker = L.circleMarker(latlng, markerStyle).addTo(map);
  }
  elevationHoverMarker.bringToFront();
};

/**
 * Removes the temporary elevation hover marker from the map.
 */
window.mapInteractions.hideElevationMarker = function () {
  if (elevationHoverMarker) {
    map.removeLayer(elevationHoverMarker);
    elevationHoverMarker = null;
  }
};

/**
 * Creates a Leaflet divIcon for map markers using Material Symbols.
 * @param {string} color - CSS color value
 * @param {number} opacity - Opacity value (0-1)
 * @param {number} [size] - Icon size in pixels
 * @param {number} [anchorOffsetY] - Vertical anchor offset for outline effect
 * @param {boolean} [isOutline] - Whether to render as outline style
 * @returns {L.DivIcon} Configured marker icon
 */
function createMarkerIcon(
  color,
  opacity,
  size = STYLE_CONFIG.marker.baseSize,
  anchorOffsetY = 0,
  isOutline = false,
) {
  const fillClass = isOutline ? "material-symbols-map-marker-outline" : "material-symbols-fill";

  return L.divIcon({
    html: `<span class="material-symbols ${fillClass} material-symbols-map-marker" style="font-size: ${size}px; color: ${color}; opacity: ${opacity}; line-height: 1;">location_on</span>`,
    className: "map-marker-icon",
    iconSize: [size, size],
    iconAnchor: [size / 2, size * 0.9 + anchorOffsetY],
    popupAnchor: [0, -30],
  });
}

/**
 * Resets a layer to its saved/default color and style, undoing any selection or highlight state.
 * @param {L.Layer} layer - The Leaflet layer to reset
 */
function resetLayerStyle(layer) {
  const color = layer.feature?.properties?.color || DEFAULT_COLOR;
  if (layer instanceof L.Marker) {
    layer.setIcon(createMarkerIcon(color, STYLE_CONFIG.marker.default.opacity));
    layer.setZIndexOffset(0);
  } else {
    layer.setStyle({ ...STYLE_CONFIG.path.default, color });
  }
}

/**
 * Applies the selection-highlight color/z-index to a layer. Mirror image of
 * resetLayerStyle(); shared by single-select (selectItem()) and the
 * rectangle-select tool so both highlight identically.
 * @param {L.Layer} layer - The Leaflet layer to highlight
 * @param {string} highlightColor - The color to highlight with
 */
function applyLayerHighlight(layer, highlightColor) {
  if (layer instanceof L.Marker) {
    layer.setIcon(createMarkerIcon(highlightColor, STYLE_CONFIG.marker.highlight.opacity));
    layer.setZIndexOffset(1000);
  } else {
    layer.setStyle({ ...STYLE_CONFIG.path.highlight, color: highlightColor });
    layer.bringToFront();
  }
}

/**
 * Keeps the marker outline synchronized with its parent marker during drag operations.
 */
function updateMarkerOutlinePosition() {
  if (globallySelectedItem instanceof L.Marker && selectedMarkerOutline) {
    selectedMarkerOutline.setLatLng(globallySelectedItem.getLatLng());
  }
}

/**
 * Returns the single selected layer, whether it came from a normal single
 * click or the rectangle-select tool's single-item selection - the info panel
 * displays both the same way (e.g. the editable name field), so consumers
 * that only checked globallySelectedItem need this fallback too.
 * @returns {L.Layer|null}
 */
function getEffectiveSelectedLayer() {
  return globallySelectedItem || window.app?.getRectangleSelectionSingleLayer?.() || null;
}

/**
 * Returns whatever is currently selected as an array of layers, regardless of
 * whether the selection came from a normal single click or the rectangle-select
 * tool (the two are mutually exclusive, so only one of these is ever non-empty).
 * @returns {L.Layer[]}
 */
function getCurrentSelectionLayers() {
  const rectLayers = window.app?.getRectangleSelectionLayers?.();
  if (rectLayers && rectLayers.length > 0) {
    // Reorder to match getAllExportableLayers() (used by "All" exports) instead
    // of the rectangle-select tool's selection-order Set, so "Selected" exports
    // list features in the same order as "All" exports.
    const selectedSet = new Set(rectLayers);
    return getAllExportableLayers().filter((layer) => selectedSet.has(layer));
  }
  return globallySelectedItem ? [globallySelectedItem] : [];
}

/**
 * Enables/disables the download menu's "Selected"-scope buttons (GPX,
 * GeoJSON, KML, Share Link) and updates their tooltips and labels to reflect
 * the current selection. Also shows the "Original Strava" row only when the
 * whole selection is Strava activities. Called whenever selection changes,
 * from either selectItem()/deselectCurrentItem() or rectangle-select's
 * setSelection().
 */
function syncSelectedDownloadButtonsState() {
  if (!downloadControl) return;
  if (!downloadButtonsCache) {
    const container = downloadControl.getContainer();
    const gpxBtn = container.querySelector("#download-gpx-selected");
    const geojsonBtn = container.querySelector("#download-geojson-selected");
    const kmlBtn = container.querySelector("#download-kml-selected");
    const shareBtn = container.querySelector("#download-share-selected");
    const stravaRow = container.querySelector("#download-strava-row");
    const stravaBtn = container.querySelector("#download-gpx-strava-original");
    downloadButtonsCache = {
      gpxBtn,
      geojsonBtn,
      kmlBtn,
      shareBtn,
      stravaRow,
      stravaBtn,
    };
  }
  const { gpxBtn, geojsonBtn, kmlBtn, shareBtn, stravaRow, stravaBtn } = downloadButtonsCache;
  const buttons = [gpxBtn, geojsonBtn, kmlBtn, shareBtn];

  const layers = getCurrentSelectionLayers();
  const hasSelection = layers.length > 0;
  buttons.forEach((btn) => {
    btn.disabled = !hasSelection;
    btn.textContent = layers.length > 1 ? `Selected (${layers.length})` : "Selected";
  });

  if (!hasSelection) {
    gpxBtn.title = "Select an item to download as GPX";
    geojsonBtn.title = "Select an item to download as GeoJSON";
    kmlBtn.title = "Select an item to download as KML";
    shareBtn.title = "Select an item to copy a share link for";
    stravaRow.style.display = "none";
    return;
  }

  gpxBtn.title = "Download the selection as GPX";
  geojsonBtn.title = "Download the selection as GeoJSON";
  kmlBtn.title = "Download the selection as KML";
  shareBtn.title = "Copy a share link for the selection";

  const allStrava = layers.every((layer) => layer.feature?.properties?.pathType === "strava");
  stravaRow.style.display = allStrava ? "" : "none";
  if (allStrava) {
    stravaBtn.textContent =
      layers.length > 1 ? `Original Strava (${layers.length})` : "Original Strava";
    stravaBtn.title =
      layers.length === 1
        ? "Download the original GPX file from Strava"
        : "Download original GPX files from Strava";
  }
}

/**
 * Clicking empty map background (not a layer/marker/control) deselects the
 * current item.
 */
function initClickToDeselect() {
  map.on("click", (e) => {
    if (
      e.originalEvent.target.id === "map" ||
      e.originalEvent.target.classList.contains("leaflet-container")
    ) {
      deselectCurrentItem();
    }
  });
}

/**
 * Delete/Backspace deletes the currently selected item, unless focus is in
 * a text field.
 */
function initDeleteKeyShortcut() {
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    if ((e.key === "Delete" || e.key === "Backspace") && globallySelectedItem) {
      e.preventDefault();
      deleteLayerImmediately(globallySelectedItem);
    }
  });
}

/**
 * Deselects the currently selected item and cleans up all associated UI elements
 * (outlines, elevation profile, info panel, etc.).
 */
function deselectCurrentItem({ skipControlUpdate = false } = {}) {
  // Any deselection - explicit or as part of selecting something else - invalidates a
  // pending "reselect the item that was just being edited" timer (draw-tools.js), so it
  // never overwrites whatever the selection state actually is by the time it fires.
  window.app?.cancelPendingReselect?.();
  if (window.mapInteractions) window.mapInteractions.hideElevationMarker();

  if (temporarySearchMarker) {
    map.removeLayer(temporarySearchMarker);
    temporarySearchMarker = null;
  }

  if (selectedPathOutline) {
    map.removeLayer(selectedPathOutline);
    selectedPathOutline = null;
  }
  if (selectedMarkerOutline) {
    map.removeLayer(selectedMarkerOutline);
    selectedMarkerOutline = null;
  }
  // While editing, distance labels belong to EDITSTART/EDITSTOP, not selection -
  // an incidental deselect (e.g. clicking empty map) shouldn't clear them.
  if (!isEditMode) hideDistanceLabels();

  if (!globallySelectedItem) return;

  if (globallySelectedItem instanceof L.Marker) {
    globallySelectedItem.off("drag", updateMarkerOutlinePosition);
  }

  const overlayPane = document.querySelector(".leaflet-overlay-pane");
  if (overlayPane) {
    overlayPane.style.zIndex = 400;
  }

  // Only clears .selected if this layer's row happens to be currently mounted (virtualized
  // to the active category + scrolled-into-view slice) - relies on patchOverviewListItem()
  // recomputing .selected from globallySelectedItem (already null by the time it runs) on
  // whatever render happens to follow this call, rather than guaranteeing it here directly.
  const layerId = L.Util.stamp(globallySelectedItem);
  const listItem = document.querySelector(
    `#overview-panel-list .overview-list-item[data-layer-id='${layerId}']`,
  );
  if (listItem) {
    listItem.classList.remove("selected");
  }

  resetLayerStyle(globallySelectedItem);

  globallySelectedItem = null;
  disableElevation();
  syncSelectedDownloadButtonsState();

  resetInfoPanel();
  if (!skipControlUpdate) updateDrawControlStates();
}

/**
 * Disables and hides the elevation panel - used when nothing is selected, or
 * the current selection doesn't support elevation (a marker or polygon).
 */
function disableElevation() {
  selectedElevationPath = null;
  window.elevationProfile.clearElevationProfile();
  document.getElementById("elevation-div").style.visibility = "hidden";
  isElevationProfileVisible = false;
  updateElevationToggleIconColor();
  setButtonAvailability(
    "elevation-button",
    false,
    "Toggle elevation profile",
    "Select a path to show elevation",
  );
}

/**
 * Enables the elevation toggle for a path layer and re-plots its profile,
 * showing the panel immediately if it was already toggled visible.
 * @param {L.Polyline} layer - The path to show elevation for (must not be a Polygon)
 */
function enableElevationForPath(layer) {
  selectedElevationPath = layer;
  setButtonAvailability(
    "elevation-button",
    true,
    "Toggle elevation profile",
    "Select a path to show elevation",
  );
  const elevationDiv = document.getElementById("elevation-div");
  if (isElevationProfileVisible || elevationDiv.style.visibility === "visible") {
    elevationDiv.style.visibility = "visible";
    isElevationProfileVisible = true;
  }
  window.elevationProfile.clearElevationProfile();
  addElevationProfileForLayer(layer);
}

/**
 * Selects a layer on the map and applies visual highlighting (outline, color change).
 * Updates the info panel, elevation profile, and download button states.
 * @param {L.Layer} layer - The Leaflet layer to select
 */
function selectItem(layer) {
  if (!window.app?.canSelectLayer?.(layer)) return;
  // Unconditional (unlike deselectCurrentItem() below, which only runs when something else
  // was already selected) - a fresh selection with nothing previously selected is exactly the
  // gap a pending post-edit reselect (draw-tools.js) could otherwise land in.
  window.app?.cancelPendingReselect?.();
  if (globallySelectedItem && globallySelectedItem !== layer) {
    const keepElevation =
      isElevationProfileVisible &&
      globallySelectedItem instanceof L.Polyline &&
      !(globallySelectedItem instanceof L.Polygon) &&
      layer instanceof L.Polyline &&
      !(layer instanceof L.Polygon);
    deselectCurrentItem({ skipControlUpdate: true });
    if (keepElevation) isElevationProfileVisible = true;
  }
  globallySelectedItem = layer;

  if (window.activateCategoryForItem) {
    window.activateCategoryForItem(layer);
  }

  // The overview list is virtualized (ui-handlers.js) - most items don't have a DOM row at
  // any given moment, only whatever's currently scrolled into view does. Re-render the
  // current window immediately so an already-visible row picks up .selected right away,
  // same as the original's synchronous classList.add.
  renderOverviewWindow();

  // Scrolling the (possibly not-yet-visible) row into view is deferred to the next frame
  // and only attempted while the tab is actually shown - same guard the original used
  // around its scrollIntoView call.
  if (document.getElementById("overview-panel").classList.contains("active")) {
    requestAnimationFrame(() => {
      scrollOverviewToLayer(layer);
    });
  }

  const highlightColor = layer.feature?.properties?.color || DEFAULT_COLOR;

  showInfoPanel(layer);

  syncSelectedDownloadButtonsState();

  if (layer instanceof L.Polyline || layer instanceof L.Polygon) {
    if (map.hasLayer(layer) && !isEditMode) {
      showDistanceLabelsFor(layer);
    }

    if (layer.feature?.properties?.pathType !== "route") {
      // Raising the overlay pane above the marker pane (600) makes the selected
      // path draw over unrelated markers - but the overlay pane is shared by
      // every path on the map, and the marker pane also holds leaflet-draw's own
      // vertex handles while a draw session is active. Applying it right away
      // would bury an in-progress path/area's own points under every path line,
      // unclickable, with no way to finish the shape - so defer the check by a
      // tick. A selectItem() reached from an unrelated overview-panel click
      // mid-draw still sees "leaflet-is-drawing" true then and correctly skips
      // it; one reached from a draw session's own draw:created handler (which
      // runs its selectItem() before the synchronous handler.disable() call
      // that removes the class) sees it already gone and elevates normally.
      setTimeout(() => {
        // Also bail if the selection has already moved on by the time this runs
        // (e.g. immediately reselected/deselected) - only the current selection
        // should ever get elevated.
        if (document.body.classList.contains("leaflet-is-drawing")) return;
        if (globallySelectedItem !== layer) return;
        const overlayPane = document.querySelector(".leaflet-overlay-pane");
        if (overlayPane) {
          overlayPane.style.zIndex = 601;
        }
      }, 0);
    }

    const { outline } = STYLE_CONFIG.path.highlight;
    if (outline.enabled) {
      if (selectedPathOutline) {
        map.removeLayer(selectedPathOutline);
      }
      // Use L.polygon for polygons to ensure the closing line has an outline
      if (layer instanceof L.Polygon) {
        selectedPathOutline = L.polygon(layer.getLatLngs()[0], {
          color: outline.color,
          weight: STYLE_CONFIG.path.highlight.weight + outline.weightOffset,
          opacity: STYLE_CONFIG.path.highlight.opacity,
          interactive: false,
          fill: true,
          fillColor: highlightColor,
          fillOpacity: outline.fillOpacity,
        });
      } else {
        selectedPathOutline = L.polyline(layer.getLatLngs(), {
          color: outline.color,
          weight: STYLE_CONFIG.path.highlight.weight + outline.weightOffset,
          opacity: STYLE_CONFIG.path.highlight.opacity,
          interactive: false,
        });
      }
      if (map.hasLayer(layer) && !isEditMode) {
        selectedPathOutline.addTo(map).bringToFront();
      }
    }

    applyLayerHighlight(layer, highlightColor);

    // Only enable elevation for polylines, not polygons
    if (isPathLayer(layer)) {
      enableElevationForPath(layer);
    }
  } else if (layer instanceof L.Marker) {
    const { outline } = STYLE_CONFIG.marker.highlight;
    if (outline.enabled) {
      if (selectedMarkerOutline) {
        map.removeLayer(selectedMarkerOutline);
      }

      const outlineSize = STYLE_CONFIG.marker.baseSize;

      selectedMarkerOutline = L.marker(layer.getLatLng(), {
        icon: createMarkerIcon(outline.color, 1, outlineSize, 0, true),
        zIndexOffset: 1001,
        interactive: false,
      });

      if (map.hasLayer(layer) && !isEditMode) {
        selectedMarkerOutline.addTo(map);
      }
    }

    applyLayerHighlight(layer, highlightColor);

    layer.on("drag", updateMarkerOutlinePosition);
  }

  updateElevationToggleIconColor();
  updateDrawControlStates();
}

/**
 * Enables or disables a custom toolbar button (by element id), updating its
 * "disabled" class and tooltip to match.
 * @param {string} elementId - The id of the button's container element.
 * @param {boolean} enabled - Whether the button should be enabled.
 * @param {string} enabledTitle - Tooltip to show while enabled.
 * @param {string} disabledTitle - Tooltip to show while disabled.
 */
function setButtonAvailability(elementId, enabled, enabledTitle, disabledTitle) {
  const container = document.getElementById(elementId);
  if (!container) return;
  if (enabled) {
    L.DomUtil.removeClass(container, "disabled");
    container.title = enabledTitle;
  } else {
    L.DomUtil.addClass(container, "disabled");
    container.title = disabledTitle;
  }
}

/**
 * Updates the state of edit controls and layer toggles based on available layers
 * and current edit mode status.
 */
function updateDrawControlStates() {
  if (!drawControl) return;
  window.app?.pruneRectangleSelection?.();
  if (!editControlContainer) {
    editControlContainer = drawControl.getContainer().querySelector(".leaflet-draw-edit-edit");
  }

  const hasLayers = window.app?.hasAnyItems?.() ?? false;

  setButtonAvailability(
    "download-button",
    hasLayers,
    "Download or share",
    "No items to download or share",
  );
  setButtonAvailability(
    "rectangle-select-button",
    hasLayers,
    "Click or drag to select multiple items",
    "No items to select",
  );

  const hasEditableLayers = editableLayers.getLayers().length > 0;
  // Single-item edit mode - Edit only ever gives handles to the selected item
  // (leaflet-draw-patches.js), so the button should look inert without a valid selection too.
  // While a session is active, EDITSTART has already deselected globallySelectedItem, so check
  // itemBeingEdited instead - otherwise the button shows active (blue) and disabled (transparent)
  // at once as soon as Edit mode starts.
  const relevantSelection = isEditMode ? itemBeingEdited : globallySelectedItem;
  // editableLayers.hasLayer() already implies hasEditableLayers - no need to check both.
  const canEditSelection = relevantSelection && editableLayers.hasLayer(relevantSelection);

  if (editControlContainer) {
    if (canEditSelection) {
      L.DomUtil.removeClass(editControlContainer, "leaflet-disabled");
    } else {
      L.DomUtil.addClass(editControlContainer, "leaflet-disabled");
    }
    // _checkDisabled() (leaflet-draw's own toggle) only reacts to layeradd/layerremove and
    // only knows "any layers exist", not selection - own the title here too so all three
    // states (nothing to edit / nothing selected / editing one item) get their own message
    // instead of leaflet-draw's stale "Edit layers", a leftover from before single-item edit.
    editControlContainer.title = !hasEditableLayers
      ? L.drawLocal.edit.toolbar.buttons.editDisabled
      : canEditSelection
        ? "Edit selected item"
        : "Select an item in the Drawn Items layer to edit";
  }
}
/**
 * Deletes a layer and its associated data immediately from all groups and the UI.
 * @param {L.Layer} layer - The layer to be deleted.
 * @param {{skipUiUpdate?: boolean}} [options] - Pass skipUiUpdate when deleting
 *   many layers in a row, so the caller can refresh the UI once at the end
 *   instead of rebuilding the whole overview panel after every single layer.
 */
function deleteLayerImmediately(layer, { skipUiUpdate = false } = {}) {
  if (!layer) return;

  // If the layer being deleted is the active route, we must call the dedicated
  // clearRouting function. This ensures the routing markers and panel are
  // also cleared, not just the route line.
  if (layer === currentRoutePath) {
    // This function is exposed on window.app from routing.js and handles all cleanup.
    if (window.app && typeof window.app.clearRouting === "function") {
      window.app.clearRouting({ skipUiUpdate });
    }
    return;
  }

  if (globallySelectedItem === layer) {
    deselectCurrentItem();
  }

  Object.values(displayLayerGroups).forEach((group) => {
    if (group.hasLayer(layer)) {
      group.removeLayer(layer);
    } else {
      group.eachLayer((geoJsonGroup) => {
        if (geoJsonGroup instanceof L.GeoJSON && geoJsonGroup.hasLayer(layer)) {
          geoJsonGroup.removeLayer(layer);
        }
      });
    }
  });

  // Also remove it from the master editable layer group if it's there
  if (editableLayers.hasLayer(layer)) {
    editableLayers.removeLayer(layer);
  }

  // Must run after the removals above - it checks group membership to decide
  // what's still selectable, so it needs to see the layer already gone.
  window.app.pruneRectangleSelection({ skipUiUpdate });

  if (skipUiUpdate) return;

  updateDrawControlStates();
  updateOverviewList();
}
