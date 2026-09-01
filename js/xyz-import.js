// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * XYZ Tile Layer Import Module
 *
 * Provides functionality to import custom XYZ/TMS tile layers into the map.
 * Layers are persisted to localStorage and restored on page load.
 */

const XyzImport = (function () {
  const store = createCustomLayerStore({
    storageKey: "xyzCustomLayers",
    idPrefix: "xyz-custom-",
    kind: "XYZ",
    createLayer: (layerData) =>
      L.tileLayer(layerData.url, {
        maxZoom: 19,
        pane: "customLayersPane",
        noWrap: true,
        bounds: WORLD_BOUNDS,
      }),
  });

  /**
   * Creates and adds an XYZ overlay layer to the map
   * @param {string} name - Display name for the layer
   * @param {string} url - XYZ tile URL template
   * @param {L.Map} map - Leaflet map instance
   * @param {boolean} autoEnable - Whether to auto-enable the layer (default: true)
   */
  function addXyzLayer(name, url, map, autoEnable = true) {
    store.add([{ name, url }], map, autoEnable);
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
            <li class="xyz-example-url" data-url="https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png" data-name="Humanitarian OSM" style="cursor: pointer;">https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png</li>
            <li class="xyz-example-url" data-url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png" data-name="CARTO Positron" style="cursor: pointer; margin-top: 4px;">https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png</li>
            <li class="xyz-example-url" data-url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png" data-name="CARTO Dark Matter" style="cursor: pointer; margin-top: 4px;">https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png</li>
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

        if (Object.values(store.layers).some((l) => l.url === url)) {
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
    loadLayersFromStorage: store.load,
    getCustomXyzLayers: () => store.layers, // Expose custom XYZ layers for layer management
  };
})();

// Export to window for global access
window.XyzImport = XyzImport;
