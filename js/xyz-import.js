// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * XYZ Tile Layer Import Module
 *
 * Provides functionality to import custom XYZ/TMS tile layers into the map.
 * Layers are persisted to localStorage and restored on page load.
 */

const XyzImport = (function () {
  let customXyzLayers = {};
  let layerIdCounter = 0;
  const STORAGE_KEY = "xyzCustomLayers";

  /**
   * @param {string} layerId - Unique layer ID
   * @param {string} displayName - Display name for the layer
   * @param {L.TileLayer} xyzLayer - Leaflet tile layer instance
   * @param {L.Map} map - Leaflet map instance
   * @param {boolean} autoEnable - Whether to auto-enable the layer (default: true)
   */
  function addToLayersControl(layerId, displayName, xyzLayer, map, autoEnable = true) {
    const customPanel = document.getElementById("custom-layers-panel");
    if (!customPanel) return;
    const overlaysList = customPanel.querySelector(".leaflet-control-layers-overlays");
    if (!overlaysList) return;

    const label = document.createElement("label");
    label.className = "custom-layer";
    label.setAttribute("data-layer-id", layerId);
    const checkedAttr = autoEnable ? 'checked="checked"' : "";
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
          <span class="layer-name-text" title="${displayName}"><span class="drag-handle material-symbols layer-icon" title="Drag to reorder" style="cursor: move;">drag_indicator</span> ${displayName}</span>
          <span
            class="material-symbols material-symbols-fill layer-icon layer-remove-icon"
            data-layer-id="${layerId}"
            title="Remove this layer"
            style="cursor: pointer;"
          >cancel</span>
        </span>
      </div>
    `;

    overlaysList.appendChild(label);

    if (autoEnable) {
      map.addLayer(xyzLayer);
      customXyzLayers[layerId].addedToMap = true;
    }

    if (typeof window.reapplyOverlayZIndex === "function") {
      window.reapplyOverlayZIndex();
    }
    if (typeof window.saveOverlayOrder === "function") {
      window.saveOverlayOrder();
    }

    label.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) {
        map.addLayer(xyzLayer);
        customXyzLayers[layerId].addedToMap = true;
        if (typeof window.reapplyOverlayZIndex === "function") {
          window.reapplyOverlayZIndex();
        }
      } else {
        map.removeLayer(xyzLayer);
        customXyzLayers[layerId].addedToMap = false;
      }
      saveLayersToStorage();
    });

    const removeIcon = label.querySelector(".layer-remove-icon");
    removeIcon.addEventListener("click", (e) => {
      e.stopPropagation();
      removeXyzLayer(layerId, map);
    });
  }

  /**
   * @param {string} layerId - ID of the layer to remove
   * @param {L.Map} map - Leaflet map instance
   */
  function removeXyzLayer(layerId, map) {
    const layerData = customXyzLayers[layerId];
    if (layerData && layerData.addedToMap) {
      map.removeLayer(layerData.layer);
    }

    const customPanel = document.getElementById("custom-layers-panel");
    if (customPanel) {
      const label = customPanel.querySelector(`label[data-layer-id="${layerId}"]`);
      if (label) {
        label.remove();
      }
    }

    delete customXyzLayers[layerId];
    saveLayersToStorage();
    if (typeof window.saveOverlayOrder === "function") {
      window.saveOverlayOrder();
    }
  }

  /**
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

  function loadLayersFromStorage(map) {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;

      const layersData = JSON.parse(saved);
      layersData.forEach((layerData) => {
        const xyzLayer = L.tileLayer(layerData.url, { maxZoom: 19, pane: "customLayersPane" });
        customXyzLayers[layerData.id] = {
          id: layerData.id,
          layer: xyzLayer,
          name: layerData.name,
          url: layerData.url,
          addedToMap: layerData.addedToMap,
        };
        addToLayersControl(layerData.id, layerData.name, xyzLayer, map, layerData.addedToMap);

        // Update layerIdCounter to avoid ID conflicts
        const idNum = parseInt(layerData.id.replace("xyz-custom-", ""), 10);
        if (!isNaN(idNum) && idNum >= layerIdCounter) {
          layerIdCounter = idNum + 1;
        }
      });
    } catch (e) {
      console.warn("Failed to load XYZ layers from localStorage:", e);
    }
  }

  async function showXyzImportDialog(map) {
    const result = await Swal.fire({
      title: "Import Tile Layer",
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
          </ul>
          <p style="margin-top: 6px;">Use <strong>{z}</strong>, <strong>{x}</strong>, <strong>{y}</strong> placeholders for XYZ tiles. For TMS layers with a flipped Y axis, use <strong>{-y}</strong> instead of <strong>{y}</strong>.</p>
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

        function updateButton() {
          confirmButton.disabled = !nameInput.value.trim() || !urlInput.value.trim();
        }

        updateButton();

        nameInput.addEventListener("input", updateButton);
        urlInput.addEventListener("input", updateButton);

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
        if (!name || !url) {
          Swal.showValidationMessage("Please fill in both fields.");
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
        title: "Tile layer imported",
        timer: 3000,
        showConfirmButton: false,
      });
    }
  }

  return {
    showXyzImportDialog,
    loadLayersFromStorage,
    getCustomXyzLayers: () => customXyzLayers,
  };
})();

window.XyzImport = XyzImport;
