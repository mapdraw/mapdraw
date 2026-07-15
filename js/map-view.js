// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

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

function showAttributionToast() {
  if (
    window.innerWidth > BREAKPOINT_MOBILE ||
    document.body.classList.contains("force-desktop-layout")
  )
    return;
  const attribution = basemapAttributions[BASEMAP_CONFIG[0].key];
  if (!attribution) return;
  Swal.fire({
    toast: true,
    position: "top",
    html: `Map data ${attribution}`,
    showConfirmButton: false,
    timer: 5000,
    customClass: { popup: "attribution-toast" },
  });
}

/**
 * Creates the map and its panes, restores the last view (URL hash, saved
 * session, or geolocation), creates the core layer groups, and restores
 * autosaved or URL-shared data.
 * @returns {Object<string, L.Layer>} baseMaps keyed by BASEMAP_CONFIG key, for the layer control panel
 */
async function initMapView() {
  const baseMaps = Object.fromEntries(
    BASEMAP_CONFIG.map((b) => {
      if (!b.url) return [b.key, L.layerGroup()];
      const tileOptions = { ...b.tileOptions, noWrap: true, bounds: WORLD_BOUNDS };
      if (b.wms) return [b.key, L.tileLayer.wms(b.url, tileOptions)];
      return [b.key, L.tileLayer(b.url, tileOptions)];
    }),
  );

  map = L.map("map", {
    center: [0, 0],
    zoom: 2,
    zoomControl: false,
    attributionControl: false,
    doubleClickZoom: true,
    boxZoom: false,
    maxBounds: WORLD_BOUNDS,
  });

  initAttribution();

  // Create dedicated panes for overlay layers
  map.createPane("customLayersPane");
  map.getPane("customLayersPane").style.zIndex = 250;
  map.createPane("waymarkedTrailsPane");
  map.getPane("waymarkedTrailsPane").style.zIndex = 300;

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

  baseMaps[BASEMAP_CONFIG[0].key].addTo(map);

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
    const success = await importMapStateFromUrl(data);

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

  return baseMaps;
}
