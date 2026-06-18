// Copyright (C) 2025 Aron Sommer. See LICENSE file for full license details.

/**
 * POI Finder
 *
 * Category-based search for OpenStreetMap features using Overpass API.
 * Each category has its own layer. Load for current view is triggered explicitly
 * per category. Results accumulate across loads; OSM element ID deduplication
 * prevents duplicates.
 */

const POI_CLUSTER_MIN_SIZE = 30;
const POI_CLUSTER_MAX_SIZE = 50;

const POI_CATEGORIES = [
  // Outdoor
  {
    id: "park",
    group: "Outdoor",
    name: "Park",
    icon: "park",
    color: "#4CAF50",
    overpassQuery: "leisure=park",
  },
  {
    id: "viewpoint",
    group: "Outdoor",
    name: "Viewpoint",
    icon: "landscape",
    color: "#4CAF50",
    overpassQuery: "tourism=viewpoint",
  },
  // Accommodation
  {
    id: "camp_site",
    group: "Accommodation",
    name: "Camp Site",
    icon: "camping",
    color: "#FF9800",
    overpassQuery: "tourism=camp_site",
  },
  {
    id: "alpine_hut",
    group: "Accommodation",
    name: "Alpine Hut",
    icon: "cabin",
    color: "#FF9800",
    overpassQuery: "tourism=alpine_hut",
  },
  {
    id: "wilderness_hut",
    group: "Accommodation",
    name: "Wilderness Hut",
    icon: "cabin",
    color: "#FF9800",
    overpassQuery: "tourism=wilderness_hut",
  },
  // Amenities
  {
    id: "drinking_water",
    group: "Amenities",
    name: "Drinking Water",
    icon: "water_drop",
    color: "#2196F3",
    overpassQuery: "amenity=drinking_water",
  },
  {
    id: "toilets",
    group: "Amenities",
    name: "Toilets",
    icon: "wc",
    color: "#2196F3",
    overpassQuery: "amenity=toilets",
  },
  {
    id: "shelter",
    group: "Amenities",
    name: "Shelter",
    icon: "roofing",
    color: "#2196F3",
    overpassQuery: "amenity=shelter",
  },
  {
    id: "firepit",
    group: "Amenities",
    name: "Fire Pit",
    icon: "local_fire_department",
    color: "#F44336",
    overpassQuery: "leisure=firepit",
  },
  {
    id: "bbq",
    group: "Amenities",
    name: "BBQ",
    icon: "outdoor_grill",
    color: "#F44336",
    overpassQuery: "amenity=bbq",
  },
  {
    id: "bench",
    group: "Amenities",
    name: "Bench",
    icon: "chair",
    color: "#795548",
    overpassQuery: "amenity=bench",
  },
  // Transport
  {
    id: "parking",
    group: "Transport",
    name: "Parking",
    icon: "local_parking",
    color: "#607D8B",
    overpassQuery: "amenity=parking",
  },
  {
    id: "station",
    group: "Transport",
    name: "Station",
    icon: "train",
    color: "#607D8B",
    overpassQuery: "railway=station",
  },
  {
    id: "tram_stop",
    group: "Transport",
    name: "Tram Stop",
    icon: "tram",
    color: "#607D8B",
    overpassQuery: "railway=tram_stop",
  },
  {
    id: "bus_stop",
    group: "Transport",
    name: "Bus Stop",
    icon: "directions_bus",
    color: "#607D8B",
    overpassQuery: "highway=bus_stop",
  },
  {
    id: "fuel",
    group: "Transport",
    name: "Fuel",
    icon: "local_gas_station",
    color: "#607D8B",
    overpassQuery: "amenity=fuel",
  },
  // Supplies
  {
    id: "supermarket",
    group: "Supplies",
    name: "Supermarket",
    icon: "shopping_cart",
    color: "#E91E63",
    overpassQuery: "shop=supermarket",
  },
  {
    id: "convenience",
    group: "Supplies",
    name: "Convenience",
    icon: "storefront",
    color: "#E91E63",
    overpassQuery: "shop=convenience",
  },
  // Food & Drink
  {
    id: "restaurant",
    group: "Food & Drink",
    name: "Restaurant",
    icon: "restaurant",
    color: "#FF5722",
    overpassQuery: "amenity=restaurant",
  },
  {
    id: "cafe",
    group: "Food & Drink",
    name: "Cafe",
    icon: "local_cafe",
    color: "#FF5722",
    overpassQuery: "amenity=cafe",
  },
];

// Master layer group registered in the layer control — all category layers are children of this
const poiMasterLayer = L.layerGroup();

// Per-category state: cluster layer, dedup marker Map, in-flight load controller
const poiState = {};

/**
 * Initialize POI finder
 */
function initPoiFinder() {
  POI_CATEGORIES.forEach((cat) => {
    poiState[cat.id] = {
      layer: createCategoryClusterGroup(),
      markers: new Map(), // OSM element id → Leaflet marker
      loadingController: null,
    };
  });
}

/**
 * Build a MarkerClusterGroup styled for a specific category
 */
function createCategoryClusterGroup() {
  return L.markerClusterGroup({
    maxClusterRadius: 50,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    disableClusteringAtZoom: 17,
    iconCreateFunction(cluster) {
      const count = cluster.getChildCount();
      const size = Math.min(
        POI_CLUSTER_MAX_SIZE,
        Math.max(POI_CLUSTER_MIN_SIZE, POI_CLUSTER_MIN_SIZE + Math.log(count) * 5),
      );
      return L.divIcon({
        html: `<div style="
          width:${size}px;height:${size}px;border-radius:50%;
          background-color:${DEFAULT_COLOR};
          box-shadow:0 0 0 3px white,0 2px 4px rgba(0,0,0,0.3);
          display:flex;align-items:center;justify-content:center;
          font-weight:bold;color:white;
          text-shadow:0 1px 2px rgba(0,0,0,0.5);
          font-size:${Math.min(16, size / 2.5)}px;
        ">${count}</div>`,
        className: "poi-cluster-icon",
        iconSize: L.point(size, size),
      });
    },
  });
}

/**
 * Open the Find Places modal — shows all categories with visibility toggles
 */
async function showPoiFinder() {
  const MIN_ZOOM = 12;
  if (map.getZoom() < MIN_ZOOM) {
    const result = await Swal.fire({
      icon: "warning",
      title: "Zoom In Required",
      text: "Please zoom in closer to search for places. This helps ensure faster and more complete results.",
      showCancelButton: true,
      confirmButtonText: "Zoom In",
      cancelButtonText: "Cancel",
    });
    if (result.isConfirmed) {
      map.setView(map.getCenter(), MIN_ZOOM);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return showPoiFinder();
    }
    return;
  }

  const html = POI_CATEGORIES.map((cat) => {
    const isLoading = !!poiState[cat.id].loadingController;
    const count = poiState[cat.id].markers.size;
    return `
      <div class="poi-category-row">
        <span class="material-symbols poi-cat-icon">${cat.icon}</span>
        <span class="poi-cat-name">${cat.name}</span>
        <span id="poi-status-${cat.id}" class="poi-cat-status">${renderStatus(isLoading, count)}</span>
        <span id="poi-load-${cat.id}" class="poi-load-btn material-symbols${isLoading ? " poi-load-busy" : ""}" data-category="${cat.id}" title="Load for current view">${isLoading ? "sync" : "search"}</span>
      </div>`;
  }).join("");

  await Swal.fire({
    html: `<div class="poi-category-list">${html}</div>`,
    confirmButtonText: "Close",
    customClass: { popup: "poi-finder-modal" },
    didOpen: () => {
      document.querySelectorAll(".poi-load-btn").forEach((el) => {
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const cat = POI_CATEGORIES.find((c) => c.id === el.dataset.category);
          if (cat) loadCategory(cat);
        });
      });
      document.querySelectorAll(".poi-clear-btn").forEach((el) => {
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const cat = POI_CATEGORIES.find((c) => c.id === el.dataset.category);
          if (cat) clearCategory(cat);
        });
      });
    },
  });
}

function renderStatus(isLoading, count) {
  if (isLoading) return '<span class="poi-loading-dot"></span>';
  if (count > 0)
    return `${count.toLocaleString()} <span class="poi-clear-btn material-symbols" data-category="">close</span>`;
  return "";
}

/**
 * Load POIs for the current viewport into a category layer
 */
async function loadCategory(cat) {
  if (map.getZoom() < 12) {
    const result = await Swal.fire({
      icon: "warning",
      title: "Zoom In Required",
      text: "Please zoom in closer to search for places.",
      showCancelButton: true,
      confirmButtonText: "Zoom In",
      cancelButtonText: "Cancel",
    });
    if (result.isConfirmed) {
      map.setView(map.getCenter(), 12);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return;
  }

  const state = poiState[cat.id];

  if (!poiMasterLayer.hasLayer(state.layer)) {
    poiMasterLayer.addLayer(state.layer);
  }
  if (window.ensurePoiLayerVisible) {
    window.ensurePoiLayerVisible();
  }

  // Abort any in-flight request for this category
  if (state.loadingController) {
    state.loadingController.abort();
  }
  const controller = new AbortController();
  state.loadingController = controller;

  updateCategoryRowUI(cat.id, true, state.markers.size);

  try {
    const results = await queryOverpass(
      cat.overpassQuery,
      map.getBounds(),
      controller.signal,
      1000,
    );

    if (controller.signal.aborted) return;

    results.forEach((element) => {
      if (state.markers.has(element.id)) return;
      const marker = createPOIMarker(element, cat);
      if (!marker) return;
      state.markers.set(element.id, marker);
      state.layer.addLayer(marker);
    });

    updateCategoryRowUI(cat.id, false, state.markers.size);
  } catch (err) {
    if (err.name === "AbortError") return;
    updateCategoryRowUI(cat.id, false, state.markers.size);
    Swal.fire({
      icon: "error",
      title: "Load Failed",
      text: err.message || "Could not load places. Please try again.",
      confirmButtonText: "OK",
    });
  } finally {
    if (state.loadingController === controller) {
      state.loadingController = null;
    }
  }
}

/**
 * Clear all results for a category
 */
function clearCategory(cat) {
  const state = poiState[cat.id];
  if (state.loadingController) {
    state.loadingController.abort();
    state.loadingController = null;
  }
  if (poiMasterLayer.hasLayer(state.layer)) {
    poiMasterLayer.removeLayer(state.layer);
  }
  state.layer.clearLayers();
  state.markers.clear();
  updateCategoryRowUI(cat.id, false, 0);
}

/**
 * Reflect current state in the modal row — safe to call when modal is closed
 */
function updateCategoryRowUI(categoryId, isLoading, count) {
  const loadEl = document.getElementById(`poi-load-${categoryId}`);
  const statusEl = document.getElementById(`poi-status-${categoryId}`);
  if (loadEl) {
    loadEl.classList.toggle("poi-load-busy", isLoading);
    loadEl.textContent = isLoading ? "sync" : "search";
  }
  if (statusEl) {
    statusEl.innerHTML = renderStatus(isLoading, count);
    // Wire up any newly rendered clear buttons
    statusEl.querySelectorAll(".poi-clear-btn").forEach((el) => {
      el.dataset.category = categoryId;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const cat = POI_CATEGORIES.find((c) => c.id === categoryId);
        if (cat) clearCategory(cat);
      });
    });
  }
}

/**
 * Create a single POI marker with a category icon and popup
 */
function createPOIMarker(element, cat) {
  let lat, lon;
  if (element.type === "node") {
    lat = element.lat;
    lon = element.lon;
  } else if (element.center) {
    lat = element.center.lat;
    lon = element.center.lon;
  } else {
    return null;
  }

  const icon = L.divIcon({
    html: `<div class="poi-marker-icon"><span class="material-symbols">${cat.icon}</span></div>`,
    className: "poi-marker",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });

  const marker = L.marker([lat, lon], { icon });

  const name = element.tags?.name || cat.name;
  const tags = element.tags || {};
  const interestingTags = ["operator", "opening_hours", "website", "phone", "description"];

  let popupContent = `
    <div style="overflow-wrap:break-word;text-align:center;">
      <strong><span class="material-symbols" style="font-size:16px;vertical-align:middle;">${cat.icon}</span> ${name}</strong><br>
  `;
  interestingTags.forEach((tag) => {
    if (tags[tag]) {
      popupContent += `<small>${tag.replace("_", " ")}: ${tags[tag]}</small><br>`;
    }
  });
  popupContent += `
      <small style="color:var(--text-color-secondary);">
        <a href="https://www.openstreetmap.org/${element.type}/${element.id}" target="_blank">View on OpenStreetMap</a>
      </small>
    </div>
    <div style="text-align:center;margin-top:8px;">
      <button id="save-poi-marker-${element.id}" style="padding:5px 10px;border:1px solid #ccc;border-radius:var(--border-radius);cursor:pointer;background-color:#f0f0f0;">
        Save to Map
      </button>
    </div>
  `;

  marker.bindPopup(L.popup({ maxWidth: 150 }).setContent(popupContent));
  marker.on("popupopen", () => {
    const btn = document.getElementById(`save-poi-marker-${element.id}`);
    if (btn) {
      btn.addEventListener("click", () => {
        createAndSaveMarker(lat, lon, name);
        marker.closePopup();
      });
    }
  });

  return marker;
}

/**
 * Query Overpass API
 */
const OVERPASS_ENDPOINTS = [
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
];

// How long to wait for a single endpoint before giving up and trying the next one.
// Without this, a slow/hanging server could stall the search for the full query timeout (25s).
const ENDPOINT_TIMEOUT_MS = 8000;

async function queryOverpass(osmQuery, bounds, signal, limit = 1000) {
  const queries = Array.isArray(osmQuery) ? osmQuery : [osmQuery];

  const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
  const queryParts = queries
    .flatMap((q) => [`node[${q}](${bbox});`, `way[${q}](${bbox});`, `relation[${q}](${bbox});`])
    .join("\n      ");

  const query = `
    [out:json][timeout:25];
    (
      ${queryParts}
    );
    out center ${limit};
  `;

  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      // Combine the user's cancel signal with a per-endpoint timeout.
      // If the endpoint doesn't respond in time we move on to the next one,
      // but if the user cancels we stop immediately regardless.
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), ENDPOINT_TIMEOUT_MS);
      const onAbort = () => timeoutController.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      const endpointSignal = timeoutController.signal;

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          body: query,
          signal: endpointSignal,
        });
        if (response.status === 400) {
          throw new Error("400 Bad Request. Invalid query syntax. Please report this bug.");
        }
        if (response.status === 504) {
          throw new Error("504 Gateway Timeout. Try zooming in closer or selecting another area.");
        }
        if (response.status === 429) {
          lastError = new Error("Too Many Requests. Please wait a moment and try again.");
          continue;
        }
        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        }
        const data = await response.json();
        return data.elements || [];
      } finally {
        clearTimeout(timeoutId);
        signal.removeEventListener("abort", onAbort);
      }
    } catch (err) {
      // User cancelled — stop immediately
      if (err.name === "AbortError" && signal.aborted) throw err;
      // Hard query errors — retrying won't help
      if (err.message.startsWith("400") || err.message.startsWith("504")) throw err;
      // Endpoint timed out or failed — try the next one
      lastError = err.name === "AbortError" ? new Error("Endpoint timed out.") : err;
    }
  }
  throw new Error(lastError?.message || "All Overpass endpoints failed. Please try again.");
}

// Make functions globally available
window.initPoiFinder = initPoiFinder;
window.showPoiFinder = showPoiFinder;
window.poiMasterLayer = poiMasterLayer;

// Compatibility aliases expected by main.js
window.poiSearchResults = poiMasterLayer;
window.clearPOIResults = function () {
  POI_CATEGORIES.forEach((cat) => clearCategory(cat));
};
window.updatePOIFinderButton = function () {
  const btn = document.getElementById("poi-finder-btn");
  if (btn) btn.textContent = "Find Places";
};
