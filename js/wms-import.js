// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * WMS Import Module
 * Handles custom WMS layer imports with GetCapabilities parsing and layer selection
 */

const WmsImport = (function () {
  let customWmsLayers = {}; // Store custom WMS layers by ID
  let layerIdCounter = 0;
  const STORAGE_KEY = "wmsCustomLayers";

  /**
   * Shows the main WMS import dialog
   * @param {L.Map} map - Leaflet map instance
   */
  async function showWmsImportDialog(map) {
    const result = await Swal.fire({
      title: "Add WMS Layers",
      html: `
        <div style="text-align: left;">
          <input
            type="text"
            id="wms-url-input"
            class="swal2-input swal-input-field"
            placeholder="https://example.com/wms"
          />
          <p style="margin-top: 12px;">Examples:</p>
          <ul style="margin: 4px 0; padding-left: 20px; text-align: left;">
            <li class="wms-example-url" data-url="https://wms.geo.admin.ch/" style="cursor: pointer;">https://wms.geo.admin.ch/</li>
            <li class="wms-example-url" data-url="https://ows.terrestris.de/osm/service?" style="cursor: pointer;">https://ows.terrestris.de/osm/service?</li>
            <li class="wms-example-url" data-url="https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?" style="cursor: pointer;">https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?</li>
          </ul>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Connect",
      cancelButtonText: "Cancel",
      customClass: {
        confirmButton: "swal-confirm-button",
      },
      didOpen: () => {
        const confirmButton = Swal.getConfirmButton();
        const urlInput = document.getElementById("wms-url-input");

        // Disable button initially
        confirmButton.disabled = true;

        // Enable/disable button based on input
        urlInput.addEventListener("input", () => {
          confirmButton.disabled = !urlInput.value.trim();
        });

        // Add click handlers for example URLs
        document.querySelectorAll(".wms-example-url").forEach((li) => {
          li.addEventListener("click", () => {
            urlInput.value = li.dataset.url;
            confirmButton.disabled = false;
          });
        });
      },
      preConfirm: () => {
        const url = document.getElementById("wms-url-input").value.trim();
        return url;
      },
    });

    if (result.isConfirmed && result.value) {
      await connectToWmsService(result.value, map);
    }
  }

  /**
   * Connects to a WMS service and fetches available layers
   * @param {string} wmsUrl - Base WMS service URL
   * @param {L.Map} map - Leaflet map instance
   */
  async function connectToWmsService(wmsUrl, map) {
    Swal.fire({
      title: "Connecting...",
      text: "Fetching available layers from WMS service",
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    try {
      const layers = await fetchWmsCapabilities(wmsUrl);

      if (!layers || layers.length === 0) {
        Swal.fire({
          title: "No Layers Found",
          text: "The WMS service did not return any queryable layers.",
        });
        return;
      }

      await showLayerSelectionDialog(layers, wmsUrl, map);
    } catch (error) {
      console.error("WMS connection error:", error);

      // Properly clear the loading state and close the dialog
      Swal.hideLoading();
      Swal.close();

      // Wait a moment for the dialog to fully close before opening new one
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Show fresh error dialog
      const result = await Swal.fire({
        title: "Connection Failed",
        html: `
          <p>Could not connect to the WMS service.</p>
          <div style="text-align: center; margin-top: 12px;">
            <p style="margin-bottom: 8px;"><strong>Possible reasons:</strong></p>
            <div style="display: inline-block; text-align: left;">
              <ul style="margin: 0; padding-left: 20px;">
                <li>The URL is incorrect or the service is unavailable</li>
                <li>The server doesn't allow cross-origin requests (CORS)</li>
                <li>The service is not a valid WMS endpoint</li>
              </ul>
            </div>
          </div>
          <p style="margin-top: 12px; color: var(--color-red)">Error: ${escHtml(error.message)}</p>
        `,
        confirmButtonText: "OK",
        allowOutsideClick: true,
      });

      // Re-open the WMS import dialog after user clicks OK
      if (result.isConfirmed || result.isDismissed) {
        await showWmsImportDialog(map);
      }
    }
  }

  /**
   * Fetches and parses WMS GetCapabilities
   * @param {string} baseUrl - Base WMS service URL
   * @returns {Promise<Array>} Array of layer objects
   */
  async function fetchWmsCapabilities(baseUrl) {
    // Construct GetCapabilities URL
    const url = new URL(baseUrl);
    url.searchParams.set("SERVICE", "WMS");
    url.searchParams.set("REQUEST", "GetCapabilities");

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");

    // Check for XML parsing errors
    const parseError = xmlDoc.querySelector("parsererror");
    if (parseError) {
      throw new Error("Invalid XML response from WMS service");
    }

    return parseWmsLayers(xmlDoc);
  }

  /**
   * Parses WMS GetCapabilities XML to extract layer information
   * @param {Document} xmlDoc - Parsed XML document
   * @returns {Array} Array of layer objects with name, title, and abstract
   */
  function parseWmsLayers(xmlDoc) {
    const layers = [];

    // Try different namespace variations
    let layerElements = xmlDoc.querySelectorAll("Layer[queryable='1']");

    // If no queryable layers, get all named layers
    if (layerElements.length === 0) {
      layerElements = xmlDoc.querySelectorAll("Layer > Name");
      layerElements = Array.from(layerElements).map((name) => name.parentElement);
    }

    layerElements.forEach((layerEl) => {
      const nameEl = layerEl.querySelector("Name");
      const titleEl = layerEl.querySelector("Title");
      const abstractEl = layerEl.querySelector("Abstract");

      if (nameEl && nameEl.textContent.trim()) {
        layers.push({
          name: nameEl.textContent.trim(),
          title: titleEl ? titleEl.textContent.trim() : nameEl.textContent.trim(),
          abstract: abstractEl ? abstractEl.textContent.trim() : "",
        });
      }
    });

    return layers;
  }

  /**
   * Checks if a layer is already imported
   * @param {string} wmsUrl - WMS service URL
   * @param {string} layerName - WMS layer name
   * @returns {boolean} True if layer is already imported
   */
  function isLayerAlreadyImported(wmsUrl, layerName) {
    return Object.values(customWmsLayers).some(
      (layerData) => layerData.wmsUrl === wmsUrl && layerData.wmsLayerName === layerName,
    );
  }

  /**
   * Shows layer selection dialog with checkboxes
   * @param {Array} layers - Array of available layers
   * @param {string} wmsUrl - Base WMS URL
   * @param {L.Map} map - Leaflet map instance
   */
  async function showLayerSelectionDialog(layers, wmsUrl, map) {
    const layersHtml = layers
      .map((layer, index) => {
        const alreadyImported = isLayerAlreadyImported(wmsUrl, layer.name);
        const disabledAttr = alreadyImported ? "disabled" : "";
        const cursorStyle = alreadyImported ? "cursor: default;" : "cursor: pointer;";
        const opacityStyle = alreadyImported ? "opacity: 0.6;" : "";

        return `
        <label class="wms-layer-item" data-layer-index="${index}" data-layer-title="${escHtml(layer.title.toLowerCase())}" data-layer-abstract="${escHtml(
          (layer.abstract || "").toLowerCase(),
        )}" style="display: flex; align-items: start; margin-bottom: 12px; text-align: left; ${cursorStyle} ${opacityStyle}">
          <input
            type="checkbox"
            id="wms-layer-${index}"
            value="${escHtml(layer.name)}"
            ${disabledAttr}
            style="margin-right: 10px; margin-top: 4px; cursor: pointer;"
          />
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 500; display: flex; align-items: flex-start; gap: 6px;">
              <span style="flex: 1; min-width: 0;">
                ${escHtml(layer.title)}
                ${
                  alreadyImported
                    ? ' <span style="color: var(--color-red); font-size: var(--font-size-12); font-weight: 400;">(Already imported)</span>'
                    : ""
                }
              </span>
              ${
                layer.abstract
                  ? `<span class="material-symbols wms-layer-info-icon" data-layer-index="${index}" style="font-size: var(--icon-size-20); cursor: pointer; user-select: none;">info</span>`
                  : ""
              }
            </div>
            ${
              layer.abstract
                ? `<div class="wms-layer-description" id="wms-description-${index}" style="display: none; font-size: var(--font-size-12); color: var(--text-color); margin-top: 4px; line-height: 1.4;">${escHtml(layer.abstract)}</div>`
                : ""
            }
          </div>
        </label>
      `;
      })
      .join("");

    const result = await Swal.fire({
      title: "Select Layers to Add",
      html: `
        <div style="text-align: left; display: flex; flex-direction: column; height: 100%; min-height: 0;">
          <div id="wms-search-header" style="flex-shrink: 0; background-color: var(--background-color); z-index: 10; padding-bottom: 0px;">
            <input
              type="text"
              id="wms-layer-search"
              class="swal2-input swal-input-field"
              placeholder="Search layers"
              style="margin-bottom: 10px;"
            />
            <p style="margin-bottom: 5px;">
              Found <strong id="wms-layer-count">${layers.length}</strong> layer(s):
            </p>
          </div>
          <div id="wms-layers-container" style="flex: 1 1 auto; overflow-y: auto; padding: 10px; min-height: 0;">
            ${layersHtml}
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Add Selected",
      cancelButtonText: "Cancel",
      customClass: {
        popup: "wms-layer-selection-popup",
        confirmButton: "swal-confirm-button",
      },
      didOpen: () => {
        const confirmButton = Swal.getConfirmButton();
        const searchInput = document.getElementById("wms-layer-search");
        const layerItems = document.querySelectorAll(".wms-layer-item");
        const layerCountEl = document.getElementById("wms-layer-count");

        // Disable import button initially
        confirmButton.disabled = true;

        // Function to update button state
        const updateButtonState = () => {
          // Get all checkboxes in the container
          const allCheckboxes = document.querySelectorAll(
            '#wms-layers-container input[type="checkbox"]',
          );
          // Filter to only enabled checkboxes and check if any are checked
          const hasSelection = Array.from(allCheckboxes).some((cb) => !cb.disabled && cb.checked);
          confirmButton.disabled = !hasSelection;
        };

        // Add change listeners to all checkboxes (including disabled ones, but they won't fire)
        const allCheckboxes = document.querySelectorAll(
          '#wms-layers-container input[type="checkbox"]',
        );
        allCheckboxes.forEach((checkbox) => {
          if (!checkbox.disabled) {
            checkbox.addEventListener("change", updateButtonState);
          }
        });

        // Add search/filter functionality
        searchInput.addEventListener("input", () => {
          const searchTerm = searchInput.value.toLowerCase().trim();
          let visibleCount = 0;

          layerItems.forEach((item) => {
            const title = item.dataset.layerTitle || "";
            const abstract = item.dataset.layerAbstract || "";

            // Check if search term matches title or abstract
            if (title.includes(searchTerm) || abstract.includes(searchTerm)) {
              item.style.display = "flex";
              visibleCount++;
            } else {
              item.style.display = "none";
            }
          });

          // Update the count display
          layerCountEl.textContent = visibleCount;
        });

        // Add click handler for info icons to toggle description visibility
        const infoIcons = document.querySelectorAll(".wms-layer-info-icon");
        infoIcons.forEach((icon) => {
          icon.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            const layerIndex = icon.dataset.layerIndex;
            const description = document.getElementById(`wms-description-${layerIndex}`);

            if (description) {
              // Toggle description visibility
              const isHidden = description.style.display === "none";
              description.style.display = isHidden ? "block" : "none";

              // Toggle icon fill state
              if (isHidden) {
                icon.classList.add("material-symbols-fill");
              } else {
                icon.classList.remove("material-symbols-fill");
              }
            }
          });
        });
      },
      preConfirm: () => {
        const selectedLayers = [];
        layers.forEach((layer, index) => {
          const checkbox = document.getElementById(`wms-layer-${index}`);
          if (checkbox && checkbox.checked) {
            selectedLayers.push(layer);
          }
        });

        return selectedLayers;
      },
    });

    if (result.isConfirmed && result.value) {
      addWmsOverlays(result.value, wmsUrl, map);
      Swal.fire({
        toast: true,
        icon: "success",
        title: `${result.value.length} WMS layer${result.value.length !== 1 ? "s" : ""} added`,
        timer: 3000,
        showConfirmButton: false,
      });
    }
  }

  /**
   * Creates and adds WMS overlay layers to the map
   * @param {Array} selectedLayers - Array of selected layer objects
   * @param {string} wmsUrl - Base WMS URL
   * @param {L.Map} map - Leaflet map instance
   * @param {boolean} [autoEnable=true] - Whether to auto-enable the layers (default: true)
   */
  function addWmsOverlays(selectedLayers, wmsUrl, map, autoEnable = true) {
    selectedLayers.forEach((layer) => {
      const layerId = `wms-custom-${layerIdCounter++}`;

      // Create WMS tile layer with gutter support to prevent icon cutoff
      const wmsLayer = L.tileLayer.wms.gutter(wmsUrl, {
        layers: layer.name,
        format: "image/png",
        transparent: true,
        pane: "customLayersPane",
        tileSize: 512,
        gutter: 64, // Add 64px overlap on each side to prevent icon cutoff
        noWrap: true,
        bounds: WORLD_BOUNDS,
      });

      // Store layer information
      customWmsLayers[layerId] = {
        id: layerId,
        layer: wmsLayer,
        name: layer.title,
        wmsUrl: wmsUrl,
        wmsLayerName: layer.name,
        addedToMap: false,
      };

      // Add to layers control
      addToLayersControl(layerId, layer.title, wmsLayer, map, autoEnable);
    });

    // Save to localStorage
    saveLayersToStorage();
  }

  /**
   * Adds a custom WMS layer to the layers control panel
   * @param {string} layerId - Unique layer ID
   * @param {string} displayName - Display name for the layer
   * @param {L.TileLayer.WMS} wmsLayer - Leaflet WMS layer
   * @param {L.Map} map - Leaflet map instance
   * @param {boolean} autoEnable - Whether to auto-enable the layer (default: true)
   */
  function addToLayersControl(layerId, displayName, wmsLayer, map, autoEnable = true) {
    const customPanel = document.getElementById("custom-layers-panel");
    if (!customPanel) return;

    const overlaysSection = customPanel.querySelector(".leaflet-control-layers-overlays");
    if (!overlaysSection) return;

    const label = document.createElement("label");
    label.className = "custom-layer";
    label.setAttribute("data-layer-id", layerId);
    const checkedAttr = autoEnable ? 'checked="checked"' : "";
    const safeName = escHtml(displayName);
    label.innerHTML = `
      <div>
        <input
          type="checkbox"
          class="leaflet-control-layers-selector"
          data-layer-id="${layerId}"
          data-layer-type="wms-custom"
          ${checkedAttr}
        />
        <span class="layer-name-container" style="padding-left: 0;">
          <span class="layer-name-text" title="${safeName}"><span class="drag-handle material-symbols layer-icon" title="Drag to reorder" style="cursor: move;">drag_indicator</span> ${safeName}</span>
          <span
            class="material-symbols material-symbols-fill layer-icon layer-remove-icon"
            data-layer-id="${layerId}"
            title="Remove this layer"
            style="cursor: pointer;"
          >cancel</span>
        </span>
      </div>
    `;

    // Prepend so newly imported layers appear at top; restoreOverlayOrder() corrects order on reload.
    overlaysSection.prepend(label);

    // Auto-enable the layer on import if requested
    if (autoEnable) {
      map.addLayer(wmsLayer);
      customWmsLayers[layerId].addedToMap = true;
    }

    // Reapply z-index to ensure visual order matches list order
    if (typeof window.reapplyOverlayZIndex === "function") {
      window.reapplyOverlayZIndex();
    }

    // Save the updated overlay order to localStorage
    if (typeof window.saveOverlayOrder === "function") {
      window.saveOverlayOrder();
    }

    // Add event listener for checkbox toggle
    const checkbox = label.querySelector("input");
    checkbox.addEventListener("change", (e) => {
      if (e.target.checked) {
        map.addLayer(wmsLayer);
        customWmsLayers[layerId].addedToMap = true;
        // Reapply z-index to ensure layer respects list order
        if (typeof window.reapplyOverlayZIndex === "function") {
          window.reapplyOverlayZIndex();
        }
      } else {
        map.removeLayer(wmsLayer);
        customWmsLayers[layerId].addedToMap = false;
      }
      // Save the updated state to localStorage
      saveLayersToStorage();
    });

    // Add event listener for remove icon
    const removeIcon = label.querySelector(".layer-remove-icon");
    removeIcon.addEventListener("click", (e) => {
      e.stopPropagation();
      removeWmsLayer(layerId, map);
    });
  }

  /**
   * Removes a custom WMS layer
   * @param {string} layerId - Layer ID to remove
   * @param {L.Map} map - Leaflet map instance
   */
  function removeWmsLayer(layerId, map) {
    const layerData = customWmsLayers[layerId];
    if (!layerData) return;

    // Remove from map
    if (layerData.addedToMap) {
      map.removeLayer(layerData.layer);
    }

    // Remove from control panel
    const customPanel = document.getElementById("custom-layers-panel");
    const checkbox = customPanel?.querySelector(`input[data-layer-id="${layerId}"]`);
    if (checkbox) {
      checkbox.closest("label").remove();
    }

    // Remove from storage
    delete customWmsLayers[layerId];

    // Update localStorage
    saveLayersToStorage();

    // Update overlay order to remove deleted layer reference
    if (typeof window.saveOverlayOrder === "function") {
      window.saveOverlayOrder();
    }
  }

  /**
   * Saves current WMS layers to localStorage
   */
  function saveLayersToStorage() {
    const layersToSave = Object.values(customWmsLayers).map((layerData) => ({
      id: layerData.id,
      name: layerData.name,
      wmsUrl: layerData.wmsUrl,
      wmsLayerName: layerData.wmsLayerName,
      addedToMap: layerData.addedToMap,
    }));

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layersToSave));
    } catch (e) {
      console.warn("Failed to save WMS layers to localStorage:", e);
    }
  }

  /**
   * Loads WMS layers from localStorage and adds them to the map
   * @param {L.Map} map - Leaflet map instance
   */
  function loadLayersFromStorage(map) {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    let layersData;
    try {
      layersData = JSON.parse(saved);
    } catch (e) {
      console.warn("Failed to load WMS layers from localStorage:", e);
      return;
    }

    if (!Array.isArray(layersData)) return;

    layersData.forEach((layerData) => {
      try {
        // Create WMS tile layer with gutter support to prevent icon cutoff
        const wmsLayer = L.tileLayer.wms.gutter(layerData.wmsUrl, {
          layers: layerData.wmsLayerName,
          format: "image/png",
          transparent: true,
          pane: "customLayersPane",
          tileSize: 512,
          gutter: 64, // Add 64px overlap on each side to prevent icon cutoff
          noWrap: true,
          bounds: WORLD_BOUNDS,
        });

        // Store layer information
        customWmsLayers[layerData.id] = {
          id: layerData.id,
          layer: wmsLayer,
          name: layerData.name,
          wmsUrl: layerData.wmsUrl,
          wmsLayerName: layerData.wmsLayerName,
          addedToMap: layerData.addedToMap,
        };

        // Add to layers control with saved visibility state
        addToLayersControl(layerData.id, layerData.name, wmsLayer, map, layerData.addedToMap);

        // Update layerIdCounter to avoid ID conflicts
        const idNum = parseInt(layerData.id.replace("wms-custom-", ""), 10);
        if (!isNaN(idNum) && idNum >= layerIdCounter) {
          layerIdCounter = idNum + 1;
        }
      } catch (e) {
        console.warn("Failed to restore WMS layer:", layerData?.id, e);
      }
    });
  }

  /**
   * Seeds default WMS layers on first-ever load (no localStorage key yet)
   * @param {L.Map} map - Leaflet map instance
   * @returns {boolean} True if layers were seeded, false otherwise
   */
  function seedDefaultLayers(map) {
    // Only seed if localStorage key doesn't exist at all (truly fresh start)
    if (localStorage.getItem(STORAGE_KEY) !== null) return false;

    addWmsOverlays(
      [{ name: "ch.swisstopo.swisstlm3d-wanderwege", title: "Swiss Hiking Trails" }],
      "https://wms.geo.admin.ch/",
      map,
      false, // Don't auto-enable default layers
    );
    return true;
  }

  // Public API
  return {
    showWmsImportDialog,
    loadLayersFromStorage,
    seedDefaultLayers,
    getCustomWmsLayers: () => customWmsLayers, // Expose custom WMS layers for layer management
  };
})();

// Export to window for global access
window.WmsImport = WmsImport;
