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

      const geojson = layer.toGeoJSON();
      if (!geojson || !geojson.geometry || !geojson.geometry.type) return;

      // Extract full precision coordinates directly from layer
      applyFullPrecisionCoordinates(layer, geojson);

      // Preserve properties that matter for restoring state
      const props = {};
      const src = geojson.properties || {};
      if (src.name) props.name = src.name;
      if (src.description) props.description = src.description;
      if (src.color) props.color = src.color;
      if (src.stravaId) props.stravaId = src.stravaId;
      if (src.type) props.type = src.type; // Strava activity type (Ride, Run, etc.)
      props.pathType = src.pathType || "drawn";
      if (layer.isManuallyHidden) props.hidden = true;

      geojson.properties = props;
      geojson.type = "Feature";
      features.push(geojson);
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

      // Kept out of props so it can't leak into feature.properties or a GeoJSON export.
      const { hidden: wasHidden, ...props } = feature.properties || {};
      const color = parseColor(props.color) || DEFAULT_COLOR;
      const pathType = props.pathType || "drawn";
      const geomType = feature.geometry.type;

      let layer;

      if (geomType === "Point") {
        const coords = feature.geometry.coordinates;
        const latlng = coordToLatLng(coords).wrap();
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
        properties: { ...props, color, pathType },
        geometry: feature.geometry,
      };
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
