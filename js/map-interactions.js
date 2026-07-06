// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

let elevationHoverMarker = null;
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
    className: "svg-marker-icon",
    iconSize: [size, size],
    iconAnchor: [size / 2, size * 0.9 + anchorOffsetY],
    popupAnchor: [0, -30],
  });
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
 * Deselects the currently selected item and cleans up all associated UI elements
 * (outlines, elevation profile, info panel, etc.).
 */
function deselectCurrentItem() {
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

  if (!globallySelectedItem) return;

  if (globallySelectedItem instanceof L.Marker) {
    globallySelectedItem.off("drag", updateMarkerOutlinePosition);
  }

  const overlayPane = document.querySelector(".leaflet-overlay-pane");
  if (overlayPane) {
    overlayPane.style.zIndex = 400;
  }

  const layerId = L.Util.stamp(globallySelectedItem);
  const listItem = document.querySelector(
    `#overview-panel-list .overview-list-item[data-layer-id='${layerId}']`,
  );
  if (listItem) {
    listItem.classList.remove("selected");
  }

  const item = globallySelectedItem;
  const color = item.feature?.properties?.color || DEFAULT_COLOR;
  if (item instanceof L.Polyline || item instanceof L.Polygon) {
    item.setStyle({ ...STYLE_CONFIG.path.default, color: color });
  } else if (item instanceof L.Marker) {
    item.setIcon(createMarkerIcon(color, STYLE_CONFIG.marker.default.opacity));
    item.setZIndexOffset(0);
  }

  globallySelectedItem = null;
  selectedElevationPath = null;
  window.elevationProfile.clearElevationProfile();
  document.getElementById("elevation-div").style.visibility = "hidden";
  isElevationProfileVisible = false;
  updateElevationToggleIconColor();
  elevationToggleControl.getContainer().title = "Select a path to show elevation";
  L.DomUtil.addClass(elevationToggleControl.getContainer(), "disabled");

  const downloadContainer = downloadControl.getContainer();
  const gpxButton = downloadContainer.querySelector("#download-gpx-single");
  const geojsonButton = downloadContainer.querySelector("#download-geojson-single");

  gpxButton.disabled = true;
  gpxButton.textContent = "GPX (Selected Item)";
  gpxButton.title = "Select an item to download as GPX";

  geojsonButton.disabled = true;
  geojsonButton.textContent = "GeoJSON (Selected Item)";
  geojsonButton.title = "Select an item to download as GeoJSON";

  resetInfoPanel();
}

/**
 * Selects a layer on the map and applies visual highlighting (outline, color change).
 * Updates the info panel, elevation profile, and download button states.
 * @param {L.Layer} layer - The Leaflet layer to select
 */
function selectItem(layer) {
  if (
    isDeleteMode ||
    isEditMode ||
    window.app?.isRectangleSelectActive?.() ||
    window.app?.isPenModeActive?.() ||
    window.app?.isRoutePointSelectionModeActive?.()
  )
    return;
  if (globallySelectedItem && globallySelectedItem !== layer) {
    const keepElevation =
      isElevationProfileVisible &&
      globallySelectedItem instanceof L.Polyline &&
      !(globallySelectedItem instanceof L.Polygon) &&
      layer instanceof L.Polyline &&
      !(layer instanceof L.Polygon);
    deselectCurrentItem();
    if (keepElevation) isElevationProfileVisible = true;
  }
  globallySelectedItem = layer;

  const layerId = L.Util.stamp(layer);
  if (window.expandCategoryForItem) {
    window.expandCategoryForItem(layer);
  }

  const newListItem = document.querySelector(
    `#overview-panel-list .overview-list-item[data-layer-id='${layerId}']`,
  );
  if (newListItem) {
    newListItem.classList.add("selected");
    if (document.getElementById("overview-panel").classList.contains("active")) {
      requestAnimationFrame(() => {
        newListItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  }

  const highlightColor = layer.feature?.properties?.color || DEFAULT_COLOR;

  showInfoPanel(layer);

  if (downloadControl) {
    const gpxButton = downloadControl.getContainer().querySelector("#download-gpx-single");
    const geojsonButton = downloadControl.getContainer().querySelector("#download-geojson-single");
    gpxButton.disabled = false;
    geojsonButton.disabled = false;

    const itemType =
      layer instanceof L.Marker ? "Marker" : layer instanceof L.Polygon ? "Area" : "Path";

    // Only show 'Original' label for live Strava activities; imported items are labeled as regular paths/markers.
    if (layer.pathType === "strava") {
      gpxButton.textContent = `GPX (Original from Strava)`;
      gpxButton.title = `Download original GPX from Strava`;
    } else {
      gpxButton.textContent = `GPX (Selected ${itemType})`;
      gpxButton.title = `Download selected ${itemType.toLowerCase()} as GPX`;
    }

    // GeoJSON button label
    geojsonButton.textContent = `GeoJSON (Selected ${itemType})`;
    geojsonButton.title = `Download selected ${itemType.toLowerCase()} as GeoJSON`;
  }

  if (layer instanceof L.Polyline || layer instanceof L.Polygon) {
    if (layer.pathType !== "route") {
      const overlayPane = document.querySelector(".leaflet-overlay-pane");
      if (overlayPane) {
        overlayPane.style.zIndex = 601;
      }
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

    layer.setStyle({ ...STYLE_CONFIG.path.highlight, color: highlightColor });
    layer.bringToFront();

    // Only enable elevation for polylines, not polygons
    if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
      selectedElevationPath = layer;
      if (elevationToggleControl) {
        elevationToggleControl.getContainer().title = "Toggle elevation profile";
        L.DomUtil.removeClass(elevationToggleControl.getContainer(), "disabled");
      }
      const elevationDiv = document.getElementById("elevation-div");
      if (isElevationProfileVisible || elevationDiv.style.visibility === "visible") {
        elevationDiv.style.visibility = "visible";
        isElevationProfileVisible = true;
      }
      window.elevationProfile.clearElevationProfile();
      addElevationProfileForLayer(layer);
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

    layer.setIcon(createMarkerIcon(highlightColor, STYLE_CONFIG.marker.highlight.opacity));
    layer.setZIndexOffset(1000);

    layer.on("drag", updateMarkerOutlinePosition);
  }

  updateElevationToggleIconColor();
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
 * Updates the state of edit/delete controls and layer toggles based on available layers
 * and current edit/delete mode status.
 */
function updateDrawControlStates() {
  if (!drawControl) return;
  window.app?.pruneRectangleSelection?.();
  if (!editControlContainer) {
    editControlContainer = drawControl.getContainer().querySelector(".leaflet-draw-edit");
    deleteControlContainer = drawControl.getContainer().querySelector(".leaflet-draw-edit-remove");
  }

  const hasLayers =
    editableLayers.getLayers().length > 0 ||
    stravaActivitiesLayer.getLayers().length > 0 ||
    importedItems.getLayers().length > 0 ||
    currentRoutePath !== null;

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

  if (editControlContainer && deleteControlContainer) {
    if (hasEditableLayers) {
      L.DomUtil.removeClass(editControlContainer, "leaflet-disabled");
      L.DomUtil.removeClass(deleteControlContainer, "leaflet-disabled");
    } else {
      L.DomUtil.addClass(editControlContainer, "leaflet-disabled");
      L.DomUtil.addClass(deleteControlContainer, "leaflet-disabled");
    }
  }

  const layerSelectors = document.querySelectorAll(
    "#custom-layers-panel .leaflet-control-layers-selector",
  );
  if (isEditMode || isDeleteMode) {
    layerSelectors.forEach((selector) => {
      L.DomUtil.addClass(selector, "leaflet-disabled-interaction");
      selector.disabled = true;
    });
  } else {
    layerSelectors.forEach((selector) => {
      L.DomUtil.removeClass(selector, "leaflet-disabled-interaction");
      selector.disabled = false;
    });
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
      window.app.clearRouting();
    }
    return;
  }

  if (globallySelectedItem === layer) {
    deselectCurrentItem();
  }

  [drawnItems, importedItems, stravaActivitiesLayer].forEach((group) => {
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
  if (window.app && typeof window.app.removeFromRectangleSelection === "function") {
    window.app.removeFromRectangleSelection(layer);
  }

  if (layer === currentRoutePath) {
    currentRoutePath = null;
  }

  if (skipUiUpdate) return;

  updateDrawControlStates();
  updateOverviewList();
}

/**
 * Click handler for features during delete mode. Visually hides the layer
 * while keeping it in editableLayers for Leaflet.Draw to manage.
 */
const onFeatureClickToDelete = function (e) {
  if (this === globallySelectedItem) {
    deselectCurrentItem();
  }

  map.removeLayer(this);
  this.isDeletedFromToolbar = true;
  L.DomEvent.stop(e);
};
