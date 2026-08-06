// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * AUTOSAVE
 *
 * Periodically saves map layers to IndexedDB as GeoJSON.
 * On page load, restores saved data (unless a share URL is present).
 */

const AUTOSAVE_KEY = "mapAutosave";
const AUTOSAVE_INTERVAL_MS = 5000;

let _lastAutosaveJson = "";
let _autosaveWriteFailed = false;

/**
 * Serializes all exportable layers to a GeoJSON string.
 * Reuses the same full-precision coordinate extraction as exportGeoJson().
 * @returns {string} GeoJSON FeatureCollection as JSON string, or "" if empty
 */
function _serializeLayersForAutosave() {
  const allLayers = getAllExportableLayers();
  if (allLayers.length === 0) return "";

  const features = [];

  allLayers.forEach((layer) => {
    try {
      // Skip the active (unsaved) route — routing state can't be restored
      if (currentRoutePath && layer === currentRoutePath) return;

      // The same portable feature a GeoJSON export writes, saved verbatim. Internal state
      // rides along in a sibling key - this record is the app's own format, not a GeoJSON
      // document, so an extra key is fine here.
      const feature = layerToPortableFeature(layer);
      if (!feature) return;

      feature.internal = { ...layer.internal, pathType: layer.internal?.pathType || "drawn" };
      features.push(feature);
    } catch (e) {
      console.warn("Autosave: skipping layer", e);
    }
  });

  if (features.length === 0) return "";
  return JSON.stringify({ type: "FeatureCollection", features });
}

/**
 * Saves current map state to IndexedDB if it changed.
 */
function _autosaveTick() {
  const json = _serializeLayersForAutosave();
  if (json === _lastAutosaveJson) return;
  _lastAutosaveJson = json;

  if (json === "") {
    idbKeyval.del(AUTOSAVE_KEY).catch(() => {});
  } else {
    idbKeyval
      .set(AUTOSAVE_KEY, json)
      .then(() => {
        _autosaveWriteFailed = false;
      })
      .catch((e) => {
        if (!_autosaveWriteFailed) {
          _autosaveWriteFailed = true;
          console.warn("Autosave: IndexedDB write failed", e);
          Swal.fire({
            toast: true,
            icon: "warning",
            title: "Autosave failed — could not write to storage. Please export your work.",
            position: "top",
            showConfirmButton: false,
            timer: 5000,
          });
        }
      });
  }
}

/**
 * Restores map state from IndexedDB.
 * Routes each feature to the correct layer group based on its saved pathType.
 * Should be called after layer groups are initialized and only if no share URL data is present.
 * @returns {Promise<boolean>} true if data was restored
 */
async function restoreAutosave() {
  const json = await idbKeyval.get(AUTOSAVE_KEY);
  if (!json) return false;

  try {
    const geojsonData = JSON.parse(json);
    if (!geojsonData || geojsonData.type !== "FeatureCollection" || !geojsonData.features?.length) {
      return false;
    }

    let restoredCount = 0;

    geojsonData.features.forEach((feature) => {
      if (!feature.geometry) return;

      // Legacy data (saved before internal state moved off feature.properties) carries
      // pathType/color/hidden inside properties - pull them out so they can't leak back into
      // feature.properties or a GeoJSON export. Newer data has none of these keys and gets its
      // internal state from the sibling `internal` object instead.
      const {
        hidden: legacyHidden,
        color: legacyColor,
        pathType: legacyPathType,
        ...props
      } = feature.properties || {};
      const internal = feature.internal ?? {
        pathType: legacyPathType,
        isManuallyHidden: legacyHidden,
      };
      const pathType = internal.pathType || "drawn";
      const geomType = feature.geometry.type;
      // Legacy color lived under a plain "color" key; current data already carries it
      // under its simplestyle-spec key, which parseColorFromGeoJsonStyle() reads.
      const color = parseColor(legacyColor) || parseColorFromGeoJsonStyle(props) || DEFAULT_COLOR;

      let layer;

      if (geomType === "Point") {
        const coords = feature.geometry.coordinates;
        const latlng = wrapLatLngIfNeeded(coordToLatLng(coords));
        layer = L.marker(latlng, {
          icon: createMarkerIcon(color, STYLE_CONFIG.marker.default.opacity),
        });
      } else if (geomType === "Polygon") {
        const ring = feature.geometry.coordinates[0];
        const latlngs = ring.map(coordToLatLng);
        // Remove closing duplicate if present
        if (latlngs.length > 1) {
          const first = latlngs[0],
            last = latlngs[latlngs.length - 1];
          if (first.equals(last)) latlngs.pop();
        }
        layer = L.polygon(latlngs, { ...STYLE_CONFIG.path.default, color });
      } else if (geomType === "LineString") {
        const latlngs = feature.geometry.coordinates.map(coordToLatLng);
        layer = L.polyline(latlngs, { ...STYLE_CONFIG.path.default, color });
      } else {
        return; // Unsupported geometry
      }

      // Set feature data
      layer.feature = {
        type: "Feature",
        properties: props,
        geometry: feature.geometry,
      };
      // Rebuilt field by field rather than spread, so no stray key from older saved data
      // survives into the live layer. isManuallyHidden starts false and is applied below via
      // toggleLayerVisibility(), which flips the flag itself and performs the actual hiding.
      const wasHidden = internal.isManuallyHidden;
      layer.internal = { pathType, isManuallyHidden: false };
      // Normalizes the resolved color onto the right simplestyle key, and migrates
      // legacy data that stored it under a plain "color" key.
      setLayerColor(layer, color);
      // Safety net for autosave data saved before names were guaranteed at creation time
      if (!layer.feature.properties.name) {
        layer.feature.properties.name = getDefaultLayerName(layer);
      }

      // Click handler
      layer.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        selectItem(layer);
      });

      // Route to the correct layer group - shares ui-handlers.js's getGroupTitle() so
      // grouping logic can't drift between restore and the overview list.
      const groupKey = getGroupTitle(pathType);
      if (groupKey === "StravaActivities") {
        stravaActivitiesLayer.addLayer(layer);
      } else if (groupKey === "DrawnItems") {
        drawnItems.addLayer(layer);
        editableLayers.addLayer(layer);
      } else {
        importedItems.addLayer(layer);
      }

      if (wasHidden) toggleLayerVisibility(layer);

      restoredCount++;
    });

    // Update UI state
    updateElevationToggleIconColor();
    updateDrawControlStates();
    updateOverviewList();

    _lastAutosaveJson = json; // Prevent immediate re-save of what we just loaded
    console.log("Autosave: restored", restoredCount, "features");

    if (restoredCount > 0) {
      Swal.fire({
        toast: true,
        icon: "success",
        title: `Restored ${restoredCount} item${restoredCount !== 1 ? "s" : ""} from previous session`,
        position: "top",
        showConfirmButton: false,
        timer: 3000,
      });
    }

    return restoredCount > 0;
  } catch (e) {
    console.warn("Autosave: restore failed", e);
    return false;
  }
}

let _autosaveIntervalId = null;

/**
 * Starts the periodic autosave interval.
 */
function startAutosave() {
  if (_autosaveIntervalId) return; // Guard against double-init
  _autosaveIntervalId = setInterval(_autosaveTick, AUTOSAVE_INTERVAL_MS);
}
