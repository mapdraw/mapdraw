// Copyright (C) 2025 Aron Sommer. See LICENSE file for full license details.

/**
 * POI Finder
 *
 * Simple category-based search for OpenStreetMap features using Overpass API.
 * Displays results as read-only markers on the map.
 */

// POI Marker Styling - centralized configuration
const POI_STYLE = {
  color: DEFAULT_COLOR,
  outlineColor: COLOR_WHITE,
  outlineWeight: 3,
  markerRadius: 8,
  clusterMinSize: 30,
  clusterMaxSize: 50,
};

// POI Categories with OSM tags and material symbols
const POI_CATEGORIES = [
  // Outdoor Activities (Priority)
  {
    id: "park",
    name: "Park",
    icon: "park",
    overpassQuery: ["leisure=park", "leisure=nature_reserve"],
  },
  {
    id: "camping",
    name: "Camping",
    icon: "camping",
    overpassQuery: "tourism=camp_site",
  },
  {
    id: "viewpoint",
    name: "Viewpoint",
    icon: "landscape",
    overpassQuery: "tourism=viewpoint",
  },
  {
    id: "shelter",
    name: "Shelter / Hut",
    icon: "cabin",
    overpassQuery: ["tourism=alpine_hut", "tourism=wilderness_hut", "amenity=shelter"],
  },
  {
    id: "drinking_water",
    name: "Drinking Water",
    icon: "water_drop",
    overpassQuery: "amenity=drinking_water",
  },
  {
    id: "toilet",
    name: "Toilet",
    icon: "wc",
    overpassQuery: "amenity=toilets",
  },
  {
    id: "fireplace",
    name: "Fireplace / BBQ",
    icon: "outdoor_grill",
    overpassQuery: ["amenity=bbq", "leisure=firepit"],
  },
  {
    id: "bench",
    name: "Bench",
    icon: "chair",
    overpassQuery: "amenity=bench",
  },
  // Transport & Supplies
  {
    id: "parking",
    name: "Parking",
    icon: "local_parking",
    overpassQuery: "amenity=parking",
  },
  {
    id: "public_transport",
    name: "Public Transport",
    icon: "commute",
    overpassQuery: [
      "highway=bus_stop",
      "railway=tram_stop",
      "railway=station",
      "public_transport=station",
    ],
  },
  {
    id: "gas_station",
    name: "Gas Station",
    icon: "local_gas_station",
    overpassQuery: "amenity=fuel",
  },
  {
    id: "supermarket",
    name: "Supermarket/Shop",
    icon: "shopping_cart",
    overpassQuery: ["shop=supermarket", "shop=convenience"],
  },
  // Food & Drink
  {
    id: "restaurant",
    name: "Restaurant",
    icon: "restaurant",
    overpassQuery: "amenity=restaurant",
  },
  {
    id: "cafe",
    name: "Cafe",
    icon: "local_cafe",
    overpassQuery: "amenity=cafe",
  },
];

// Global POI layer group and abort controller
let poiSearchResults = null;
let currentAbortController = null;

/**
 * Initialize POI finder
 */
function initPoiFinder() {
  // Create POI marker cluster group and add to map (will be shown in layer control)
  poiSearchResults = L.markerClusterGroup({
    maxClusterRadius: 50,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    disableClusteringAtZoom: 17,
    iconCreateFunction: function (cluster) {
      const count = cluster.getChildCount();
      const size = Math.min(
        POI_STYLE.clusterMaxSize,
        Math.max(POI_STYLE.clusterMinSize, POI_STYLE.clusterMinSize + Math.log(count) * 5),
      );

      return L.divIcon({
        html: `<div style="
          width: ${size}px;
          height: ${size}px;
          border-radius: 50%;
          background-color: ${POI_STYLE.color};
          box-shadow: 0 0 0 ${POI_STYLE.outlineWeight}px ${
            POI_STYLE.outlineColor
          }, 0 2px 4px rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          color: white;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
          font-size: ${Math.min(16, size / 2.5)}px;
        ">${count}</div>`,
        className: "poi-cluster-icon",
        iconSize: L.point(size, size),
      });
    },
  }).addTo(map);

  // Layer will be added to layer control in main.js

  // Update button text based on whether there are results
  updatePOIFinderButton();
}

/**
 * Update the Find/Clear button text and tooltip
 */
function updatePOIFinderButton() {
  const button = document.getElementById("poi-finder-btn");
  if (!button) return;

  const hasResults = poiSearchResults && poiSearchResults.getLayers().length > 0;
  const newText = hasResults ? "Clear Places" : "Find Places";
  button.textContent = newText;
  button.setAttribute("title", newText);
}

/**
 * Show POI finder modal
 */
async function showPoiFinder() {
  // Check minimum zoom level to prevent overly large area searches
  const MIN_ZOOM_LEVEL = 12;
  if (map.getZoom() < MIN_ZOOM_LEVEL) {
    const result = await Swal.fire({
      icon: "warning",
      title: "Zoom In Required",
      text: "Please zoom in closer to search for places. This helps ensure faster and more complete results.",
      showCancelButton: true,
      confirmButtonText: "Zoom In",
      cancelButtonText: "Cancel",
    });

    // Auto-zoom to minimum level when user clicks "Zoom In"
    if (result.isConfirmed) {
      map.setView(map.getCenter(), MIN_ZOOM_LEVEL);
      // Wait for zoom animation to complete before showing categories
      await new Promise((resolve) => setTimeout(resolve, 300));
      // Recursively call to show category selection after zoom
      return showPoiFinder();
    }
    return;
  }

  const categoryButtons = POI_CATEGORIES.map(
    (cat) => `
    <button
      class="poi-category-btn"
      data-category="${cat.id}"
    >
      <span class="material-symbols" style="font-size: 20px;">${cat.icon}</span>
      <span>${cat.name}</span>
    </button>
  `,
  ).join("");

  await Swal.fire({
    html: `
      <div style="text-align: left;">
        <p style="font-size: var(--font-size-12); color: var(--text-color); margin: 0 0 12px 0; text-align: center;">
          Find places in current view
        </p>
        <div class="poi-category-grid">
          ${categoryButtons}
        </div>
      </div>
    `,
    confirmButtonText: "Close",
    customClass: {
      popup: "poi-finder-modal",
    },
    didOpen: () => {
      // Add click handlers to category buttons
      document.querySelectorAll(".poi-category-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const categoryId = btn.dataset.category;
          const category = POI_CATEGORIES.find((c) => c.id === categoryId);
          if (category) {
            Swal.close();
            await searchPOICategory(category);
          }
        });
      });
    },
  });
}

/**
 * Search for POIs in a category
 */
async function searchPOICategory(category) {
  // Create new abort controller
  currentAbortController = new AbortController();

  // Show loading indicator with cancel button
  Swal.fire({
    title: "Searching...",
    html: `
      <div style="text-align: center;">
        <p style="margin-bottom: 20px;">Looking for ${category.name}</p>
        <div class="swal2-loader" style="display: block; margin: 0 auto 20px;"></div>
        <button id="poi-cancel-btn" class="swal2-cancel swal2-styled" style="display: inline-block;">Cancel</button>
      </div>
    `,
    allowOutsideClick: false,
    showCancelButton: false,
    showConfirmButton: false,
    didOpen: () => {
      // Add cancel button handler
      document.getElementById("poi-cancel-btn").addEventListener("click", () => {
        if (currentAbortController) {
          currentAbortController.abort();
        }
        Swal.close();
      });
    },
  });

  try {
    const bounds = map.getBounds();
    const RESULT_LIMIT = 1000;
    const results = await queryOverpass(
      category.overpassQuery,
      bounds,
      currentAbortController.signal,
      RESULT_LIMIT,
    );

    Swal.close();

    if (results.length === 0) {
      Swal.fire({
        title: "No Results",
        text: `No ${category.name} found in current map view`,
        timer: 2000,
        showConfirmButton: false,
      });
      return;
    }

    // Clear existing POI results
    clearPOIResults();

    // Display results on map
    displayPOIResults(results, category);

    // Ensure the POI layer is visible in layer control
    if (window.ensurePoiLayerVisible) {
      window.ensurePoiLayerVisible();
    }

    // Update button to show "Clear"
    updatePOIFinderButton();

    // Show success message with limit warning if needed
    const hitLimit = results.length >= RESULT_LIMIT;
    Swal.fire({
      title: "Found!",
      html: hitLimit
        ? `Showing first ${results.length} ${category.name}${
            results.length !== 1 ? "s" : ""
          }<br><small style="color: var(--text-color-secondary);"><strong>Search again after zooming in for complete area coverage.</strong></small>`
        : `${results.length} ${category.name}${results.length !== 1 ? "s" : ""} found`,
      timer: hitLimit ? 3000 : 2000,
      showConfirmButton: hitLimit,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      // Request was cancelled
      Swal.fire({
        title: "Cancelled",
        text: "Search was cancelled",
        timer: 1500,
        showConfirmButton: false,
      });
    } else {
      Swal.fire({
        icon: "error",
        title: "Search Failed",
        text: error.message || "Could not complete search. Please try again.",
        confirmButtonText: "OK",
      });
    }
  }
}

/**
 * Query Overpass API
 */
async function queryOverpass(osmQuery, bounds, signal, limit = 1000) {
  // Handle both single query strings and arrays of queries
  const queries = Array.isArray(osmQuery) ? osmQuery : [osmQuery];

  // Build query parts for each tag
  const queryParts = queries
    .flatMap((q) => [
      `node[${q}](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});`,
      `way[${q}](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});`,
      `relation[${q}](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});`,
    ])
    .join("\n      ");

  const query = `
    [out:json][timeout:25];
    (
      ${queryParts}
    );
    out center ${limit};
  `;

  // Primary endpoint: Official lz4 load-balanced instance (fastest and most reliable)
  // Fallbacks for reference if the primary goes down:
  // - https://overpass-api.de/api/interpreter
  // - https://z.overpass-api.de/api/interpreter
  // - https://overpass.kumi.systems/api/interpreter (Note: known to occasionally timeout)
  const response = await fetch("https://lz4.overpass-api.de/api/interpreter", {
    method: "POST",
    body: query,
    signal: signal,
  });

  if (!response.ok) {
    // Provide specific error messages for different failure types
    if (response.status === 504) {
      throw new Error("504 Gateway Timeout. Try zooming in closer or selecting another area.");
    } else if (response.status === 429) {
      throw new Error("429 Too Many Requests. Please wait a moment and try again.");
    } else if (response.status === 400) {
      throw new Error("400 Bad Request. Invalid query syntax. Please report this bug.");
    } else {
      throw new Error(`Overpass API request failed: ${response.status} ${response.statusText}`);
    }
  }

  const data = await response.json();
  return data.elements || [];
}

/**
 * Display POI results on map
 */
function displayPOIResults(results, category) {
  results.forEach((element) => {
    let lat, lon;

    // Get coordinates based on element type
    if (element.type === "node") {
      lat = element.lat;
      lon = element.lon;
    } else if (element.center) {
      lat = element.center.lat;
      lon = element.center.lon;
    } else {
      return; // Skip if no coordinates
    }

    // Create circle marker with white outline for visibility on all base maps
    const marker = L.circleMarker([lat, lon], {
      radius: POI_STYLE.markerRadius,
      fillColor: POI_STYLE.color,
      color: POI_STYLE.outlineColor,
      weight: POI_STYLE.outlineWeight,
      opacity: 1,
      fillOpacity: 1,
    });

    // Create popup content
    const name = element.tags?.name || category.name;
    const tags = element.tags || {};

    let popupContent = `
      <div style="overflow-wrap: break-word; text-align: center;">
        <strong><span class="material-symbols" style="font-size: 16px; vertical-align: middle;">${category.icon}</span> ${name}</strong><br>
    `;

    // Add relevant tags
    const interestingTags = ["operator", "opening_hours", "website", "phone", "description"];
    interestingTags.forEach((tag) => {
      if (tags[tag]) {
        const tagLabel = tag.replace("_", " ");
        popupContent += `<small>${tagLabel}: ${tags[tag]}</small><br>`;
      }
    });

    popupContent += `
        <small style="color: var(--text-color-secondary);">
          <a href="https://www.openstreetmap.org/${element.type}/${element.id}" target="_blank" style="color: var(--link-color);">
            View on OpenStreetMap
          </a>
        </small>
      </div>
      <div style="text-align: center; margin-top: 8px;">
        <button id="save-poi-marker-${element.id}" style="padding: 5px 10px; border: 1px solid #ccc; border-radius: var(--border-radius); cursor: pointer; background-color: #f0f0f0;">
          Save to Map
        </button>
      </div>
    `;

    const popup = L.popup({ maxWidth: 150 });
    popup.setContent(popupContent);
    marker.bindPopup(popup);

    // Add event listener for "Save as Marker" button when popup opens
    marker.on("popupopen", () => {
      const saveButton = document.getElementById(`save-poi-marker-${element.id}`);
      if (saveButton) {
        saveButton.addEventListener("click", () => {
          createAndSaveMarker(lat, lon, name);
          marker.closePopup();
        });
      }
    });

    marker.addTo(poiSearchResults);
  });
}

/**
 * Clear all POI results from map
 */
function clearPOIResults() {
  if (poiSearchResults) {
    // MarkerClusterGroup.clearLayers() only works when layer is on the map
    // Temporarily add it if needed, clear, then restore previous state
    const wasOnMap = map.hasLayer(poiSearchResults);
    if (!wasOnMap) {
      map.addLayer(poiSearchResults);
    }

    poiSearchResults.clearLayers();

    // Remove from map again if it wasn't on the map before
    if (!wasOnMap) {
      map.removeLayer(poiSearchResults);
    }
  }
  // Update button to show "Find"
  updatePOIFinderButton();
}

// Make functions globally available
window.initPoiFinder = initPoiFinder;
window.showPoiFinder = showPoiFinder;
window.clearPOIResults = clearPOIResults;
window.updatePOIFinderButton = updatePOIFinderButton;
