// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

const XyzImport = (function () {
  let customXyzLayers = {};
  let layerIdCounter = 0;
  const STORAGE_KEY = "xyzCustomLayers";

  function addToLayersControl(layerId, name, layer, map, autoEnable) {
    const overlaysList = document.getElementById("overlays-sortable-list");
    if (!overlaysList) return;

    const label = document.createElement("label");
    label.className = "wms-custom-layer";
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
          <span class="layer-name-text" title="${name}">
            <span class="drag-handle material-symbols layer-icon" title="Drag to reorder" style="cursor: move;">drag_indicator</span> ${name}
          </span>
          <span
            class="material-symbols material-symbols-fill layer-icon wms-remove-icon"
            data-layer-id="${layerId}"
            title="Remove this layer"
            style="cursor: pointer;"
          >cancel</span>
        </span>
      </div>
    `;

    overlaysList.appendChild(label);

    if (autoEnable) {
      map.addLayer(layer);
      customXyzLayers[layerId].addedToMap = true;
    }

    if (typeof window.reapplyOverlayZIndex === "function") window.reapplyOverlayZIndex();
    if (typeof window.saveOverlayOrder === "function") window.saveOverlayOrder();

    label.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) {
        map.addLayer(layer);
        customXyzLayers[layerId].addedToMap = true;
        if (typeof window.reapplyOverlayZIndex === "function") window.reapplyOverlayZIndex();
      } else {
        map.removeLayer(layer);
        customXyzLayers[layerId].addedToMap = false;
      }
      saveLayersToStorage();
    });

    label.querySelector(".wms-remove-icon").addEventListener("click", (e) => {
      e.stopPropagation();
      if (customXyzLayers[layerId]?.addedToMap) map.removeLayer(layer);
      label.remove();
      delete customXyzLayers[layerId];
      saveLayersToStorage();
      if (typeof window.saveOverlayOrder === "function") window.saveOverlayOrder();
    });
  }

  function addXyzLayer(name, url, map, autoEnable = true) {
    const layerId = `xyz-${++layerIdCounter}`;
    const layer = L.tileLayer(url, { maxZoom: 19, pane: "wmsPane" });
    customXyzLayers[layerId] = { id: layerId, layer, name, url, addedToMap: false };
    addToLayersControl(layerId, name, layer, map, autoEnable);
    saveLayersToStorage();
  }

  function saveLayersToStorage() {
    const data = Object.values(customXyzLayers).map((l) => ({
      name: l.name,
      url: l.url,
      addedToMap: l.addedToMap,
    }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("Failed to save XYZ layers:", e);
    }
  }

  function loadLayersFromStorage(map) {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      JSON.parse(saved).forEach((data) => {
        const layerId = `xyz-${++layerIdCounter}`;
        const layer = L.tileLayer(data.url, { maxZoom: 19, pane: "wmsPane" });
        customXyzLayers[layerId] = {
          id: layerId,
          layer,
          name: data.name,
          url: data.url,
          addedToMap: false,
        };
        addToLayersControl(layerId, data.name, layer, map, data.addedToMap);
      });
    } catch (e) {
      console.warn("Failed to load XYZ layers:", e);
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
    }
  }

  return {
    showXyzImportDialog,
    loadLayersFromStorage,
    getCustomXyzLayers: () => customXyzLayers,
  };
})();
