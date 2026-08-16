// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * AUTOSAVE
 *
 * Periodically saves map layers to IndexedDB as GeoJSON features, each carrying its
 * internal state in a sibling `internal` key (the app's own record format, not a
 * GeoJSON document). On page load, restores saved data; share-URL data is imported on top.
 */

const AUTOSAVE_KEY = "mapAutosave";
const AUTOSAVE_INTERVAL_MS = 5000;
// Autosave record format version. Records without `v` are legacy data saved before
// internal state moved off feature.properties (see restoreAutosave's migration).
const AUTOSAVE_FORMAT_VERSION = 1;

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

      feature.internal = { ...layer.internal };
      features.push(feature);
    } catch (e) {
      console.warn("Autosave: skipping layer", e);
    }
  });

  if (features.length === 0) return "";
  return JSON.stringify({ v: AUTOSAVE_FORMAT_VERSION, type: "FeatureCollection", features });
}

/**
 * Saves current map state to IndexedDB if it changed.
 */
function _autosaveTick() {
  const json = _serializeLayersForAutosave();
  if (json === _lastAutosaveJson) return;

  // _lastAutosaveJson is committed only after the write succeeds, so a failed
  // write leaves it stale and the next tick retries instead of early-returning.
  if (json === "") {
    idbKeyval
      .del(AUTOSAVE_KEY)
      .then(() => {
        _lastAutosaveJson = json;
      })
      .catch(() => {});
  } else {
    idbKeyval
      .set(AUTOSAVE_KEY, json)
      .then(() => {
        _lastAutosaveJson = json;
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
 * Should be called after layer groups are initialized, before any share-URL import.
 * @returns {Promise<boolean>} true if data was restored
 */
async function restoreAutosave() {
  // The idbKeyval.get is inside the try so a broken IndexedDB (e.g. a deleted object
  // store) costs only the restore, not the rest of the app's initialization.
  try {
    const json = await idbKeyval.get(AUTOSAVE_KEY);
    if (!json) return false;

    const geojsonData = JSON.parse(json);
    if (!geojsonData || geojsonData.type !== "FeatureCollection" || !geojsonData.features?.length) {
      return false;
    }

    // ---- LEGACY MIGRATION - delete this whole block to drop legacy support ------------
    // Upgrades records without `v` to the v1 shape; nothing below this block knows
    // legacy data exists. Legacy features carried pathType/color/hidden inside
    // properties and had no guaranteed name.
    if (!geojsonData.v) {
      geojsonData.v = 1;
      geojsonData.features.forEach((feature) => {
        const { hidden, color, pathType, ...props } = feature.properties || {};
        const hex = parseColor(color);
        if (hex) props[feature.geometry?.type === "Point" ? "marker-color" : "stroke"] = hex;
        if (!props.name) {
          const geomType = feature.geometry?.type;
          props.name = geomType === "Point" ? "Marker" : geomType === "Polygon" ? "Area" : "Path";
        }
        feature.properties = props;
        feature.internal = { pathType, isManuallyHidden: hidden };
      });
    }
    // ---- END LEGACY MIGRATION ----------------------------------------------------------

    // Any other version can't be fully read - better no restore than a wrong one.
    if (geojsonData.v !== AUTOSAVE_FORMAT_VERSION) return false;

    let restoredCount = 0;

    geojsonData.features.forEach((feature) => {
      if (!feature.geometry) return;

      // Properties are restored verbatim; internal state comes from the sibling `internal`
      // object autosave writes next to each feature (see _serializeLayersForAutosave).
      const props = feature.properties || {};
      const internal = feature.internal || {};
      const pathType = internal.pathType || "drawn";
      const geomType = feature.geometry.type;
      const color = parseColorFromGeoJsonStyle(props, geomType === "Point") || DEFAULT_COLOR;

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
      // Rebuilt field by field rather than spread, so no stray key from saved data survives
      // into the live layer - a new internal field must be restored here explicitly.
      // isManuallyHidden starts false and is applied below via toggleLayerVisibility(),
      // which flips the flag itself and performs the actual hiding.
      const wasHidden = internal.isManuallyHidden;
      layer.internal = { pathType, isManuallyHidden: false };
      // Ensures exactly one simplestyle color key even if the saved record had none.
      setLayerColor(layer, color);

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
