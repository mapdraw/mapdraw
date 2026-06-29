// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * XYZ Tile Layer Import Module
 *
 * Provides functionality to import custom XYZ/TMS tile layers into the map.
 * Layers are persisted to localStorage and restored on page load.
 */

const XyzImport = (function () {
  let customXyzLayers = {}; // Store custom XYZ layers by ID
  let layerIdCounter = 0;
  const STORAGE_KEY = "xyzCustomLayers";

  /**
   * Adds a custom XYZ layer to the layers control panel
   * @param {string} layerId - Unique layer ID
   * @param {string} displayName - Display name for the layer
   * @param {L.TileLayer} xyzLayer - Leaflet tile layer instance
   * @param {L.Map} map - Leaflet map instance
   * @param {boolean} autoEnable - Whether to auto-enable the layer (default: true)
   */
  function addToLayersControl(layerId, displayName, xyzLayer, map, autoEnable = true) {
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
          data-layer-type="xyz-custom"
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
      map.addLayer(xyzLayer);
      customXyzLayers[layerId].addedToMap = true;
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
        map.addLayer(xyzLayer);
        customXyzLayers[layerId].addedToMap = true;
        // Reapply z-index to ensure layer respects list order
        if (typeof window.reapplyOverlayZIndex === "function") {
          window.reapplyOverlayZIndex();
        }
      } else {
        map.removeLayer(xyzLayer);
        customXyzLayers[layerId].addedToMap = false;
      }
      // Save the updated state to localStorage
      saveLayersToStorage();
    });

    // Add event listener for remove icon
    const removeIcon = label.querySelector(".layer-remove-icon");
    removeIcon.addEventListener("click", (e) => {
      e.stopPropagation();
      removeXyzLayer(layerId, map);
    });
  }

  /**
   * Removes a custom XYZ layer
   * @param {string} layerId - Layer ID to remove
   * @param {L.Map} map - Leaflet map instance
   */
  function removeXyzLayer(layerId, map) {
    const layerData = customXyzLayers[layerId];
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
    delete customXyzLayers[layerId];

    // Update localStorage
    saveLayersToStorage();

    // Update overlay order to remove deleted layer reference
    if (typeof window.saveOverlayOrder === "function") {
      window.saveOverlayOrder();
    }
  }

  /**
   * Creates and adds an XYZ overlay layer to the map
   * @param {string} name - Display name for the layer
   * @param {string} url - XYZ tile URL template
   * @param {L.Map} map - Leaflet map instance
   * @param {boolean} autoEnable - Whether to auto-enable the layer (default: true)
   */
  function addXyzLayer(name, url, map, autoEnable = true) {
    const layerId = `xyz-custom-${layerIdCounter++}`;
    const xyzLayer = L.tileLayer(url, { maxZoom: 19, pane: "customLayersPane" });
    customXyzLayers[layerId] = {
      id: layerId,
      layer: xyzLayer,
      name: name,
      url: url,
      addedToMap: false,
    };
    addToLayersControl(layerId, name, xyzLayer, map, autoEnable);
    saveLayersToStorage();
  }

  /**
   * Saves current XYZ layers to localStorage
   */
  function saveLayersToStorage() {
    const layersToSave = Object.values(customXyzLayers).map((layerData) => ({
      id: layerData.id,
      name: layerData.name,
      url: layerData.url,
      addedToMap: layerData.addedToMap,
    }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layersToSave));
    } catch (e) {
      console.warn("Failed to save XYZ layers to localStorage:", e);
    }
  }

  /**
   * Loads XYZ layers from localStorage and adds them to the map
   * @param {L.Map} map - Leaflet map instance
   */
  function loadLayersFromStorage(map) {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    let layersData;
    try {
      layersData = JSON.parse(saved);
    } catch (e) {
      console.warn("Failed to load XYZ layers from localStorage:", e);
      return;
    }

    if (!Array.isArray(layersData)) return;

    layersData.forEach((layerData) => {
      try {
        // Create XYZ tile layer
        const xyzLayer = L.tileLayer(layerData.url, { maxZoom: 19, pane: "customLayersPane" });

        // Store layer information
        customXyzLayers[layerData.id] = {
          id: layerData.id,
          layer: xyzLayer,
          name: layerData.name,
          url: layerData.url,
          addedToMap: layerData.addedToMap,
        };

        // Add to layers control with saved visibility state
        addToLayersControl(layerData.id, layerData.name, xyzLayer, map, layerData.addedToMap);

        // Update layerIdCounter to avoid ID conflicts
        const idNum = parseInt(layerData.id.replace("xyz-custom-", ""), 10);
        if (!isNaN(idNum) && idNum >= layerIdCounter) {
          layerIdCounter = idNum + 1;
        }
      } catch (e) {
        console.warn("Failed to restore XYZ layer:", layerData?.id, e);
      }
    });
  }

  /**
   * Shows the XYZ tile layer import dialog
   * @param {L.Map} map - Leaflet map instance
   */
  async function showXyzImportDialog(map) {
    const result = await Swal.fire({
      title: "Add Tile Layer",
      html: `
        <div style="text-align: left;">
          <input
            type="text"
            id="xyz-name-input"
            class="swal2-input swal-input-field"
            placeholder="My Tile Layer"
            value="My Tile Layer"
          />
          <input
            type="text"
            id="xyz-url-input"
            class="swal2-input swal-input-field"
            placeholder="https://example.com/{z}/{x}/{y}.png"
            style="margin-top: 8px;"
          />
          <p style="margin-top: 12px;">Examples:</p>
          <ul style="margin: 4px 0; padding-left: 20px; text-align: left;">
            <li class="xyz-example-url" data-url="https://tile.opentopomap.org/{z}/{x}/{y}.png" data-name="OpenTopoMap" style="cursor: pointer;">https://tile.opentopomap.org/{z}/{x}/{y}.png</li>
            <li class="xyz-example-url" data-url="https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png" data-name="Humanitarian OSM" style="cursor: pointer; margin-top: 4px;">https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png</li>
          </ul>
          <p style="margin-top: 6px;">Use <strong>{z}</strong>, <strong>{x}</strong>, <strong>{y}</strong> placeholders for XYZ tiles. For TMS layers with a flipped Y axis, use <strong>{-y}</strong> instead of <strong>{y}</strong>.</p>
          <p id="xyz-error-msg" style="color: var(--color-red); margin-top: 6px; display: none;"></p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Add",
      cancelButtonText: "Cancel",
      customClass: { confirmButton: "swal-confirm-button" },
      didOpen: () => {
        const confirmButton = Swal.getConfirmButton();
        const nameInput = document.getElementById("xyz-name-input");
        const urlInput = document.getElementById("xyz-url-input");
        const errorMsg = document.getElementById("xyz-error-msg");

        function updateButton() {
          confirmButton.disabled = !nameInput.value.trim() || !urlInput.value.trim();
          errorMsg.style.display = "none";
        }

        // Disable button initially
        updateButton();

        // Enable/disable button based on input
        nameInput.addEventListener("input", updateButton);
        urlInput.addEventListener("input", updateButton);

        // Add click handlers for example URLs
        document.querySelectorAll(".xyz-example-url").forEach((li) => {
          li.addEventListener("click", () => {
            urlInput.value = li.dataset.url;
            nameInput.value = li.dataset.name;
            updateButton();
          });
        });
      },
      preConfirm: () => {
        const name = document.getElementById("xyz-name-input").value.trim();
        const url = document.getElementById("xyz-url-input").value.trim();
        if (!name || !url) return false;

        const hasZ = url.includes("{z}");
        const hasX = url.includes("{x}");
        const hasY = url.includes("{y}") || url.includes("{-y}");

        if (!hasZ || !hasX || !hasY) {
          const errorEl = document.getElementById("xyz-error-msg");
          errorEl.textContent = "Error: URL must contain {z}, {x}, and {y} (or {-y}) placeholders.";
          errorEl.style.display = "block";
          return false;
        }

        if (Object.values(customXyzLayers).some((l) => l.url === url)) {
          const errorEl = document.getElementById("xyz-error-msg");
          errorEl.textContent = "Error: This tile URL is already added.";
          errorEl.style.display = "block";
          return false;
        }
        return { name, url };
      },
    });

    if (result.isConfirmed && result.value) {
      addXyzLayer(result.value.name, result.value.url, map);
      Swal.fire({
        toast: true,
        icon: "success",
        title: "Tile layer added",
        timer: 3000,
        showConfirmButton: false,
      });
    }
  }

  // Public API
  return {
    showXyzImportDialog,
    loadLayersFromStorage,
    getCustomXyzLayers: () => customXyzLayers, // Expose custom XYZ layers for layer management
  };
})();

// Export to window for global access
window.XyzImport = XyzImport;
