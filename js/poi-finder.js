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
const POI_MIN_ZOOM = 12;
const POI_RESULT_LIMIT = 1000;

const POI_CATEGORIES = (() => {
  const colorCustom = "#696969";
  const colorOutdoor = "#228B22";
  const colorAccommodation = "#FF8C00";
  const colorAmenities = "#20B2AA";
  const colorCycling = "#9932CC";
  const colorTransport = "#4169E1";
  const colorFoodShopping = "#FF6347";
  return [
    // Custom
    {
      id: "custom",
      name: "Custom",
      icon: "category",
      color: colorCustom,
      overpassQuery: "",
      isCustom: true,
    },
    // Outdoor
    {
      id: "park",
      name: "Park",
      icon: "park",
      color: colorOutdoor,
      overpassQuery: "leisure=park",
    },
    {
      id: "viewpoint",
      name: "Viewpoint",
      icon: "landscape",
      color: colorOutdoor,
      overpassQuery: "tourism=viewpoint",
    },
    {
      id: "peak",
      name: "Peak",
      icon: "mountain_flag",
      color: colorOutdoor,
      overpassQuery: "natural=peak",
    },
    {
      id: "picnic_site",
      name: "Picnic Site",
      icon: "deck",
      color: colorOutdoor,
      overpassQuery: "tourism=picnic_site",
    },
    {
      id: "picnic_table",
      name: "Picnic Table",
      icon: "deck",
      color: colorOutdoor,
      overpassQuery: "leisure=picnic_table",
    },
    // Accommodation
    {
      id: "camp_site",
      name: "Camp Site",
      icon: "camping",
      color: colorAccommodation,
      overpassQuery: "tourism=camp_site",
    },
    {
      id: "alpine_hut",
      name: "Alpine Hut",
      icon: "cabin",
      color: colorAccommodation,
      overpassQuery: "tourism=alpine_hut",
    },
    {
      id: "wilderness_hut",
      name: "Wilderness Hut",
      icon: "cabin",
      color: colorAccommodation,
      overpassQuery: "tourism=wilderness_hut",
    },
    // Amenities
    {
      id: "drinking_water",
      name: "Drinking Water",
      icon: "water_drop",
      color: colorAmenities,
      overpassQuery: "amenity=drinking_water",
    },
    {
      id: "toilets",
      name: "Toilets",
      icon: "wc",
      color: colorAmenities,
      overpassQuery: "amenity=toilets",
    },
    {
      id: "shelter",
      name: "Shelter",
      icon: "roofing",
      color: colorAmenities,
      overpassQuery: "amenity=shelter",
    },
    {
      id: "firepit",
      name: "Fire Pit",
      icon: "local_fire_department",
      color: colorAmenities,
      overpassQuery: "leisure=firepit",
    },
    {
      id: "bbq",
      name: "BBQ",
      icon: "outdoor_grill",
      color: colorAmenities,
      overpassQuery: "amenity=bbq",
    },
    {
      id: "bench",
      name: "Bench",
      icon: "chair",
      color: colorAmenities,
      overpassQuery: "amenity=bench",
    },
    // Cycling
    {
      id: "bicycle",
      name: "Bicycle Shop",
      icon: "pedal_bike",
      color: colorCycling,
      overpassQuery: "shop=bicycle",
    },
    {
      id: "bicycle_parking",
      name: "Bicycle Parking",
      icon: "pedal_bike",
      color: colorCycling,
      overpassQuery: "amenity=bicycle_parking",
    },
    // Transport
    {
      id: "station",
      name: "Station",
      icon: "train",
      color: colorTransport,
      overpassQuery: "railway=station",
    },
    {
      id: "tram_stop",
      name: "Tram Stop",
      icon: "tram",
      color: colorTransport,
      overpassQuery: "railway=tram_stop",
    },
    {
      id: "bus_stop",
      name: "Bus Stop",
      icon: "directions_bus",
      color: colorTransport,
      overpassQuery: "highway=bus_stop",
    },
    {
      id: "parking",
      name: "Parking",
      icon: "local_parking",
      color: colorTransport,
      overpassQuery: "amenity=parking",
    },
    {
      id: "fuel",
      name: "Fuel",
      icon: "local_gas_station",
      color: colorTransport,
      overpassQuery: "amenity=fuel",
    },
    // Food & Shopping
    {
      id: "supermarket",
      name: "Supermarket",
      icon: "shopping_cart",
      color: colorFoodShopping,
      overpassQuery: "shop=supermarket",
    },
    {
      id: "convenience",
      name: "Convenience",
      icon: "storefront",
      color: colorFoodShopping,
      overpassQuery: "shop=convenience",
    },
    {
      id: "restaurant",
      name: "Restaurant",
      icon: "restaurant",
      color: colorFoodShopping,
      overpassQuery: "amenity=restaurant",
    },
    {
      id: "cafe",
      name: "Cafe",
      icon: "local_cafe",
      color: colorFoodShopping,
      overpassQuery: "amenity=cafe",
    },
  ];
})();

let customQueryValue = "";
let customLastSearchedQuery = "";
const POI_CUSTOM_QUERY_KEY = "poiCustomQuery";

// Master layer group registered in the layer control — all category layers are children of this
const poiMasterLayer = L.featureGroup();

// Per-category state: cluster layer, marker Map (dedup+count), raw element Map (persistence), load controller
const poiState = {};

const POI_DB_KEY = "poiResults";
const POI_POPUP_TAGS = [
  "opening_hours",
  "website",
  "phone",
  "email",
  "operator",
  "cuisine",
  "description",
  "fee",
  "wheelchair",
];

function _formatPopupTagValue(tag, rawValue) {
  const display = escHtml(rawValue);
  if (tag === "website" || tag.startsWith("website:") || tag.endsWith(":website")) {
    const raw =
      rawValue.startsWith("http://") || rawValue.startsWith("https://")
        ? rawValue
        : `https://${rawValue}`;
    let safeHref;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
      safeHref = parsed.href;
    } catch {
      safeHref = null;
    }
    if (!safeHref) return display;
    return `<a href="${escHtml(safeHref)}" target="_blank" rel="noopener">${display}</a>`;
  }
  if (tag === "phone" || tag === "contact:phone")
    return `<a href="tel:${encodeURI(rawValue.replace(/\s+/g, ""))}">${display}</a>`;
  if (tag === "email" || tag === "contact:email")
    return `<a href="mailto:${encodeURI(rawValue)}">${display}</a>`;
  return display;
}

/**
 * Initialize POI finder and restore any previously saved results
 */
function initPoiFinder() {
  poiMasterLayer.addTo(map);
  POI_CATEGORIES.forEach((cat) => {
    poiState[cat.id] = {
      layer: createCategoryClusterGroup(cat.color),
      markers: new Map(), // key → Leaflet marker
      rawElements: new Map(), // key → raw OSM element (for persistence)
      loadingController: null,
    };
  });
}

/**
 * Returns [lat, lon] for any OSM element, or null if coordinates are unavailable.
 */
function _elementLatLon(element) {
  if (element.type === "node") return [element.lat, element.lon];
  if (element.center) return [element.center.lat, element.center.lon];
  return null;
}

/**
 * Pure diff function — no Leaflet or browser APIs, safe to unit-test.
 *
 * All stored elements inside the queried bounds are removed and replaced with
 * the fresh Overpass results. This ensures updates to existing OSM elements
 * (tag changes, renames, etc.) are always reflected after a search.
 *
 * Elements outside the queried bounds are left untouched: we have no fresh data
 * for those areas so we cannot tell whether they still exist.
 */
function _computePoiDiff(rawElements, newResults, bounds) {
  const toRemove = [];
  for (const [key, element] of rawElements) {
    const ll = _elementLatLon(element);
    if (!ll) continue;
    if (bounds.contains(ll)) toRemove.push(key);
  }

  return { toRemove, toAdd: newResults };
}

async function _savePoiDb() {
  try {
    const toStore = {};
    POI_CATEGORIES.forEach((cat) => {
      const { rawElements } = poiState[cat.id];
      if (rawElements.size > 0) toStore[cat.id] = Array.from(rawElements.values());
    });
    if (Object.keys(toStore).length === 0) {
      await idbKeyval.del(POI_DB_KEY);
    } else {
      await idbKeyval.set(POI_DB_KEY, toStore);
    }
  } catch (e) {
    console.warn("POI: IndexedDB save failed", e);
  }
}

async function _restorePoiFromDb() {
  try {
    const savedQuery = await idbKeyval.get(POI_CUSTOM_QUERY_KEY);
    if (savedQuery) {
      customQueryValue = savedQuery;
      customLastSearchedQuery = savedQuery;
    }
    const stored = await idbKeyval.get(POI_DB_KEY);
    if (!stored) return;
    for (const [catId, elements] of Object.entries(stored)) {
      const cat = POI_CATEGORIES.find((c) => c.id === catId);
      if (!cat) continue;
      const state = poiState[catId];
      if (!state) continue;
      elements.forEach((element) => {
        const key = `${element.type}/${element.id}`;
        if (state.markers.has(key)) return;
        const marker = createPOIMarker(element, cat);
        if (!marker) return;
        state.markers.set(key, marker);
        state.rawElements.set(key, element);
        state.layer.addLayer(marker);
      });
      if (state.markers.size > 0 && !poiMasterLayer.hasLayer(state.layer)) {
        poiMasterLayer.addLayer(state.layer);
      }
    }
    if (window.ensurePoiLayerVisible) window.ensurePoiLayerVisible();
    _updatePoiFinderDot();
    // Remove any stored data for categories that no longer exist in POI_CATEGORIES
    await _savePoiDb();
  } catch (e) {
    console.warn("POI: IndexedDB restore failed", e);
  }
}

/**
 * Build a MarkerClusterGroup styled for a specific category color
 */
function createCategoryClusterGroup(color) {
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
          background-color:${color};
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
  const html = POI_CATEGORIES.map((cat) => {
    const state = poiState[cat.id];
    const isLoading = !!state.loadingController;
    const count = state.markers.size;
    const isVisible = count > 0 && poiMasterLayer.hasLayer(state.layer);
    const row = `
      <div class="poi-category-row">
        <span class="material-symbols poi-cat-icon" style="color:${cat.color}">${cat.icon}</span>
        <span class="poi-cat-name">${cat.name}</span>
        ${cat.isCustom ? '<span id="poi-custom-info-btn" class="settings-info-icon material-symbols" title="What\'s this?">info</span>' : ""}
        <span id="poi-status-${cat.id}" class="poi-cat-status">${renderStatus(isLoading, count, cat.id)}</span>
        <span id="poi-vis-${cat.id}" class="poi-vis-btn material-symbols${count === 0 ? " poi-vis-hidden" : ""}" data-category="${cat.id}" title="Toggle visibility">${isVisible ? "visibility" : "visibility_off"}</span>
        <span id="poi-load-${cat.id}" class="poi-load-btn material-symbols${isLoading ? " poi-load-busy" : ""}" data-category="${cat.id}" title="Search for current view">${isLoading ? "autorenew" : "search"}</span>
      </div>`;
    if (cat.isCustom) {
      return `<div class="poi-custom-section"><div class="poi-custom-group">${row}<div class="poi-custom-input-row"><textarea id="poi-custom-query-input" class="poi-custom-input" placeholder="e.g. amenity=pharmacy, tourism=hotel" rows="1">${escHtml(customQueryValue)}</textarea></div></div><div id="poi-msg-${cat.id}" class="poi-cat-msg" style="display:none"></div></div>`;
    }
    return `${row}<div id="poi-msg-${cat.id}" class="poi-cat-msg" style="display:none"></div>`;
  }).join("");

  await Swal.fire({
    title: "Find Places",
    html: `<div class="poi-category-list">${html}</div>`,
    confirmButtonText: "Close",
    showDenyButton: true,
    denyButtonText: "Clear All",
    customClass: { popup: "poi-finder-modal", denyButton: "swal-confirm-danger" },
    preDeny: async () => {
      const anyLoaded = POI_CATEGORIES.some((cat) => poiState[cat.id].markers.size > 0);
      if (!anyLoaded) return false;
      const result = await Swal.fire({
        title: "Clear all found places?",
        text: "This action cannot be undone.",
        icon: "warning",
        showCancelButton: true,
        customClass: { confirmButton: "swal-confirm-danger" },
        confirmButtonText: "Yes, clear all",
      });
      if (result.isConfirmed) {
        POI_CATEGORIES.forEach((cat) => clearCategory(cat));
      }
      await showPoiFinder();
      return false;
    },
    didOpen: () => {
      const denyBtn = Swal.getDenyButton();
      if (denyBtn)
        denyBtn.disabled = !POI_CATEGORIES.some((cat) => poiState[cat.id].markers.size > 0);
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
      document.querySelectorAll(".poi-vis-btn").forEach((el) => {
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const cat = POI_CATEGORIES.find((c) => c.id === el.dataset.category);
          if (cat) toggleCategoryVisibility(cat);
        });
      });
      const customInfoBtn = document.getElementById("poi-custom-info-btn");
      if (customInfoBtn) {
        customInfoBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const customInput = document.getElementById("poi-custom-query-input");
          if (customInput) customQueryValue = customInput.value;
          Swal.fire({
            title: "Custom Query",
            html: `<p style="text-align:left;margin:0 0 12px 0">Enter an OSM tag in <code>key=value</code> format. Separate multiple tags with commas to search for several types at once.</p><p style="text-align:left;margin:0 0 12px 0"><strong>Example:</strong> <code>amenity=pharmacy, tourism=hotel</code></p><p style="text-align:left;margin:0"><a href="https://wiki.openstreetmap.org/wiki/Map_features" target="_blank">Browse all possible map features</a></p>`,
            confirmButtonText: "Got it!",
          }).then(() => showPoiFinder());
        });
      }
      const customInput = document.getElementById("poi-custom-query-input");
      if (customInput) {
        customInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            loadCategory(POI_CATEGORIES.find((c) => c.isCustom));
          }
        });
      }
    },
  });
}

function showCategoryMsg(catId, text, isInfo = false) {
  const el = document.getElementById(`poi-msg-${catId}`);
  if (el) {
    el.textContent = text;
    el.style.display = "block";
    el.classList.toggle("poi-cat-msg--info", isInfo);
  }
}

function clearCategoryMsg(catId) {
  const el = document.getElementById(`poi-msg-${catId}`);
  if (el) {
    el.style.display = "none";
    el.textContent = "";
  }
}

function renderStatus(isLoading, count, catId) {
  if (isLoading) return "";
  if (count > 0)
    return `${count.toLocaleString()} <span class="poi-clear-btn material-symbols material-symbols-fill" data-category="${catId}" title="Clear">cancel</span>`;
  return "";
}

/**
 * Load POIs for the current viewport into a category layer
 */
async function loadCategory(cat) {
  let osmQuery = cat.overpassQuery;
  if (cat.isCustom) {
    const input = document.getElementById("poi-custom-query-input");
    const rawInput = (input ? input.value : customQueryValue).trim();
    const queries = rawInput
      .split(",")
      .map((q) =>
        q
          .trim()
          .toLowerCase()
          .replace(/\s*=\s*/g, "="),
      )
      .filter(Boolean);
    if (queries.length === 0) {
      showCategoryMsg(cat.id, "Enter an OSM tag query, e.g. amenity=drinking_water", true);
      return;
    }
    const invalid = queries.find((q) => {
      const i = q.indexOf("=");
      if (i === -1) return true;
      if (q.includes('"') || q.includes("[") || q.includes("]")) return true;
      return !q.slice(0, i).trim() || !q.slice(i + 1).trim();
    });
    if (invalid) {
      showCategoryMsg(
        cat.id,
        `Invalid query "${invalid}". Use key=value format, e.g. amenity=pharmacy`,
      );
      return;
    }
    const normalizedInput = queries.join(", ");
    if (input) input.value = normalizedInput;
    customQueryValue = normalizedInput;
    osmQuery = queries.length === 1 ? queries[0] : queries;
  }

  if (map.getZoom() < POI_MIN_ZOOM) {
    const result = await Swal.fire({
      icon: "warning",
      title: "Zoom In Required",
      text: `Please zoom in to level ${POI_MIN_ZOOM} or closer to search for places.`,
      showCancelButton: true,
      confirmButtonText: "Zoom In",
      cancelButtonText: "Cancel",
    });
    if (result.isConfirmed) {
      map.setView(map.getCenter(), POI_MIN_ZOOM);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await showPoiFinder();
    return;
  }

  const state = poiState[cat.id];

  if (cat.isCustom) {
    if (customQueryValue !== customLastSearchedQuery) {
      state.layer.clearLayers();
      state.markers.clear();
      state.rawElements.clear();
      _savePoiDb();
    }
    customLastSearchedQuery = customQueryValue;
    try {
      await idbKeyval.set(POI_CUSTOM_QUERY_KEY, customQueryValue);
    } catch (e) {}
  }

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

  clearCategoryMsg(cat.id);
  updateCategoryRowUI(cat.id, true, state.markers.size);

  // Capture bounds now — used for both the query and the diff after the async call
  const bounds = map.getBounds();

  try {
    const results = await queryOverpass(osmQuery, bounds, controller.signal, POI_RESULT_LIMIT);

    if (controller.signal.aborted) {
      updateCategoryRowUI(cat.id, false, state.markers.size);
      return;
    }

    const { toRemove, toAdd } = _computePoiDiff(state.rawElements, results, bounds);

    toRemove.forEach((key) => {
      const marker = state.markers.get(key);
      if (marker) state.layer.removeLayer(marker);
      state.markers.delete(key);
      state.rawElements.delete(key);
    });

    toAdd.forEach((element) => {
      const key = `${element.type}/${element.id}`;
      if (state.markers.has(key)) return;
      const marker = createPOIMarker(element, cat);
      if (!marker) return;
      state.markers.set(key, marker);
      state.rawElements.set(key, element);
      state.layer.addLayer(marker);
    });

    _savePoiDb();
    updateCategoryRowUI(cat.id, false, state.markers.size);
    if (results.length === 0) {
      showCategoryMsg(
        cat.id,
        cat.isCustom
          ? "No results found in current view."
          : `No ${cat.name.toLowerCase()} found in current view.`,
        true,
      );
    } else if (
      results.filter((e) => e.type !== "node").length >= POI_RESULT_LIMIT ||
      results.filter((e) => e.type === "node").length >= POI_RESULT_LIMIT
    ) {
      showCategoryMsg(cat.id, `Too many results to show. Zoom in and search again.`, true);
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    updateCategoryRowUI(cat.id, false, state.markers.size);
    showCategoryMsg(cat.id, err.message || "Could not load places. Please try again.");
  } finally {
    if (state.loadingController === controller) {
      state.loadingController = null;
    }
  }
}

/**
 * Toggle map visibility for a category without clearing its markers
 */
function toggleCategoryVisibility(cat) {
  const state = poiState[cat.id];
  if (state.markers.size === 0) return;
  if (poiMasterLayer.hasLayer(state.layer)) {
    poiMasterLayer.removeLayer(state.layer);
  } else {
    poiMasterLayer.addLayer(state.layer);
  }
  updateCategoryRowUI(cat.id, !!state.loadingController, state.markers.size);
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
  state.rawElements.clear();
  if (cat.isCustom) {
    customQueryValue = "";
    customLastSearchedQuery = "";
    idbKeyval.del(POI_CUSTOM_QUERY_KEY).catch(() => {});
    const input = document.getElementById("poi-custom-query-input");
    if (input) input.value = "";
  }
  _savePoiDb();
  updateCategoryRowUI(cat.id, false, 0);
}

function _updatePoiFinderDot() {
  const btn = document.getElementById("poi-finder-btn");
  if (btn)
    btn.classList.toggle(
      "poi-has-results",
      POI_CATEGORIES.some((cat) => poiState[cat.id].markers.size > 0),
    );
}

/**
 * Reflect current state in the modal row — safe to call when modal is closed
 */
function updateCategoryRowUI(categoryId, isLoading, count) {
  const loadEl = document.getElementById(`poi-load-${categoryId}`);
  const statusEl = document.getElementById(`poi-status-${categoryId}`);
  const visEl = document.getElementById(`poi-vis-${categoryId}`);
  if (loadEl) {
    loadEl.classList.toggle("poi-load-busy", isLoading);
    loadEl.textContent = isLoading ? "autorenew" : "search";
  }
  if (statusEl) {
    statusEl.innerHTML = renderStatus(isLoading, count, categoryId);
    statusEl.querySelectorAll(".poi-clear-btn").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const cat = POI_CATEGORIES.find((c) => c.id === categoryId);
        if (cat) clearCategory(cat);
      });
    });
  }
  if (visEl) {
    const isVisible = count > 0 && poiMasterLayer.hasLayer(poiState[categoryId].layer);
    visEl.classList.toggle("poi-vis-hidden", count === 0);
    visEl.textContent = isVisible ? "visibility" : "visibility_off";
  }
  if (Swal.getPopup()?.classList.contains("poi-finder-modal")) {
    const denyBtn = Swal.getDenyButton();
    if (denyBtn)
      denyBtn.disabled = !POI_CATEGORIES.some((cat) => poiState[cat.id].markers.size > 0);
  }
  _updatePoiFinderDot();
}

/**
 * Create a single POI marker with a category icon and popup
 */
function createPOIMarker(element, cat) {
  const ll = _elementLatLon(element);
  if (!ll) return null;
  const [lat, lon] = ll;

  const icon = L.divIcon({
    html: `<div class="poi-marker-icon" style="background-color:${cat.color}"><span class="material-symbols">${cat.icon}</span></div>`,
    className: "poi-marker",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -5],
  });

  const marker = L.marker([lat, lon], { icon });

  const name = element.tags?.name || cat.name;
  const tags = element.tags || {};

  let popupContent = `
    <div style="overflow-wrap:break-word;text-align:center;">
      <strong><span class="material-symbols" style="font-size:16px;vertical-align:middle;">${cat.icon}</span> ${escHtml(name)}</strong><br>
  `;
  if (cat.isCustom && customLastSearchedQuery) {
    const queries = customLastSearchedQuery
      .split(",")
      .map((q) => q.trim())
      .filter(Boolean);
    const matched = queries.find((q) => {
      const i = q.indexOf("=");
      return i !== -1 && tags[q.slice(0, i)] === q.slice(i + 1);
    });
    if (matched)
      popupContent += `<small style="color:var(--text-color-secondary);">${escHtml(matched)}</small><br>`;
  }
  POI_POPUP_TAGS.forEach((tag) => {
    if (tags[tag]) {
      popupContent += `<small>${tag.replaceAll("_", " ")}: ${_formatPopupTagValue(tag, tags[tag])}</small><br>`;
    }
  });
  popupContent += `
      <small style="color:var(--text-color-secondary);">
        <a href="https://www.openstreetmap.org/${element.type}/${element.id}" target="_blank">View on OpenStreetMap</a>
      </small>
    </div>
    <div style="text-align:center;margin-top:8px;">
      <button id="save-poi-marker-${element.type}-${element.id}" style="padding:5px 10px;border-radius:var(--border-radius);cursor:pointer;">
        Save to Map
      </button>
    </div>
  `;

  marker.bindPopup(L.popup({ maxWidth: 150, closeButton: false }).setContent(popupContent));
  marker.on("popupopen", () => {
    const btn = document.getElementById(`save-poi-marker-${element.type}-${element.id}`);
    if (btn) {
      btn.addEventListener(
        "click",
        () => {
          createAndSaveMarker(lat, lon, name);
          marker.closePopup();
        },
        { once: true },
      );
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
const ENDPOINT_TIMEOUT_MS = 10000;
// Server-side Overpass timeout sent in the query directive.
const OVERPASS_TIMEOUT_S = 25;

async function queryOverpass(osmQuery, bounds, signal, limit = POI_RESULT_LIMIT) {
  const queries = Array.isArray(osmQuery) ? osmQuery : [osmQuery];

  const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
  const filters = queries.map((q) => {
    const i = q.indexOf("=");
    return i === -1 ? `["${q}"]` : `["${q.slice(0, i)}"="${q.slice(i + 1)}"]`;
  });
  const wayRelParts = filters
    .flatMap((f) => [`way${f}(${bbox});`, `relation${f}(${bbox});`])
    .join("\n      ");
  const nodeParts = filters.map((f) => `node${f}(${bbox});`).join("\n      ");

  // Ways and relations are output first so that the per-type limit is not
  // consumed entirely by nodes in dense areas (e.g. amenity=parking in a city).
  const query = `
    [out:json][timeout:${OVERPASS_TIMEOUT_S}];
    (
      ${wayRelParts}
    );
    out center ${limit};
    (
      ${nodeParts}
    );
    out ${limit};
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
      lastError =
        err.name === "AbortError"
          ? new Error("Endpoint timed out.")
          : new Error("Could not connect to Overpass API. Please try again later.");
    }
  }
  throw new Error(
    lastError?.message || "Could not connect to Overpass API. Please try again later.",
  );
}

// Make functions globally available
window.initPoiFinder = initPoiFinder;
window.showPoiFinder = showPoiFinder;
window._restorePoiFromDb = _restorePoiFromDb;
window.poiMasterLayer = poiMasterLayer;
