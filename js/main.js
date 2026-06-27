// Copyright (C) 2025 Aron Sommer. See LICENSE file for full license details.

// Apply saved theme on load — glass is default for new users
(function () {
  const theme = localStorage.getItem("theme") ?? "glass";
  if (theme === "dark") document.body.classList.add("dark-mode");
  else if (theme === "light") document.body.classList.add("light-mode");
  else document.body.classList.add("glass-mode");
})();

// Apply saved layout preference on load
(function () {
  const forceDesktopLayout = localStorage.getItem("forceDesktopLayout") === "true";
  if (forceDesktopLayout) {
    document.body.classList.add("force-desktop-layout");
  }
})();

// Dynamic input type tracking (mouse vs touch) for hybrid devices
(function () {
  let lastInputType = "touch";
  document.body.classList.add("using-touch");

  function updateInputType(event) {
    const currentInputType = event.pointerType;

    if (currentInputType === lastInputType) {
      return;
    }

    if (currentInputType === "mouse") {
      document.body.classList.remove("using-touch");
    } else {
      document.body.classList.add("using-touch");
    }

    lastInputType = currentInputType;
  }

  window.addEventListener("pointermove", updateInputType, { passive: true });
  window.addEventListener("pointerdown", updateInputType, { passive: true });
})();

// Global variables
let map,
  drawnItems,
  importedItems,
  stravaActivitiesLayer,
  editableLayers,
  selectedElevationPath = null,
  globallySelectedItem = null,
  selectedPathOutline = null,
  selectedMarkerOutline = null,
  infoPanel,
  infoPanelName,
  infoPanelDetails,
  infoPanelStyleRow,
  infoPanelColorSwatch,
  infoPanelLayerName,
  colorPicker,
  isDeleteMode = false,
  elevationToggleControl,
  downloadControl,
  isElevationProfileVisible = false,
  drawControl,
  isEditMode = false,
  editControlContainer,
  deleteControlContainer,
  locateControl,
  currentRoutePath = null,
  saveRouteBtn,
  temporarySearchMarker = null,
  useImperialUnits = false,
  scaleControl;

/**
 * Adjusts the height of the info panel's name textarea to fit its content,
 * up to a maximum of approximately three lines.
 * @param {HTMLTextAreaElement} textarea - The textarea element to resize
 */
function adjustInfoPanelNameHeight(textarea) {
  const heightLimit = 75;

  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, heightLimit)}px`;
  textarea.style.overflowY = textarea.scrollHeight > heightLimit ? "auto" : "hidden";
  textarea.scrollTop = 0;
}

/**
 * Updates currently displayed UI elements that show units (routing panel, info panel)
 * when the user toggles between metric and imperial units.
 */
function updateAllDynamicUnitDisplays() {
  if (globallySelectedItem) {
    showInfoPanel(globallySelectedItem);
  }

  if (window.app && typeof window.app.redisplayCurrentRoute === "function") {
    window.app.redisplayCurrentRoute();
  }
}

/**
 * Fetches the credits content from an HTML file and displays it in a SweetAlert modal.
 * @param {boolean} [isWelcome=false] - If true, shows as a first-visit welcome popup with
 *   a "Let's Go!" button. If false, shows as the standard credits popup with a "Close" button.
 */
async function showCreditsPopup(isWelcome = false) {
  try {
    const response = await fetch("/credits.html");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const creditsHtmlContent = await response.text();

    const swalContent = document.createElement("div");
    swalContent.innerHTML = creditsHtmlContent;

    const appNameEl = swalContent.querySelector("#credits-app-name");
    if (isWelcome) {
      appNameEl.innerHTML = `Welcome to ${APP_NAME}`;
    } else {
      appNameEl.textContent = APP_NAME;
    }

    return Swal.fire({
      html: swalContent,
      confirmButtonText: isWelcome ? "Let's Go!" : "Close",
    });
  } catch (error) {
    console.error("Could not load credits.html:", error);
    return Swal.fire({
      title: "Error",
      text: "Could not load the credits information.",
    });
  }
}

function showAttributionToast() {
  Swal.fire({
    toast: true,
    position: "top",
    html: 'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" style="color:inherit">OpenStreetMap</a>',
    showConfirmButton: false,
    timer: 5000,
    customClass: { popup: "attribution-toast" },
  });
}

/**
 * Parses a URL hash string to extract map view parameters and optional data parameter.
 * @param {string} hashString - The hash string from window.location.hash
 * @returns {{zoom: number, lat: number, lon: number, data: string|null}|null} Map parameters or null if invalid
 */
function parseMapHash(hashString) {
  // Try to match the map parameters with optional data parameter
  // Format: #map=zoom/lat/lon or #map=zoom/lat/lon&data=compressedString
  const match = hashString.match(/^#map=(\d{1,2})\/(-?\d+\.?\d*)\/(-?\d+\.?\d*)(?:&data=([^&]+))?/);
  if (match) {
    return {
      zoom: parseInt(match[1], 10),
      lat: parseFloat(match[2]),
      lon: parseFloat(match[3]),
      data: match[4] || null,
    };
  }
  return null;
}

/**
 * Initializes the map and all its components (layers, controls, event handlers).
 */
async function initializeMap() {
  // Verify that all required API keys from secrets.js are available
  if (
    typeof googleApiKey === "undefined" ||
    typeof mapboxAccessToken === "undefined" ||
    typeof tracestrackApiKey === "undefined"
  ) {
    Swal.fire({
      title: "Configuration Error",
      html: `The <strong>secrets.js</strong> file is missing or misconfigured.<br><br>Please ensure the file exists in the 'js/' folder and contains all required API keys.`,
      allowOutsideClick: false,
    });
  }

  const creditsLink = document.getElementById("credits-link");
  if (creditsLink) creditsLink.prepend(APP_NAME + " ");

  useImperialUnits = localStorage.getItem("useImperialUnits") === "true";

  infoPanel = document.getElementById("info-panel");
  infoPanelName = document.getElementById("info-panel-name");
  infoPanelDetails = document.getElementById("info-panel-details");
  infoPanelStyleRow = document.getElementById("info-panel-style-row");
  infoPanelColorSwatch = document.getElementById("info-panel-color-swatch");
  infoPanelLayerName = document.getElementById("info-panel-layer-name");
  colorPicker = document.getElementById("color-picker");

  infoPanelName.addEventListener("blur", () => {
    updateLayerName();
    adjustInfoPanelNameHeight(infoPanelName);
  });
  infoPanelName.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      updateLayerName();
      infoPanelName.blur();
      e.preventDefault();
    }
  });

  infoPanelName.addEventListener("input", () => adjustInfoPanelNameHeight(infoPanelName));

  infoPanelColorSwatch.addEventListener("click", () => {
    const isPickerVisible =
      colorPicker.style.display === "grid" || colorPicker.style.display === "block";
    colorPicker.style.display = isPickerVisible ? "none" : "grid";
  });

  populateColorPicker();

  const tabButtons = document.querySelectorAll(".tab-button");
  const tabPanels = document.querySelectorAll(".tab-panel");
  const routingInfoIcon = document.getElementById("routing-info-icon");

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      tabButtons.forEach((btn) => btn.classList.remove("active"));
      tabPanels.forEach((panel) => panel.classList.remove("active"));

      button.classList.add("active");

      const targetPanelId = button.getAttribute("data-target");
      const targetPanel = document.getElementById(targetPanelId);
      if (targetPanel) {
        targetPanel.classList.add("active");
      }

      if (targetPanelId === "overview-panel" && globallySelectedItem) {
        if (window.expandCategoryForItem) {
          window.expandCategoryForItem(globallySelectedItem);
        }
        const layerId = L.Util.stamp(globallySelectedItem);
        const listItem = document.querySelector(
          `#overview-panel-list .overview-list-item[data-layer-id='${layerId}']`,
        );
        if (listItem) {
          listItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }

      if (document.getElementById("tab-btn-routing").classList.contains("active")) {
        routingInfoIcon.classList.remove("disabled");
      } else {
        routingInfoIcon.classList.add("disabled");
      }
    });
  });

  if (routingInfoIcon) {
    if (!document.getElementById("tab-btn-routing").classList.contains("active")) {
      routingInfoIcon.classList.add("disabled");
    }

    L.DomEvent.on(routingInfoIcon, "click", (e) => {
      const routingTabButton = document.getElementById("tab-btn-routing");

      if (routingTabButton.classList.contains("active")) {
        L.DomEvent.stop(e);
        Swal.fire({
          title: "Routing Help",
          html: `
<p style="text-align: left; margin: 0 0 18px 0">
  <strong>Managing Waypoints:</strong> The <strong>Start</strong>, <strong>Via</strong>, and
  <strong>End</strong> markers can be managed with your mouse or finger.
</p>
<p style="text-align: left"><strong>To Move:</strong> Drag the marker to a new position.</p>
<p style="text-align: left; margin: 0 0 18px 0">
  <strong>To Remove:</strong> Long-press or right-click the marker.
</p>
<p style="text-align: left">
  <strong>Adding Extra Via Points: </strong>You can add extra stops by <strong>long-pressing or right-clicking</strong> anywhere on the route line.
</p>
<p style="text-align: left; margin: 18px 0 0 0">
  <strong>Draw Mode:</strong> Use the <span class="material-symbols" style="font-size: 1em; vertical-align: middle">draw</span> button to trace a route step by step. First click sets the start, second sets the end, and each click after that extends the route. <strong>To finish, click the last marker, press Escape, or click the button again.</strong>
</p>
`,
          confirmButtonText: "Got it!",
        });
      }
    });
  }

  const layerDisplayNames = {
    OpenStreetMap: '<span class="material-symbols layer-icon">globe</span> OpenStreetMap',
    OsmGrayscale: '<span class="material-symbols layer-icon">globe</span> OpenStreetMap Gray',
    EsriWorldImagery: '<span class="material-symbols layer-icon">globe</span> Esri World Imagery',
    CyclOSM: '<span class="material-symbols layer-icon">globe</span> CyclOSM',
    TracestrackTopo: '<span class="material-symbols layer-icon">globe</span> Tracestrack Topo',
    TopPlusOpen: '<span class="fi fi-de fis"></span> TopPlusOpen',
    Swisstopo: '<span class="fi fi-ch fis"></span> Swisstopo',
    Empty: '<span class="material-symbols layer-icon">cancel</span> No Base Map',
    DrawnItems: '<span class="material-symbols layer-icon">edit</span> Drawn Items',
    ImportedFiles: '<span class="material-symbols layer-icon">folder_open</span> Imported Files',
    StravaActivities:
      '<span class="material-symbols layer-icon">directions_run</span> Strava Activities',
    FoundPlaces: '<span class="material-symbols layer-icon">location_on</span> Found Places',
    WaymarkedTrailsHiking:
      '<span class="material-symbols layer-icon">directions_walk</span> Waymarked Trails Hiking',
    WaymarkedTrailsCycling:
      '<span class="material-symbols layer-icon">directions_bike</span> Waymarked Trails Cycling',
  };

  const osmLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
  });

  const osmGrayscaleLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    className: "grayscale-tiles",
  });

  const baseMaps = {
    OpenStreetMap: osmLayer,
    OsmGrayscale: osmGrayscaleLayer,
    EsriWorldImagery: L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19 },
    ),
    CyclOSM: L.tileLayer("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }),
    TracestrackTopo: L.tileLayer(
      `https://tile.tracestrack.com/topo__/{z}/{x}/{y}.webp?key=${tracestrackApiKey}`,
      { maxZoom: 19 },
    ),
    TopPlusOpen: L.tileLayer(
      "https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web/default/WEBMERCATOR/{z}/{y}/{x}.png",
      { maxZoom: 18 },
    ),
    Swisstopo: L.tileLayer.wms("https://wms.geo.admin.ch/", {
      layers: "ch.swisstopo.pixelkarte-farbe",
      format: "image/jpeg",
      maxZoom: 18,
    }),
    Empty: L.layerGroup(), // Empty layer group for no basemap
  };

  map = L.map("map", {
    center: [0, 0],
    zoom: 2,
    zoomControl: false,
    attributionControl: false,
    doubleClickZoom: true,
    worldCopyJump: true,
  });

  // Create a dedicated pane for WMS layers
  map.createPane("wmsPane");
  map.getPane("wmsPane").style.zIndex = 250;

  const initialView = parseMapHash(window.location.hash);
  const savedHash = localStorage.getItem("lastHash");
  const savedView = savedHash ? parseMapHash(savedHash) : null;
  // Prevents circular updates when syncing map view from URL hash
  let isSyncingFromUrl = false;

  if (initialView) {
    isSyncingFromUrl = true;
    map.setView([initialView.lat, initialView.lon], initialView.zoom);
    isSyncingFromUrl = false;

    // If there's shared data in the URL, import it once layer groups are initialized
    if (initialView.data) {
      // Store the data to import after layer groups are created
      window._pendingShareData = {
        data: initialView.data,
        zoom: initialView.zoom,
        lat: initialView.lat,
        lon: initialView.lon,
      };
    }
  } else if (savedView) {
    history.replaceState(null, "", savedHash);
    map.setView([savedView.lat, savedView.lon], savedView.zoom);
  } else {
    fetch(`https://www.googleapis.com/geolocation/v1/geolocate?key=${googleApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Response not OK");
        }
        return response.json();
      })
      .then((data) => {
        if (data && data.location) {
          console.log(`Centering map on user location via Google Geolocation API.`);
          map.setView([data.location.lat, data.location.lng], 5);
        }
      })
      .catch((error) => {
        console.error("Geolocation failed, using default map view.", error);
      });
  }

  const updateUrlHash = () => {
    if (isSyncingFromUrl) return;
    const center = map.getCenter();
    const zoom = map.getZoom();
    const lat = center.lat.toFixed(6);
    const lng = center.lng.toFixed(6);
    const newHash = `#map=${zoom}/${lat}/${lng}`;
    history.replaceState(null, "", newHash);
    localStorage.setItem("lastHash", newHash);
  };

  map.on("moveend", updateUrlHash);

  const handleHashChange = () => {
    const newView = parseMapHash(window.location.hash);
    if (newView) {
      // If URL contains shared data, reload the page to start fresh
      if (newView.data) {
        window.location.reload();
        return;
      }

      const currentCenter = map.getCenter();
      const currentZoom = map.getZoom();
      if (
        currentZoom !== newView.zoom ||
        currentCenter.lat.toFixed(6) !== newView.lat.toFixed(6) ||
        currentCenter.lng.toFixed(6) !== newView.lon.toFixed(6)
      ) {
        isSyncingFromUrl = true;
        map.setView([newView.lat, newView.lon], newView.zoom);
        isSyncingFromUrl = false;
      }
    }
  };

  window.addEventListener("hashchange", handleHashChange, false);

  osmLayer.addTo(map);

  drawnItems = new L.FeatureGroup().addTo(map);
  importedItems = new L.FeatureGroup().addTo(map);
  editableLayers = new L.FeatureGroup();
  stravaActivitiesLayer = L.featureGroup().addTo(map);

  // Initialize POI finder first so we can add it to layer control
  initPoiFinder();

  let restoredData = false;

  // Import shared data from URL if present (now that layer groups are ready)
  if (window._pendingShareData) {
    const { data, zoom, lat, lon } = window._pendingShareData;
    const success = importMapStateFromUrl(data);

    if (success) {
      console.log("Successfully loaded shared map data from URL");
      // Clear data from URL on successful import (keep map view only)
      const newHash = `#map=${zoom}/${lat}/${lon}`;
      window.history.replaceState(null, "", newHash);
    } else {
      // Show error with option to clear the broken URL or keep it for debugging
      Swal.fire({
        title: "Import Error",
        text: "Could not load the shared map data from the URL.",
        icon: "error",
        showCancelButton: true,
        confirmButtonText: "Clear URL and Continue",
        cancelButtonText: "Keep URL for Debugging",
      }).then((result) => {
        if (result.isConfirmed) {
          // User wants to clear the broken URL
          const newHash = `#map=${zoom}/${lat}/${lon}`;
          window.history.replaceState(null, "", newHash);
        }
        // If cancelled, keep the URL intact for debugging
      });
    }
    delete window._pendingShareData;
  } else {
    // No share URL — restore previous session from IndexedDB
    restoredData = await restoreAutosave();
  }

  // Start periodic autosave (every 5s, writes only on change)
  startAutosave();

  // Show welcome popup once for new visitors (bare domain, never shown before)
  // Delay attribution toast if restore toast is already showing (matches restoreAutosave's 3000ms timer)
  const attributionDelay = restoredData ? 3500 : 0;
  if (!initialView && !localStorage.getItem("hasSeenWelcome")) {
    localStorage.setItem("hasSeenWelcome", "true");
    showCreditsPopup(true).then(() => showAttributionToast());
  } else {
    setTimeout(showAttributionToast, attributionDelay);
  }

  const allOverlayMaps = {
    DrawnItems: drawnItems,
    ImportedFiles: importedItems,
    StravaActivities: stravaActivitiesLayer,
    FoundPlaces: poiMasterLayer,
    WaymarkedTrailsHiking: L.tileLayer("https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png", {
      maxZoom: 19,
      zIndex: 200,
    }),
    WaymarkedTrailsCycling: L.tileLayer(
      "https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        zIndex: 200,
      },
    ),
  };

  const swissBounds = L.latLngBounds([
    [45.8179, 5.956],
    [47.8085, 10.4923],
  ]);

  map.on("baselayerchange", function (e) {
    if (e.name && e.name.includes("Swisstopo")) {
      const currentBounds = map.getBounds();
      if (!swissBounds.contains(currentBounds)) {
        // map.fitBounds(swissBounds);
      }
    }
  });

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
        const isVisible = panel.style.display === "block";
        panel.style.display = isVisible ? "none" : "block";
      });

      return container;
    },
  });

  new LayersToggleControl().addTo(map);

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

  const tileOverlayNames = ["WaymarkedTrailsHiking", "WaymarkedTrailsCycling"];

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

  formContent += '<div class="leaflet-control-layers-user-content">';
  renderOverlayCheckboxes(tileOverlayNames);
  formContent += "</div>";

  formContent += '<div class="leaflet-control-layers-separator"></div>';

  // User content layers (not sortable, always on top)
  formContent += '<div class="leaflet-control-layers-user-content">';
  renderOverlayCheckboxes(userContentNames);
  formContent += "</div>";

  formContent += '<div class="leaflet-control-layers-separator"></div>';

  // WMS overlay layers (sortable) — populated dynamically by WmsImport
  formContent += '<div class="leaflet-control-layers-overlays" id="overlays-sortable-list">';
  formContent += "</div>";

  // Add Import Maps button for custom WMS layers
  formContent += `
    <div style="padding: 4px 0px 0;">
      <button
        id="wms-import-btn"
        class="wms-import-button"
        style="width: 100%; padding: 8px 12px; cursor: pointer; background-color: var(--text-color); color: var(--background-color); border: none; border-radius: var(--border-radius); font-size: var(--font-size-14); font-weight: bold; white-space: nowrap;"
      >
        Import WMS Layers
      </button>
    </div>
  `;

  formContent += "</form>";

  customPanel.innerHTML = formContent;

  // Add event listener for Import WMS Layers button
  const wmsImportBtn = document.getElementById("wms-import-btn");
  if (wmsImportBtn) {
    wmsImportBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof WmsImport !== "undefined") {
        WmsImport.showWmsImportDialog(map);
      }
    });
  }

  // Load saved WMS layers from localStorage
  if (typeof WmsImport !== "undefined") {
    // Seed default layers on first-ever load (fresh cache), or load saved layers
    const seeded = WmsImport.seedDefaultLayers && WmsImport.seedDefaultLayers(map);
    if (!seeded && WmsImport.loadLayersFromStorage) {
      WmsImport.loadLayersFromStorage(map);
    }
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
    // Bring WMS layers to front in order
    const overlayLabels = Array.from(overlaysList.querySelectorAll("label"));

    // Reverse the order because bringToFront() makes the last called layer appear on top
    // We want the first item in the list to be on bottom, last item on top
    overlayLabels.reverse().forEach((label) => {
      const layerId = label.getAttribute("data-layer-id");

      if (
        layerId &&
        typeof WmsImport !== "undefined" &&
        typeof WmsImport.getCustomWmsLayers === "function"
      ) {
        const customWmsLayers = WmsImport.getCustomWmsLayers();
        const layerData = customWmsLayers[layerId];
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

  // Expose reapplyOverlayZIndex and saveOverlayOrder globally for WmsImport module
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
              // Reapply z-index to ensure layer respects list order
              reapplyOverlayZIndex();
            } else {
              map.removeLayer(layer);
              onOverlayToggle({ type: "overlayremove", layer: layer });
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
      const downloadMenu = document.querySelector(".download-submenu");
      const downloadButton = document.getElementById("download-button");

      if (
        layersPanel &&
        layersButton &&
        layersPanel.style.display === "block" &&
        !layersButton.contains(event.target) &&
        !layersPanel.contains(event.target)
      ) {
        layersPanel.style.display = "none";
      }

      if (
        downloadMenu &&
        downloadButton &&
        downloadMenu.style.display === "block" &&
        !downloadButton.contains(event.target) &&
        !downloadMenu.contains(event.target)
      ) {
        downloadMenu.style.display = "none";
      }
    },
    true,
  );

  const ElevationToggleControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd: function (map) {
      const container = L.DomUtil.create(
        "div",
        "leaflet-bar leaflet-control leaflet-control-custom",
      );
      container.id = "elevation-button";
      container.title = "Select a path to show elevation";
      container.innerHTML = '<a href="#" role="button"></a>';
      L.DomEvent.on(container, "click", (ev) => {
        L.DomEvent.stop(ev);
        if (L.DomUtil.hasClass(container, "disabled")) return;
        const elevationDiv = document.getElementById("elevation-div");
        isElevationProfileVisible =
          elevationDiv.style.visibility === "hidden" || elevationDiv.style.visibility === "";
        elevationDiv.style.visibility = isElevationProfileVisible ? "visible" : "hidden";
        if (isElevationProfileVisible) {
          if (selectedElevationPath) {
            window.elevationProfile.clearElevationProfile();
            addElevationProfileForLayer(selectedElevationPath);
          }
        } else {
          window.elevationProfile.clearElevationProfile();
        }
        updateElevationToggleIconColor();
      });
      return container;
    },
  });

  const DownloadControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd: function (map) {
      const container = L.DomUtil.create(
        "div",
        "leaflet-bar leaflet-control leaflet-control-custom",
      );
      container.title = "Download or share";
      container.id = "download-button";
      container.style.position = "relative";
      container.innerHTML =
        '<a href="#" role="button"></a>' +
        '<div class="download-submenu">' +
        '<button id="download-gpx-single" disabled title="Select an item to download as GPX">GPX (Selected Item)</button>' +
        '<button id="download-geojson-single" disabled title="Select an item to download as GeoJSON">GeoJSON (Selected Item)</button>' +
        '<button id="download-geojson" title="Download everything as GeoJSON">GeoJSON (Everything)</button>' +
        '<button id="download-kml" title="Download everything as KML">KML (Everything)</button>' +
        '<button id="share-link" title="Copy share link for everything">Copy Share Link (Everything)</button>' +
        "</div>";
      const subMenu = container.querySelector(".download-submenu");

      L.DomEvent.on(container, "click", (ev) => {
        L.DomEvent.stop(ev);
        // If the container is disabled, exit the function immediately.
        if (L.DomUtil.hasClass(container, "disabled")) {
          return;
        }
        const isVisible = subMenu.style.display === "block";
        subMenu.style.display = isVisible ? "none" : "block";
      });

      L.DomEvent.on(container.querySelector("#download-gpx-single"), "click", (e) => {
        L.DomEvent.stop(e);
        // Only download from Strava for live Strava activities; imported items with 'stravaId' use internal GPX export.
        if (globallySelectedItem && globallySelectedItem.pathType === "strava") {
          const { stravaId, name } = globallySelectedItem.feature.properties;
          downloadOriginalStravaGpx(stravaId, name);
          subMenu.style.display = "none";
        } else {
          if (!globallySelectedItem) return;
          const name = globallySelectedItem.feature?.properties?.name || `Map_Export_${Date.now()}`;
          const data = convertLayerToGpx(globallySelectedItem);
          if (data) {
            downloadFile(`${name}.gpx`, data);
          }
          subMenu.style.display = "none";
        }
      });
      L.DomEvent.on(container.querySelector("#download-geojson-single"), "click", (e) => {
        L.DomEvent.stop(e);
        if (!globallySelectedItem) return;
        exportGeoJson({ mode: "single", layer: globallySelectedItem });
        subMenu.style.display = "none";
      });
      L.DomEvent.on(container.querySelector("#download-kml"), "click", (e) => {
        L.DomEvent.stop(e);
        exportKml();
        subMenu.style.display = "none";
      });
      L.DomEvent.on(container.querySelector("#download-geojson"), "click", (e) => {
        L.DomEvent.stop(e);
        exportGeoJson();
        subMenu.style.display = "none";
      });
      L.DomEvent.on(container.querySelector("#share-link"), "click", async (e) => {
        L.DomEvent.stop(e);
        const shareUrl = buildShareableUrl();
        if (!shareUrl) {
          Swal.fire({
            toast: true,
            icon: "info",
            title: "Nothing to share",
            position: "top",
            showConfirmButton: false,
            timer: 2000,
          });
        } else {
          await copyToClipboard(shareUrl);

          // Warn users about URL length limits
          if (shareUrl.length > 2000) {
            Swal.fire({
              icon: "warning",
              title: "Large Share Link Copied!",
              html: `This link is <strong>${shareUrl.length}</strong> characters and may not work in all browsers or messaging apps.`,
              confirmButtonText: "OK",
            });
          } else {
            Swal.fire({
              toast: true,
              icon: "success",
              title: `Share Link Copied!<br>(${shareUrl.length} characters)`,
              position: "top",
              showConfirmButton: false,
              timer: 2000,
            });
          }
        }
        subMenu.style.display = "none";
      });
      return container;
    },
  });

  const CUSTOM_LOCATE_ICON_SIZE = 50;

  // Static location arrow icon (used for testing alignment without rotation)
  const locationArrowIcon = L.divIcon({
    html: `<img src="/img/location-arrow.svg" style="width: ${CUSTOM_LOCATE_ICON_SIZE}px; height: ${CUSTOM_LOCATE_ICON_SIZE}px;">`,
    className: "custom-locate-icon",
    iconSize: [CUSTOM_LOCATE_ICON_SIZE, CUSTOM_LOCATE_ICON_SIZE],
    iconAnchor: [(100 / 230) * CUSTOM_LOCATE_ICON_SIZE, (150 / 245) * CUSTOM_LOCATE_ICON_SIZE],
  });

  // Custom compass marker that extends L.Control.Locate.LocationMarker (normally a circle)
  // Adds compass heading support and uses a custom arrow image (location-arrow.svg)
  // that rotates based on device heading
  const locationCompassArrowIcon = L.Control.Locate.LocationMarker.extend({
    initialize(latlng, heading, options) {
      leaflet.setOptions(this, options);
      this._latlng = latlng;
      this._heading = heading;
      this.createIcon();
    },

    setHeading(heading) {
      this._heading = heading;
      if (this._icon) {
        const imgElement = this._icon.querySelector("img");
        if (imgElement) {
          imgElement.style.transform = `rotate(${this._heading}deg)`;
        }
      }

      const locationMarkerElement = document.querySelector(".leaflet-control-locate-location");
      if (locationMarkerElement) {
        locationMarkerElement.style.display = "none";
      }
    },

    createIcon() {
      const opt = this.options;
      const style = "";

      const icon = this._getIconSVG(opt, style);

      this._locationIcon = leaflet.divIcon({
        className: icon.className,
        html: icon.html,
        iconSize: [icon.w, icon.h],
        iconAnchor: [(100 / 230) * CUSTOM_LOCATE_ICON_SIZE, (150 / 245) * CUSTOM_LOCATE_ICON_SIZE],
      });

      this.setIcon(this._locationIcon);
      this.setHeading(this._heading);
    },

    _getIconSVG(options, style) {
      const size = CUSTOM_LOCATE_ICON_SIZE;
      const imgContent = `<img src="/img/location-arrow.svg" style="width:${size}px; height:${size}px;">`;

      return {
        className: "leaflet-control-locate-heading",
        html: imgContent,
        w: size,
        h: size,
      };
    },
  });

  const locateCircleColor = LOCATE_COLOR;

  locateControl = L.control
    .locate({
      position: "topleft",
      flyTo: true,
      locateOptions: { maxZoom: 19 },
      drawCircle: false,
      showPopup: false,
      showCompass: true,
      compassClass: locationCompassArrowIcon,
      // To test the static arrow without rotation, uncomment the markerClass below
      // and comment out the compassClass line above. This is useful for testing
      // icon alignment and appearance without compass heading.
      //
      // markerClass: L.Marker.extend({
      //   options: {
      //     icon: locationArrowIcon,
      //   },
      // }),
      markerStyle: {
        color: COLOR_WHITE,
        fillColor: locateCircleColor,
        fillOpacity: 1,
        weight: 2,
        opacity: 1,
        radius: 10,
      },
    })
    .addTo(map);

  scaleControl = L.control
    .scale({
      position: "bottomleft",
      metric: !useImperialUnits,
      imperial: useImperialUnits,
    })
    .addTo(map);

  const locateButtonContainer = locateControl.getContainer();
  map.on("locateactivate", function () {
    L.DomUtil.addClass(locateButtonContainer, "locate-active");
  });
  map.on("locatedeactivate", function () {
    L.DomUtil.removeClass(locateButtonContainer, "locate-active");
  });

  L.control.zoom({ position: "topleft" }).addTo(map);

  // Top-right button container
  // Fullscreen button
  const fullscreenBtn = document.getElementById("fullscreen-btn");

  function toggleFullscreen() {
    const btn = document.getElementById("fullscreen-btn");
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      btn.classList.add("fullscreen-active");
    } else {
      document.exitFullscreen();
      btn.classList.remove("fullscreen-active");
    }
  }

  fullscreenBtn.addEventListener("click", (e) => {
    e.preventDefault();
    toggleFullscreen();
  });

  document.addEventListener("fullscreenchange", () => {
    const btn = document.getElementById("fullscreen-btn");
    if (document.fullscreenElement) {
      btn.classList.add("fullscreen-active");
    } else {
      btn.classList.remove("fullscreen-active");
    }
  });

  // Auto-enter fullscreen on first tap when running as installed mobile PWA
  const isInstalledPWA = window.matchMedia("(display-mode: standalone)").matches;
  if (isInstalledPWA && navigator.maxTouchPoints > 0) {
    document.addEventListener(
      "click",
      () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      },
      { once: true },
    );
  }

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    if (e.key.toLowerCase() === "f") {
      e.preventDefault();
      toggleFullscreen();
    }
    if ((e.key === "Delete" || e.key === "Backspace") && globallySelectedItem) {
      e.preventDefault();
      deleteLayerImmediately(globallySelectedItem);
    }
    if (e.key === "Escape") {
      if (window.app.exitRoutePointSelectionMode) window.app.exitRoutePointSelectionMode();
      if (window.app.exitPenMode) window.app.exitPenMode();
    }
  });

  // Sidebar toggle button
  const sidebarToggleBtn = document.getElementById("sidebar-toggle-btn");
  sidebarToggleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const panelContainer = document.getElementById("main-right-container");
    panelContainer.classList.toggle("hidden");
    sidebarToggleBtn.classList.toggle("panels-visible");
    sidebarToggleBtn.classList.toggle("panels-hidden");

    if (!panelContainer.classList.contains("hidden") && globallySelectedItem) {
      adjustInfoPanelNameHeight(infoPanelName);
    }
  });

  // POI finder button
  const poiFinderBtn = document.getElementById("poi-finder-btn");
  if (poiFinderBtn) {
    poiFinderBtn.addEventListener("click", (e) => {
      e.preventDefault();
      showPoiFinder();
    });
  }

  // Search button
  const searchBtn = document.getElementById("search-btn");

  const onSearchResult = (locationLatLng, label) => {
    if (temporarySearchMarker) {
      map.removeLayer(temporarySearchMarker);
      temporarySearchMarker = null;
    }

    temporarySearchMarker = L.marker(locationLatLng, {
      icon: createMarkerIcon(COLOR_BLACK, 1),
      interactive: true,
    }).addTo(map);

    const popupContent = document.createElement("div");
    popupContent.style.textAlign = "center";
    popupContent.innerHTML = `<div style="font-weight: bold; margin-bottom: 8px;">${escHtml(label)}</div>`;

    const saveButton = document.createElement("button");
    saveButton.textContent = "Save to Map";
    saveButton.style.cssText =
      "padding: 5px 10px; border: 1px solid #ccc; border-radius: var(--border-radius); cursor: pointer; background-color: #f0f0f0;";
    popupContent.appendChild(saveButton);

    L.DomEvent.on(saveButton, "click", () => {
      const plainLabel = label.replace(/<[^>]*>/g, "").trim();
      createAndSaveMarker(locationLatLng, plainLabel);

      // Clean up the temporary marker and input
      if (temporarySearchMarker) {
        map.removeLayer(temporarySearchMarker);
        temporarySearchMarker = null;
      }
      map.closePopup();
    });

    temporarySearchMarker
      .bindPopup(popupContent, { maxWidth: 150, closeButton: false })
      .openPopup();

    temporarySearchMarker.on("popupclose", () => {
      if (temporarySearchMarker && map.hasLayer(temporarySearchMarker)) {
        map.removeLayer(temporarySearchMarker);
        temporarySearchMarker = null;
      }
    });

    map.flyTo(locationLatLng, map.getZoom() < 16 ? 16 : map.getZoom());
  };

  // Exposed for use in osm.js contributions panel
  window.showSearchMarker = onSearchResult;

  // Attach search modal to search button
  attachSearchModalToInput(searchBtn, "Search Location", onSearchResult);

  window.elevationProfile.createElevationChart("elevation-div", useImperialUnits);

  // Hide elevation panel on load to prevent blocking map interactions on mobile
  document.getElementById("elevation-div").style.visibility = "hidden";

  // ---- Leaflet.draw patches (start) ----

  // Prevent polyline drawing tool from finishing on second tap on touch devices
  L.Draw.Polyline.prototype._onTouch = L.Util.falseFn;

  // Fix toolbar on iPad with mouse by forcing click events instead of touchstart
  if (L.Toolbar) {
    L.Toolbar.prototype._detectIOS = () => false;
  }

  // _checkDisabled listens to featureGroup layerremove. In delete mode, _removeLayer moves layers
  // from featureGroup to _deletedLayers, firing layerremove mid-session and wrongly disabling buttons.
  // Guard it with enabled() (_activeMode !== null); patch _handlerDeactivated to call it after the
  // mode ends — save() fires no layerremove so _checkDisabled would never run to fix state otherwise.
  if (L.EditToolbar) {
    const origCheckDisabled = L.EditToolbar.prototype._checkDisabled;
    L.EditToolbar.prototype._checkDisabled = function () {
      if (this.enabled()) return;
      origCheckDisabled.call(this);
    };
    const origHandlerDeactivated = L.EditToolbar.prototype._handlerDeactivated;
    L.EditToolbar.prototype._handlerDeactivated = function () {
      origHandlerDeactivated.call(this);
      this._checkDisabled();
    };
  }

  // Patch deprecated _flat method
  if (L.Polyline && L.LineUtil && L.LineUtil.isFlat) {
    L.Polyline._flat = L.LineUtil.isFlat;
  }

  // ---- Leaflet.draw patches (end) ----

  // Path
  L.drawLocal.draw.toolbar.buttons.polyline = "Draw path";
  L.drawLocal.draw.handlers.polyline.tooltip.start = "Click to start drawing path";
  L.drawLocal.draw.handlers.polyline.tooltip.cont = "Click to continue path";
  L.drawLocal.draw.handlers.polyline.tooltip.end = "Click last point to finish path";

  // Area
  L.drawLocal.draw.toolbar.buttons.polygon = "Draw area";
  L.drawLocal.draw.handlers.polygon.tooltip.start = "Click to start drawing area";
  L.drawLocal.draw.handlers.polygon.tooltip.cont = "Click to continue area";
  L.drawLocal.draw.handlers.polygon.tooltip.end = "Click first point to close area";

  // Marker
  L.drawLocal.draw.toolbar.buttons.marker = "Place marker";
  L.drawLocal.draw.handlers.marker.tooltip.start = "Click to place marker";

  // Edit toolbar buttons
  L.drawLocal.edit.toolbar.buttons.edit = "Edit";
  L.drawLocal.edit.toolbar.buttons.remove = "Delete";
  L.drawLocal.edit.toolbar.buttons.editDisabled = "No items to edit";
  L.drawLocal.edit.toolbar.buttons.removeDisabled = "No items to delete";

  // Edit toolbar tooltips
  L.drawLocal.edit.handlers.edit.tooltip.text =
    "Drag handles or markers to edit<br>Click cancel to undo";
  L.drawLocal.edit.handlers.edit.tooltip.subtext = "";
  L.drawLocal.edit.handlers.remove.tooltip.text = "Click an item to delete<br>Click cancel to undo";

  drawControl = new L.Control.Draw({
    edit: { featureGroup: editableLayers },
    draw: {
      polyline: {
        shapeOptions: { ...STYLE_CONFIG.path.default, color: DEFAULT_COLOR },
        metric: true,
        feet: false,
        showLength: false,
      },
      polygon: {
        shapeOptions: { ...STYLE_CONFIG.path.default, color: DEFAULT_COLOR },
        showArea: true,
        metric: true,
      },
      rectangle: false,
      circle: false,
      marker: {
        icon: createMarkerIcon(DEFAULT_COLOR, STYLE_CONFIG.marker.default.opacity),
      },
      circlemarker: false,
    },
  });
  map.addControl(drawControl);

  const ImportControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd: function (map) {
      const container = L.DomUtil.create(
        "div",
        "leaflet-bar leaflet-control leaflet-control-custom",
      );
      container.id = "import-button";
      container.title = "Import GeoJSON/GPX/KML/KMZ file";
      const link = L.DomUtil.create("a", "", container);
      link.href = "#";
      link.role = "button";
      link.innerHTML = "";
      const input = L.DomUtil.create("input", "hidden", container);
      input.type = "file";
      input.accept = ".geojson,.json,.gpx,.kml,.kmz";
      input.style.display = "none";

      L.DomEvent.on(link, "click", (e) => {
        L.DomEvent.stop(e);
        input.click();
      });

      L.DomEvent.on(input, "change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const fileNameLower = file.name.toLowerCase();

        if (fileNameLower.endsWith(".geojson") || fileNameLower.endsWith(".json")) {
          importGeoJsonFile(file);
        } else if (fileNameLower.endsWith(".gpx")) {
          importGpxFile(file);
        } else if (fileNameLower.endsWith(".kml")) {
          importKmlFile(file);
        } else if (fileNameLower.endsWith(".kmz")) {
          importKmzFile(file);
        }
        e.target.value = "";
      });
      return container;
    },
  });
  new ImportControl().addTo(map);
  downloadControl = new DownloadControl({ position: "topleft" }).addTo(map);
  elevationToggleControl = new ElevationToggleControl({ position: "topleft" }).addTo(map);
  L.DomUtil.addClass(elevationToggleControl.getContainer(), "disabled");
  updateElevationToggleIconColor();
  updateOverviewList();

  // Map event listeners
  map.on("draw:created", (e) => {
    const layer = e.layer;
    layer.pathType = "drawn";
    layer.feature = layer.feature || { properties: {} };
    layer.feature.properties.color = DEFAULT_COLOR;
    drawnItems.addLayer(layer);
    editableLayers.addLayer(layer);
    layer.on("click", (ev) => {
      L.DomEvent.stopPropagation(ev);
      selectItem(layer);
    });
    if (e.layerType === "polyline" || e.layerType === "polygon") {
    }
    selectItem(layer);
    if (!map.hasLayer(drawnItems)) {
      map.addLayer(drawnItems);
    }
    updateDrawControlStates();
    updateOverviewList();
  });

  map.on("draw:edited", (e) => {
    e.layers.eachLayer((layer) => {
      if (layer instanceof L.Polyline || layer instanceof L.Polygon) {
        const newDistance = calculatePathDistance(layer);
        if (layer.feature && layer.feature.properties) {
          layer.feature.properties.totalDistance = newDistance;
        }
        if (globallySelectedItem === layer) selectItem(layer);
      }
    });
    updateDrawControlStates();
  });

  map.on(L.Draw.Event.DELETED, (e) => {
    e.layers.eachLayer((layer) => {
      deleteLayerImmediately(layer);
      layer.isDeletedFromToolbar = false;
    });
  });

  // Distance labels for drawing
  let distanceLabels = [];
  let totalDistance = 0;

  map.on(L.Draw.Event.DRAWSTART, function (e) {
    deselectCurrentItem();
    L.DomUtil.addClass(document.body, "leaflet-is-drawing");
    totalDistance = 0;
    distanceLabels.forEach((label) => map.removeLayer(label));
    distanceLabels = [];

    if (e.layerType === "polyline" || e.layerType === "polygon") {
      map.on("draw:drawvertex", function (evt) {
        const points = evt.layers.getLayers().map((l) => l.getLatLng());
        if (points.length < 2) return;

        const prevPoint = points[points.length - 2];
        const newPoint = points[points.length - 1];
        totalDistance += prevPoint.distanceTo(newPoint);

        const label = L.marker(newPoint, {
          icon: L.divIcon({
            className: "distance-label",
            html: formatDistance(totalDistance),
            iconSize: [60, 20],
            iconAnchor: [30, -10],
          }),
          interactive: false,
        }).addTo(map);

        distanceLabels.push(label);
      });
    }
  });

  map.on(L.Draw.Event.DRAWSTOP, function () {
    L.DomUtil.removeClass(document.body, "leaflet-is-drawing");
    distanceLabels.forEach((label) => map.removeLayer(label));
    distanceLabels = [];
    map.off("draw:drawvertex");
  });

  map.on("click", (e) => {
    if (
      e.originalEvent.target.id === "map" ||
      e.originalEvent.target.classList.contains("leaflet-container")
    ) {
      deselectCurrentItem();
    }
  });

  // Leaflet.draw handles Escape for draw tools internally, but not for edit/delete mode.
  document.addEventListener("keyup", (e) => {
    if (e.key !== "Escape") return;
    const editToolbar = drawControl._toolbars[L.EditToolbar.TYPE];
    if (editToolbar?.enabled()) editToolbar.disable();
  });

  map.on(L.Draw.Event.DELETESTART, () => {
    isDeleteMode = true;
    deselectCurrentItem();
    editableLayers.eachLayer((layer) => {
      if (map.hasLayer(layer)) {
        layer.on("click", onFeatureClickToDelete);
      }
    });
    L.DomUtil.addClass(map.getContainer(), "map-is-editing");
    updateDrawControlStates();
  });

  map.on(L.Draw.Event.DELETESTOP, () => {
    isDeleteMode = false;
    updateDrawControlStates();
    editableLayers.eachLayer((layer) => {
      layer.off("click", onFeatureClickToDelete);
    });
    L.DomUtil.removeClass(map.getContainer(), "map-is-editing");

    editableLayers.eachLayer((layer) => {
      if (!map.hasLayer(layer) && !layer.isManuallyHidden) {
        map.addLayer(layer);
      }
      layer.isDeletedFromToolbar = false;
    });

    if (globallySelectedItem) {
      selectItem(globallySelectedItem);
    }
  });

  map.on(L.Draw.Event.EDITSTART, () => {
    isEditMode = true;
    deselectCurrentItem();
    if (selectedPathOutline) map.removeLayer(selectedPathOutline);
    if (selectedMarkerOutline) map.removeLayer(selectedMarkerOutline);
    L.DomUtil.addClass(map.getContainer(), "map-is-editing");
    updateDrawControlStates();
  });

  map.on(L.Draw.Event.EDITSTOP, () => {
    isEditMode = false;
    L.DomUtil.removeClass(map.getContainer(), "map-is-editing");

    if (globallySelectedItem) {
      const itemToReselect = globallySelectedItem;
      deselectCurrentItem();
      setTimeout(() => {
        selectItem(itemToReselect);
        if (itemToReselect instanceof L.Marker) {
          itemToReselect.setZIndexOffset(1000);
        }
      }, 50);
    }
    updateDrawControlStates();
  });

  initializeRouting();
  initializeStrava();
  initializeContextMenu(map);
  const settingsPanel = document.getElementById("settings-panel");
  if (settingsPanel) {
    initializeOSM(settingsPanel);

    const simplificationContainer = L.DomUtil.create("div", "settings-control-item", settingsPanel);
    const labelGroup = L.DomUtil.create("div", "", simplificationContainer);
    labelGroup.style.display = "flex";
    labelGroup.style.alignItems = "center";
    const label = L.DomUtil.create("label", "", labelGroup);
    label.htmlFor = "simplification-toggle";
    label.innerText = "Path & Area Simplification";
    const infoIcon = L.DomUtil.create("span", "settings-info-icon", labelGroup);
    infoIcon.innerHTML = '<span class="material-symbols">info</span>';
    infoIcon.title = "What's this?";
    const checkbox = L.DomUtil.create("input", "", simplificationContainer);
    checkbox.type = "checkbox";
    checkbox.id = "simplification-toggle";
    checkbox.checked = enablePathSimplification;
    L.DomEvent.on(checkbox, "change", (e) => {
      enablePathSimplification = e.target.checked;
      localStorage.setItem("enablePathSimplification", enablePathSimplification);
      Swal.fire({
        toast: true,
        icon: "info",
        title: `Path & Area Simplification ${enablePathSimplification ? "Enabled" : "Disabled"}`,
        showConfirmButton: false,
        timer: 1500,
      });
    });
    L.DomEvent.on(infoIcon, "click", () => {
      Swal.fire({
        title: "Path & Area Simplification",
        html: `
<p style="text-align: left; margin: 0 0 18px 0">
  When enabled, this option automatically reduces the number of points in paths and areas to improve performance. This simplification happens at specific times:
</p>
<ul style="text-align: left; padding-left: 20px; margin: 0 0 18px 0;">
  <li style="margin-bottom: 5px;">When an <strong>imported track or area</strong> is duplicated.</li>
  <li style="margin-bottom: 5px;">When a <strong>generated route</strong> is saved.</li>
  <li>When a <strong>Strava activity</strong> is duplicated.</li>
</ul>
<p style="text-align: left; margin: 0 0 18px 0">
  The original, high-detail files are never modified.
</p>
<p style="text-align: left; margin: 0 0 18px 0">
  <strong>Enabled (Recommended):</strong> Improves performance and makes paths and areas easier to edit. The visual change is often unnoticeable.
</p>
<p style="text-align: left">
  <strong>Disabled:</strong> Preserves every single point when duplicating or saving. Use this if absolute precision is critical.
</p>
`,
        confirmButtonText: "Got it!",
      });
    });
    L.DomEvent.on(simplificationContainer, "dblclick mousedown wheel", L.DomEvent.stopPropagation);

    const themeToggleContainer = L.DomUtil.create("div", "settings-control-item", settingsPanel);
    const themeLabel = L.DomUtil.create("label", "", themeToggleContainer);
    themeLabel.innerText = "Theme";
    const themeSelect = L.DomUtil.create("select", "", themeToggleContainer);
    themeSelect.id = "theme-select";
    const currentTheme = localStorage.getItem("theme") ?? "glass";
    [
      ["glass", "Glass"],
      ["light", "Light"],
      ["dark", "Dark"],
    ].forEach(([value, label]) => {
      const option = L.DomUtil.create("option", "", themeSelect);
      option.value = value;
      option.textContent = label;
      option.selected = value === currentTheme;
    });
    L.DomEvent.on(themeSelect, "change", (e) => {
      document.body.classList.remove("dark-mode", "light-mode", "glass-mode");
      if (e.target.value === "dark") document.body.classList.add("dark-mode");
      else if (e.target.value === "light") document.body.classList.add("light-mode");
      else document.body.classList.add("glass-mode");
      localStorage.setItem("theme", e.target.value);
    });
    L.DomEvent.on(themeToggleContainer, "dblclick mousedown wheel", L.DomEvent.stopPropagation);

    const imperialUnitsContainer = L.DomUtil.create("div", "settings-control-item", settingsPanel);
    const imperialUnitsLabel = L.DomUtil.create("label", "", imperialUnitsContainer);
    imperialUnitsLabel.htmlFor = "imperial-units-toggle";
    imperialUnitsLabel.innerText = "Imperial Units";
    const imperialUnitsCheckbox = L.DomUtil.create("input", "", imperialUnitsContainer);
    imperialUnitsCheckbox.type = "checkbox";
    imperialUnitsCheckbox.id = "imperial-units-toggle";
    imperialUnitsCheckbox.checked = useImperialUnits;

    L.DomEvent.on(imperialUnitsCheckbox, "change", async (e) => {
      useImperialUnits = e.target.checked;
      localStorage.setItem("useImperialUnits", useImperialUnits);

      if (scaleControl) {
        map.removeControl(scaleControl);
      }
      scaleControl = L.control
        .scale({
          position: "bottomleft",
          metric: !useImperialUnits,
          imperial: useImperialUnits,
        })
        .addTo(map);

      window.elevationProfile.updateElevationChartUnits(useImperialUnits);

      updateAllDynamicUnitDisplays();

      Swal.fire({
        toast: true,
        icon: "info",
        title: `Units set to ${useImperialUnits ? "Imperial" : "Metric"}`,
        showConfirmButton: false,
        timer: 1500,
      });
    });

    L.DomEvent.on(imperialUnitsContainer, "dblclick mousedown wheel", L.DomEvent.stopPropagation);

    const forceDesktopLayoutContainer = L.DomUtil.create(
      "div",
      "settings-control-item",
      settingsPanel,
    );
    const forceDesktopLayoutLabel = L.DomUtil.create("label", "", forceDesktopLayoutContainer);
    forceDesktopLayoutLabel.htmlFor = "force-desktop-toggle";
    forceDesktopLayoutLabel.innerText = "Force Desktop Layout";
    const forceDesktopLayoutCheckbox = L.DomUtil.create("input", "", forceDesktopLayoutContainer);
    forceDesktopLayoutCheckbox.type = "checkbox";
    forceDesktopLayoutCheckbox.id = "force-desktop-toggle";
    forceDesktopLayoutCheckbox.checked = localStorage.getItem("forceDesktopLayout") === "true";

    L.DomEvent.on(forceDesktopLayoutCheckbox, "change", (e) => {
      const forceDesktopLayout = e.target.checked;
      localStorage.setItem("forceDesktopLayout", forceDesktopLayout);

      if (forceDesktopLayout) {
        document.body.classList.add("force-desktop-layout");
      } else {
        document.body.classList.remove("force-desktop-layout");
      }
    });

    const lineThicknessContainer = L.DomUtil.create("div", "settings-control-item", settingsPanel);
    const lineThicknessLabel = L.DomUtil.create("label", "", lineThicknessContainer);
    lineThicknessLabel.htmlFor = "line-thickness-slider";
    lineThicknessLabel.innerText = "Line Thickness";
    const lineThicknessRight = L.DomUtil.create(
      "div",
      "settings-slider-group",
      lineThicknessContainer,
    );
    const lineThicknessValue = L.DomUtil.create(
      "span",
      "settings-slider-value",
      lineThicknessRight,
    );
    lineThicknessValue.innerText = lineThickness;
    const lineThicknessSlider = L.DomUtil.create("input", "settings-slider", lineThicknessRight);
    lineThicknessSlider.type = "range";
    lineThicknessSlider.id = "line-thickness-slider";
    lineThicknessSlider.min = 2;
    lineThicknessSlider.max = 20;
    lineThicknessSlider.step = 2;
    lineThicknessSlider.value = lineThickness;
    L.DomEvent.on(lineThicknessSlider, "input", (e) => {
      lineThickness = parseInt(e.target.value);
      lineThicknessValue.innerText = lineThickness;
      STYLE_CONFIG.path.default.weight = lineThickness;
      STYLE_CONFIG.path.highlight.weight = lineThickness;
      localStorage.setItem("lineThickness", lineThickness);
      [drawnItems, importedItems, stravaActivitiesLayer].forEach((group) => {
        group.eachLayer((layer) => {
          if (layer instanceof L.Polyline || layer instanceof L.GeoJSON) {
            layer.setStyle({ weight: lineThickness });
          }
        });
      });
      if (selectedPathOutline) {
        selectedPathOutline.setStyle({
          weight: lineThickness + STYLE_CONFIG.path.highlight.outline.weightOffset,
        });
      }
    });
    L.DomEvent.on(lineThicknessContainer, "dblclick mousedown wheel", L.DomEvent.stopPropagation);

    const routingProviderContainer = L.DomUtil.create(
      "div",
      "settings-control-item",
      settingsPanel,
    );
    const routingProviderLabel = L.DomUtil.create("label", "", routingProviderContainer);
    routingProviderLabel.htmlFor = "routing-provider-select";
    routingProviderLabel.innerText = "Routing Provider";
    const routingProviderSelect = L.DomUtil.create("select", "", routingProviderContainer);
    routingProviderSelect.id = "routing-provider-select";
    routingProviderSelect.innerHTML = `<option value="mapbox">Mapbox</option><option value="osrm">OSRM (Demo)</option>`;
    routingProviderSelect.value = localStorage.getItem("routingProvider") || "mapbox";
    L.DomEvent.on(routingProviderSelect, "change", (e) => {
      const newProvider = e.target.value;
      localStorage.setItem("routingProvider", newProvider);
      window.app.clearRouting();
      window.app.setupRoutingControl(newProvider);
      Swal.fire({
        toast: true,
        icon: "info",
        title: `Routing provider set to ${e.target.options[e.target.selectedIndex].text}`,
        showConfirmButton: false,
        timer: 1500,
      });
    });
    L.DomEvent.on(routingProviderContainer, "dblclick mousedown wheel", L.DomEvent.stopPropagation);

    const elevationProviderContainer = L.DomUtil.create(
      "div",
      "settings-control-item",
      settingsPanel,
    );
    const elevationProviderLabel = L.DomUtil.create("label", "", elevationProviderContainer);
    elevationProviderLabel.htmlFor = "elevation-provider-select";
    elevationProviderLabel.innerText = "Elevation Provider";
    const elevationProviderSelect = L.DomUtil.create("select", "", elevationProviderContainer);
    elevationProviderSelect.id = "elevation-provider-select";
    elevationProviderSelect.innerHTML = `<option value="google">Google</option><option value="geoadmin">GeoAdmin (Switzerland)</option>`;
    elevationProviderSelect.value = localStorage.getItem("elevationProvider") || "google";
    L.DomEvent.on(elevationProviderSelect, "change", (e) => {
      const newProvider = e.target.value;
      localStorage.setItem("elevationProvider", newProvider);
      clearElevationCache();
      Swal.fire({
        toast: true,
        icon: "info",
        title: `Elevation provider set to ${e.target.options[e.target.selectedIndex].text}`,
        showConfirmButton: false,
        timer: 1500,
      });
    });
    L.DomEvent.on(
      elevationProviderContainer,
      "dblclick mousedown wheel",
      L.DomEvent.stopPropagation,
    );

    const preferFileElevationContainer = L.DomUtil.create(
      "div",
      "settings-control-item",
      settingsPanel,
    );
    const preferFileElevationLabel = L.DomUtil.create("label", "", preferFileElevationContainer);
    preferFileElevationLabel.htmlFor = "prefer-file-elevation-checkbox";
    preferFileElevationLabel.innerText = "Prefer file elevation data";
    const preferFileElevationCheckbox = L.DomUtil.create("input", "", preferFileElevationContainer);
    preferFileElevationCheckbox.type = "checkbox";
    preferFileElevationCheckbox.id = "prefer-file-elevation-checkbox";
    preferFileElevationCheckbox.checked = localStorage.getItem("preferFileElevation") !== "false"; // Default to true
    L.DomEvent.on(preferFileElevationCheckbox, "change", (e) => {
      const shouldPrefer = e.target.checked;
      localStorage.setItem("preferFileElevation", shouldPrefer.toString());
      clearElevationCache();
      Swal.fire({
        toast: true,
        icon: "info",
        title: shouldPrefer ? "Will prefer file elevation data" : "Will prefer API elevation data",
        showConfirmButton: false,
        timer: 1500,
      });
    });
    L.DomEvent.on(
      preferFileElevationContainer,
      "dblclick mousedown wheel",
      L.DomEvent.stopPropagation,
    );

    const aboutContainer = L.DomUtil.create("div", "settings-control-item", settingsPanel);
    const aboutLabel = L.DomUtil.create("label", "", aboutContainer);
    aboutLabel.innerText = "About";
    aboutLabel.style.color = "var(--text-color)";
    const creditsLink = L.DomUtil.create("a", "", aboutContainer);
    creditsLink.href = "#";
    creditsLink.innerText = "View Credits";
    creditsLink.classList.add("credits-link");

    L.DomEvent.on(creditsLink, "click", (e) => {
      L.DomEvent.stop(e);
      showCreditsPopup();
    });

    const privacyPolicyContainer = L.DomUtil.create("div", "settings-control-item", settingsPanel);
    const privacyPolicyLabel = L.DomUtil.create("label", "", privacyPolicyContainer);
    privacyPolicyLabel.innerText = "Legal";
    privacyPolicyLabel.style.color = "var(--text-color)";
    const privacyPolicyLink = L.DomUtil.create("a", "", privacyPolicyContainer);
    privacyPolicyLink.href = "/privacy.html";
    privacyPolicyLink.target = "_blank";
    privacyPolicyLink.innerText = "View Privacy Policy";
    privacyPolicyLink.style.fontSize = "var(--font-size-14)";
    privacyPolicyLink.style.color = "var(--link-color)";

    const devPanelContainer = L.DomUtil.create("div", "settings-control-item", settingsPanel);
    const devPanelLabel = L.DomUtil.create("label", "", devPanelContainer);
    devPanelLabel.innerText = "Developer";
    devPanelLabel.style.color = "var(--text-color)";
    const devPanelLink = L.DomUtil.create("a", "", devPanelContainer);
    devPanelLink.href = "#";
    devPanelLink.innerText = "Open Developer Panel";
    devPanelLink.style.fontSize = "var(--font-size-14)";
    devPanelLink.style.color = "var(--link-color)";

    L.DomEvent.on(devPanelLink, "click", (e) => {
      L.DomEvent.stop(e);
      if (typeof window.toggleDevPanel === "function") {
        window.toggleDevPanel();
      }
    });
  }

  map.getContainer().addEventListener("click", (e) => {
    const creditsTrigger = e.target.closest(".js-show-credits");

    if (creditsTrigger) {
      e.preventDefault();
      e.stopPropagation();
      showCreditsPopup();
    }
  });
  const heartButton = document.getElementById("tab-btn-heart");
  if (heartButton) {
    heartButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCreditsPopup();
    });
  }

  const infoPanelObserver = new MutationObserver(() => {
    if (infoPanelName) {
      adjustInfoPanelNameHeight(infoPanelName);
    }
  });

  infoPanelObserver.observe(infoPanel, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  document.addEventListener("penModeExited", () => adjustInfoPanelNameHeight(infoPanelName));

  let deferredPrompt;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;

    const installLink = document.getElementById("install-pwa-link");
    if (installLink) {
      installLink.style.display = "inline";

      installLink.addEventListener("click", (clickEvent) => {
        clickEvent.preventDefault();
        installLink.style.display = "none";

        if (deferredPrompt) {
          deferredPrompt.prompt();

          deferredPrompt.userChoice.then(({ outcome }) => {
            console.log(`User response to the install prompt: ${outcome}`);
          });

          deferredPrompt = null;
        }
      });
    }
  });

  window.addEventListener("appinstalled", () => {
    const installLink = document.getElementById("install-pwa-link");
    if (installLink) {
      installLink.style.display = "none";
    }
    deferredPrompt = null;
    console.log("PWA was installed");
  });
  const sheetHandle = document.getElementById("sheet-handle");
  if (sheetHandle) {
    const panelContainer = document.getElementById("main-right-container");
    const toggleButton = document.getElementById("sidebar-toggle-btn");

    const openSheet = () => {
      panelContainer.classList.remove("hidden");
      if (toggleButton) {
        toggleButton.classList.add("panels-visible");
        toggleButton.classList.remove("panels-hidden");
      }
    };

    const closeSheet = () => {
      panelContainer.classList.add("hidden");
      if (toggleButton) {
        toggleButton.classList.remove("panels-visible");
        toggleButton.classList.add("panels-hidden");
      }
    };

    sheetHandle.addEventListener("click", () => {
      if (panelContainer.classList.contains("hidden")) {
        openSheet();
      } else {
        closeSheet();
      }
    });

    let touchStartY = 0;
    const swipeThreshold = 50;

    sheetHandle.addEventListener(
      "touchstart",
      (e) => {
        touchStartY = e.changedTouches[0].clientY;
      },
      { passive: true },
    );

    sheetHandle.addEventListener("touchend", (e) => {
      const touchEndY = e.changedTouches[0].clientY;
      const deltaY = touchEndY - touchStartY;

      if (deltaY > swipeThreshold) {
        closeSheet();
      }

      if (deltaY < -swipeThreshold) {
        openSheet();
      }
    });
  }
  const uiContainers = [
    document.getElementById("main-right-container"),
    document.getElementById("top-right-container"),
    document.getElementById("custom-layers-panel"),
    document.getElementById("elevation-div"),
    // Also include the container for all of Leaflet's default controls
    ...document.querySelectorAll(".leaflet-control-container"),
  ];

  uiContainers.forEach((container) => {
    if (container) {
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
    }
  });

  setTimeout(updateDrawControlStates, 0);
  setTimeout(replaceDefaultIconsWithMaterialSymbols, 0);
  resetInfoPanel();

  window.addEventListener(
    "load",
    () => {
      const creditsIcon = new Image();
      creditsIcon.src = "/img/icon-1024x1024.png";

      const stravaButton = new Image();
      stravaButton.src = "/img/btn_strava_connect_with_orange.svg";
    },
    { once: true },
  );
}

document.addEventListener("DOMContentLoaded", initializeMap);

// Offline indicator
(function () {
  const indicator = document.getElementById("offline-indicator");
  const toDisable = [
    document.getElementById("search-btn"),
    document.getElementById("poi-finder-btn"),
    document.getElementById("route-start"),
    document.getElementById("route-end"),
    document.getElementById("route-via"),
  ];

  const setOffline = () => {
    indicator.classList.add("visible");
    toDisable.forEach((el) => {
      if (el) el.disabled = true;
    });
    if (typeof Swal !== "undefined" && Swal.isVisible()) Swal.close();
  };

  const setOnline = () => {
    indicator.classList.remove("visible");
    toDisable.forEach((el) => {
      if (el) el.disabled = false;
    });
  };

  window.addEventListener("offline", setOffline);
  window.addEventListener("online", setOnline);
  if (!navigator.onLine) setOffline();
})();

// console.log("User Agent:", navigator.userAgent);
// console.log("Leaflet Version:", L.version);
