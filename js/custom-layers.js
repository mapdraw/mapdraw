// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * Creates a store for user-imported tile layers (shared by WmsImport and XyzImport):
 * owns the layers map, the custom-layers-panel rows, and localStorage persistence.
 * @param {Object} options
 * @param {string} options.storageKey - localStorage key
 * @param {string} options.idPrefix - Layer ID prefix, e.g. "wms-custom-"
 * @param {string} options.kind - Layer kind for console warnings, e.g. "WMS"
 * @param {Function} options.createLayer - (layerData) => Leaflet tile layer
 * @returns {{ layers: Object, add: Function, load: Function }}
 */
function createCustomLayerStore({ storageKey, idPrefix, kind, createLayer }) {
  const layers = {}; // Custom layers by ID
  let idCounter = 0;

  /**
   * Adds a row for the layer to the custom layers panel
   * @param {string} layerId - Unique layer ID
   * @param {string} displayName - Display name for the layer
   * @param {L.TileLayer} layer - Leaflet tile layer instance
   * @param {L.Map} map - Leaflet map instance
   * @param {boolean} autoEnable - Whether to add the layer to the map now (default: true)
   */
  function addToLayersControl(layerId, displayName, layer, map, autoEnable = true) {
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

    if (autoEnable) {
      map.addLayer(layer);
      layers[layerId].addedToMap = true;
    }

    // Match map stacking to list order
    if (typeof window.reapplyOverlayZIndex === "function") {
      window.reapplyOverlayZIndex();
    }

    if (typeof window.saveOverlayOrder === "function") {
      window.saveOverlayOrder();
    }

    const checkbox = label.querySelector("input");
    checkbox.addEventListener("change", (e) => {
      if (e.target.checked) {
        map.addLayer(layer);
        layers[layerId].addedToMap = true;
        if (typeof window.reapplyOverlayZIndex === "function") {
          window.reapplyOverlayZIndex();
        }
      } else {
        map.removeLayer(layer);
        layers[layerId].addedToMap = false;
      }
      save();
    });

    const removeIcon = label.querySelector(".layer-remove-icon");
    removeIcon.addEventListener("click", (e) => {
      e.stopPropagation();
      remove(layerId, map);
    });
  }

  /**
   * Removes a layer from the map, the panel, and localStorage
   * @param {string} layerId - Layer ID to remove
   * @param {L.Map} map - Leaflet map instance
   */
  function remove(layerId, map) {
    const layerData = layers[layerId];
    if (!layerData) return;

    if (layerData.addedToMap) {
      map.removeLayer(layerData.layer);
    }

    const customPanel = document.getElementById("custom-layers-panel");
    const checkbox = customPanel?.querySelector(`input[data-layer-id="${layerId}"]`);
    if (checkbox) {
      checkbox.closest("label").remove();
    }

    delete layers[layerId];
    save();

    // Drop the deleted ID from the saved overlay order
    if (typeof window.saveOverlayOrder === "function") {
      window.saveOverlayOrder();
    }
  }

  /**
   * Creates layers, adds them to the panel, and saves to localStorage
   * @param {Array<Object>} entries - `{ name, ...fields }` per layer; fields are persisted
   * @param {L.Map} map - Leaflet map instance
   * @param {boolean} [autoEnable=true] - Whether to add the layers to the map now
   */
  function add(entries, map, autoEnable = true) {
    entries.forEach((entry) => {
      const layerId = `${idPrefix}${idCounter++}`;
      const layerData = { id: layerId, ...entry, addedToMap: false };
      layerData.layer = createLayer(layerData);
      layers[layerId] = layerData;
      addToLayersControl(layerId, layerData.name, layerData.layer, map, autoEnable);
    });
    save();
  }

  /**
   * Saves all layers, minus their Leaflet instances, to localStorage
   */
  function save() {
    const layersToSave = Object.values(layers).map(({ layer, ...layerData }) => layerData);

    try {
      localStorage.setItem(storageKey, JSON.stringify(layersToSave));
    } catch (e) {
      console.warn(`Failed to save ${kind} layers to localStorage:`, e);
    }
  }

  /**
   * Restores layers from localStorage
   * @param {L.Map} map - Leaflet map instance
   */
  function load(map) {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return;

    let layersData;
    try {
      layersData = JSON.parse(saved);
    } catch (e) {
      console.warn(`Failed to load ${kind} layers from localStorage:`, e);
      return;
    }

    if (!Array.isArray(layersData)) return;

    layersData.forEach((layerData) => {
      try {
        const layer = createLayer(layerData);
        layers[layerData.id] = { ...layerData, layer };
        addToLayersControl(layerData.id, layerData.name, layer, map, layerData.addedToMap);

        // Keep new IDs above restored ones
        const idNum = parseInt(layerData.id.replace(idPrefix, ""), 10);
        if (!isNaN(idNum) && idNum >= idCounter) {
          idCounter = idNum + 1;
        }
      } catch (e) {
        console.warn(`Failed to restore ${kind} layer:`, layerData?.id, e);
      }
    });
  }

  return { layers, add, load };
}
