// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Layer Control Panel
// The custom layers panel: base/overlay layer lists, sortable custom overlay
// ordering (persisted z-index), and the toggle button that opens it.

/**
 * Builds the custom layer control panel and its toggle button.
 * @param {Object<string, L.Layer>} baseMaps - Basemap tile layers, from initMapView()
 */
function initLayerControlPanel(baseMaps) {
  const layerDisplayNames = {
    ...Object.fromEntries(BASEMAP_CONFIG.map((b) => [b.key, `${b.icon} ${b.label}`])),
    ...Object.fromEntries(OVERLAY_CONFIG.map((o) => [o.key, `${o.icon} ${o.label}`])),
    DrawnItems: '<span class="material-symbols layer-icon">edit</span> Drawn Items',
    ImportedFiles: '<span class="material-symbols layer-icon">folder_open</span> Imported Files',
    StravaActivities:
      '<span class="material-symbols layer-icon">directions_run</span> Strava Activities',
    FoundPlaces: '<span class="material-symbols layer-icon">location_on</span> Found Places',
  };

  const allOverlayMaps = {
    DrawnItems: drawnItems,
    ImportedFiles: importedItems,
    StravaActivities: stravaActivitiesLayer,
    FoundPlaces: poiMasterLayer,
    ...Object.fromEntries(OVERLAY_CONFIG.map((o) => [o.key, L.tileLayer(o.url, o.tileOptions)])),
  };

  const LayersToggleControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd: function (map) {
      const container = L.DomUtil.create(
        "div",
        "leaflet-bar leaflet-control leaflet-control-custom",
      );
      container.id = "layers-button";
      container.title = "Layers";
      const link = L.DomUtil.create("a", "", container);
      link.href = "#";
      link.role = "button";
      link.innerHTML = "";

      L.DomEvent.on(link, "click", (e) => {
        L.DomEvent.stop(e);
        const panel = document.getElementById("custom-layers-panel");
        togglePanelMode(
          "layers-panel",
          () => panel.style.display === "block",
          () => (panel.style.display = "block"),
          () => (panel.style.display = "none"),
        );
      });

      return container;
    },
  });

  new LayersToggleControl().addTo(map);

  // Sync layers-button active highlight with panel visibility
  new MutationObserver(() => {
    const panel = document.getElementById("custom-layers-panel");
    const btn = document.getElementById("layers-button");
    if (panel && btn) btn.classList.toggle("active", panel.style.display === "block");
  }).observe(document.getElementById("custom-layers-panel"), {
    attributes: true,
    attributeFilter: ["style"],
  });

  const customPanel = document.getElementById("custom-layers-panel");
  let formContent = '<form class="leaflet-control-layers-form">';

  formContent += '<div class="leaflet-control-layers-base">';
  let firstBaseLayer = true;
  for (const name in baseMaps) {
    const layer = baseMaps[name];
    const layerId = L.Util.stamp(layer);
    const isChecked = firstBaseLayer ? 'checked="checked"' : "";
    const displayName = layerDisplayNames[name] || name;
    formContent += `<label><div><input type="radio" class="leaflet-control-layers-selector" name="leaflet-base-layers" ${isChecked} data-layer-id="${layerId}" data-layer-name="${name}"><span> ${displayName}</span></div></label>`;
    firstBaseLayer = false;
  }
  formContent += "</div>";

  formContent += '<div class="leaflet-control-layers-separator"></div>';

  const tileOverlayNames = OVERLAY_CONFIG.map((o) => o.key);

  const userContentNames = ["DrawnItems", "ImportedFiles", "StravaActivities", "FoundPlaces"];

  const renderOverlayCheckboxes = (names) => {
    for (const name of names) {
      if (allOverlayMaps[name]) {
        const layer = allOverlayMaps[name];
        const layerId = L.Util.stamp(layer);
        const isChecked = map.hasLayer(layer) ? 'checked="checked"' : "";
        const displayName = layerDisplayNames[name] || name;
        formContent += `<label data-layer-name="${name}"><div><input type="checkbox" class="leaflet-control-layers-selector" ${isChecked} data-layer-id="${layerId}" data-layer-name="${name}"><span> ${displayName}</span></div></label>`;
      }
    }
  };

  // User content layers (not sortable, always on top)
  formContent += '<div class="leaflet-control-layers-user-content">';
  renderOverlayCheckboxes(userContentNames);
  formContent += "</div>";

  formContent += '<div class="leaflet-control-layers-separator"></div>';

  formContent += '<div class="leaflet-control-layers-user-content">';
  renderOverlayCheckboxes(tileOverlayNames);
  formContent += "</div>";

  formContent += '<div class="leaflet-control-layers-separator"></div>';

  // Custom overlay layers (sortable) — populated dynamically by WmsImport and XyzImport
  formContent += '<div class="leaflet-control-layers-overlays" id="overlays-sortable-list">';
  formContent += "</div>";

  formContent += `
    <div style="padding: 4px 0px 0; display: flex; gap: 6px;">
      <button
        id="xyz-import-btn"
        class="layer-import-button"
        style="flex: 1; padding: 4px 6px; cursor: pointer; background-color: var(--text-color); color: var(--background-color); border: none; border-radius: var(--border-radius); font-size: var(--font-size-13); font-weight: bold; line-height: 1.25;"
      >
        Add Tile Layer
      </button>
      <button
        id="wms-import-btn"
        class="layer-import-button"
        style="flex: 1; padding: 4px 6px; cursor: pointer; background-color: var(--text-color); color: var(--background-color); border: none; border-radius: var(--border-radius); font-size: var(--font-size-13); font-weight: bold; line-height: 1.25;"
      >
        Add WMS Layers
      </button>
    </div>
  `;

  formContent += "</form>";

  customPanel.innerHTML = formContent;

  const wmsImportBtn = document.getElementById("wms-import-btn");
  if (wmsImportBtn) {
    wmsImportBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof WmsImport !== "undefined") WmsImport.showWmsImportDialog(map);
    });
  }

  const xyzImportBtn = document.getElementById("xyz-import-btn");
  if (xyzImportBtn) {
    xyzImportBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof XyzImport !== "undefined") XyzImport.showXyzImportDialog(map);
    });
  }

  // Load saved custom tile layers from localStorage
  if (typeof WmsImport !== "undefined") {
    const seeded = WmsImport.seedDefaultLayers && WmsImport.seedDefaultLayers(map);
    if (!seeded && WmsImport.loadLayersFromStorage) WmsImport.loadLayersFromStorage(map);
  }
  if (typeof XyzImport !== "undefined" && XyzImport.loadLayersFromStorage) {
    XyzImport.loadLayersFromStorage(map);
  }

  // Function to restore saved overlay order from localStorage
  function restoreOverlayOrder() {
    const savedOrder = localStorage.getItem("overlayLayerOrder");
    if (!savedOrder) return;

    try {
      const order = JSON.parse(savedOrder);
      const overlaysList = document.getElementById("overlays-sortable-list");
      if (!overlaysList) return;

      const labels = Array.from(overlaysList.querySelectorAll("label"));
      const labelMap = new Map();

      // Create a map of layer id to label element
      labels.forEach((label) => {
        const key = label.getAttribute("data-layer-id");
        if (key) labelMap.set(key, label);
      });

      // Reorder labels based on saved order
      order.forEach((key) => {
        const label = labelMap.get(key);
        if (label) {
          overlaysList.appendChild(label);
        }
      });
    } catch (e) {
      console.warn("Failed to restore overlay order:", e);
    }
  }

  // Restore saved overlay order
  restoreOverlayOrder();

  // Initialize SortableJS for overlay layer reordering
  const overlaysList = document.getElementById("overlays-sortable-list");
  if (overlaysList && typeof Sortable !== "undefined") {
    new Sortable(overlaysList, {
      // No handle restriction - can drag anywhere on the row
      animation: 150,
      delayOnTouchOnly: true,
      delay: 150, // Long press delay for touch devices to distinguish from click
      touchStartThreshold: 10, // Increased tolerance for touch movement
      forceFallback: false, // Use native HTML5 drag when possible
      onEnd: function () {
        // After reordering, update z-index by calling bringToFront in order
        reapplyOverlayZIndex();
        saveOverlayOrder();
      },
    });
  }

  // Function to reapply z-index to all overlay layers based on DOM order
  function reapplyOverlayZIndex() {
    // Bring custom overlay layers to front in order
    const overlayLabels = Array.from(overlaysList.querySelectorAll("label"));

    // Reverse the order because bringToFront() makes the last called layer appear on top
    // We want the first item in the list to be on top, last item on bottom
    const allCustomLayers = {
      ...(typeof WmsImport !== "undefined" ? WmsImport.getCustomWmsLayers() : {}),
      ...(typeof XyzImport !== "undefined" ? XyzImport.getCustomXyzLayers() : {}),
    };

    overlayLabels.reverse().forEach((label) => {
      const layerId = label.getAttribute("data-layer-id");

      if (layerId) {
        const layerData = allCustomLayers[layerId];
        if (
          layerData &&
          layerData.addedToMap &&
          map.hasLayer(layerData.layer) &&
          typeof layerData.layer.bringToFront === "function"
        ) {
          layerData.layer.bringToFront();
        }
      }
    });

    // Then, always bring user content layers to the very top
    const userContentLayers = ["DrawnItems", "ImportedFiles", "StravaActivities", "FoundPlaces"];
    userContentLayers.forEach((name) => {
      if (allOverlayMaps[name] && map.hasLayer(allOverlayMaps[name])) {
        const layer = allOverlayMaps[name];
        if (typeof layer.bringToFront === "function") {
          layer.bringToFront();
        }
      }
    });
  }

  // Function to ensure POI layer is visible in layer control
  window.ensurePoiLayerVisible = function () {
    const foundPlacesLayer = allOverlayMaps["FoundPlaces"];
    if (foundPlacesLayer && !map.hasLayer(foundPlacesLayer)) {
      map.addLayer(foundPlacesLayer);

      // Update the checkbox in the layer control
      const layerId = L.Util.stamp(foundPlacesLayer);
      const checkbox = customPanel.querySelector(`input[data-layer-id="${layerId}"]`);
      if (checkbox) {
        checkbox.checked = true;
      }

      // Reapply z-index to ensure proper layering
      reapplyOverlayZIndex();
    }
  };

  // Restore saved POI results now that the layer control and ensurePoiLayerVisible are ready
  if (window._restorePoiFromDb) _restorePoiFromDb();

  // Function to save overlay order to localStorage
  function saveOverlayOrder() {
    const overlayLabels = overlaysList.querySelectorAll("label");
    const order = Array.from(overlayLabels).map((label) => {
      return label.getAttribute("data-layer-id");
    });
    localStorage.setItem("overlayLayerOrder", JSON.stringify(order));
  }

  // Expose reapplyOverlayZIndex and saveOverlayOrder globally for WmsImport and XyzImport modules
  window.reapplyOverlayZIndex = reapplyOverlayZIndex;
  window.saveOverlayOrder = saveOverlayOrder;

  // Apply z-index on initial load to ensure layers from localStorage respect list order
  reapplyOverlayZIndex();

  window.onOverlayToggle = (e) => {
    const isAdding = e.type === "overlayadd";

    let itemIsInGroup = false;
    if (globallySelectedItem && e.layer.hasLayer && e.layer.hasLayer(globallySelectedItem)) {
      itemIsInGroup = true;
    }

    if (itemIsInGroup) {
      if (isAdding) {
        if (!globallySelectedItem.isManuallyHidden) {
          if (selectedPathOutline) selectedPathOutline.addTo(map).bringToBack();
          if (selectedMarkerOutline) selectedMarkerOutline.addTo(map);
        }
      } else {
        if (selectedPathOutline) map.removeLayer(selectedPathOutline);
        if (selectedMarkerOutline) map.removeLayer(selectedMarkerOutline);
      }
    }

    window.app.refreshRectangleSelectionGroupMembers(e.layer);

    if (typeof e.layer.eachLayer !== "function") {
      return;
    }

    if (isAdding) {
      e.layer.eachLayer((group) => {
        const processLayer = (l) => {
          if (l.isManuallyHidden) {
            map.removeLayer(l);
          }
        };
        if (group instanceof L.GeoJSON) {
          group.eachLayer(processLayer);
        } else {
          processLayer(group);
        }
      });
    }
  };

  const onOverlayToggle = window.onOverlayToggle;

  customPanel.addEventListener("click", function (e) {
    if (e.target && e.target.classList.contains("leaflet-control-layers-selector")) {
      if (L.DomUtil.hasClass(e.target, "leaflet-disabled-interaction")) {
        L.DomEvent.stop(e);
        return;
      }

      const selectedLayerId = parseInt(e.target.dataset.layerId, 10);
      const isRadio = e.target.type === "radio";

      if (isRadio) {
        for (const name in baseMaps) {
          map.removeLayer(baseMaps[name]);
        }
        for (const name in baseMaps) {
          if (L.Util.stamp(baseMaps[name]) === selectedLayerId) {
            map.addLayer(baseMaps[name]);
            setBasemapAttribution(name);
          }
        }
        // Reapply overlay layer z-index after base layer change
        reapplyOverlayZIndex();
      } else {
        for (const name in allOverlayMaps) {
          const layer = allOverlayMaps[name];
          if (L.Util.stamp(layer) === selectedLayerId) {
            if (e.target.checked) {
              map.addLayer(layer);
              onOverlayToggle({ type: "overlayadd", layer: layer });
              addOverlayAttribution(name);
              // Reapply z-index to ensure layer respects list order
              reapplyOverlayZIndex();
            } else {
              map.removeLayer(layer);
              onOverlayToggle({ type: "overlayremove", layer: layer });
              removeOverlayAttribution(name);
            }
            break;
          }
        }
      }

      // Sync overview list eye icons when layers are toggled from Layer Control
      if (typeof updateOverviewList === "function") {
        updateOverviewList();
      }
    }
  });

  document.addEventListener(
    "click",
    function (event) {
      const layersPanel = document.getElementById("custom-layers-panel");
      const layersButton = document.getElementById("layers-button");

      if (
        layersPanel &&
        layersButton &&
        layersPanel.style.display === "block" &&
        !layersButton.contains(event.target) &&
        !layersPanel.contains(event.target)
      ) {
        closePanelMode("layers-panel", () => (layersPanel.style.display = "none"));
      }
    },
    true,
  );
}
