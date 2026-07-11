// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * FILE HANDLING
 *
 * Handles import/export for GeoJSON, GPX, KML, KMZ formats.
 * All formats preserve full precision coordinates, name, description, color, stravaId.
 *
 * Color handling:
 * - GPX: colors extracted from DOM before importGeoJsonToMap()
 * - GeoJSON/KML/KMZ: colors parsed inside importGeoJsonToMap() via helper functions
 * - All formats default to DEFAULT_COLOR if color is missing or invalid
 * - Custom colors (not in palette) are preserved
 */

// 1. GENERAL UTILITIES
// --------------------------------------------------------------------

/**
 * Checks whether a closed ring of [lng, lat, ele?] coordinates winds
 * clockwise, using the shoelace formula.
 * @param {Array} ring - Closed ring coordinates (first and last equal)
 * @returns {boolean} True if the ring winds clockwise
 */
function isRingClockwise(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += (x2 - x1) * (y2 + y1);
  }
  return sum > 0;
}

/**
 * Overwrites a GeoJSON geometry's coordinates with full precision values
 * read directly from the Leaflet layer (avoids toGeoJSON precision loss).
 * @param {L.Layer} layer - The Leaflet layer
 * @param {object} geojson - The GeoJSON object whose geometry.coordinates will be updated
 */
function applyFullPrecisionCoordinates(layer, geojson) {
  if (layer instanceof L.Marker) {
    const ll = layer.getLatLng();
    const coords = [ll.lng, ll.lat];
    if (typeof ll.alt === "number") coords.push(ll.alt);
    geojson.geometry.coordinates = coords;
  } else if (layer instanceof L.Polygon) {
    const latlngs = layer.getLatLngs()[0];
    const coords = latlngs.map((ll) => {
      const coord = [ll.lng, ll.lat];
      if (typeof ll.alt === "number") coord.push(ll.alt);
      return coord;
    });
    coords.push(coords[0]); // Close the polygon
    // RFC 7946 section 3.1.6: exterior rings MUST wind counterclockwise.
    if (isRingClockwise(coords)) coords.reverse();
    geojson.geometry.coordinates = [coords];
  } else if (layer instanceof L.Polyline) {
    let latlngs = layer.getLatLngs();
    while (Array.isArray(latlngs[0]) && !(latlngs[0] instanceof L.LatLng)) {
      latlngs = latlngs[0];
    }
    geojson.geometry.coordinates = latlngs.map((ll) => {
      const coord = [ll.lng, ll.lat];
      if (typeof ll.alt === "number") coord.push(ll.alt);
      return coord;
    });
  }
}

/**
 * Gets all layers that should be included in full exports (everything/all).
 * Includes drawn items, imported items, current route, and Strava activities.
 * @returns {Array} Array of all exportable layers
 */
function getAllExportableLayers() {
  const allLayers = [...editableLayers.getLayers(), ...importedItems.getLayers()];

  // Add current route if exists
  if (currentRoutePath) {
    allLayers.push(currentRoutePath);
  }

  // Add Strava activities
  stravaActivitiesLayer.eachLayer((layer) => {
    allLayers.push(layer);
  });

  return allLayers;
}

/**
 * Escapes special characters for use in XML/KML/GPX documents.
 * @param {string} unsafe - The string to escape
 * @returns {string} The escaped string
 */
function escapeXml(unsafe) {
  if (!unsafe) return "";
  return unsafe.toString().replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
    }
  });
}

/**
 * A lone selected item - a "selection" of exactly one - is named after
 * itself with no timestamp, same across GeoJSON/GPX/KML; anything else
 * (a real bulk export) gets a generic prefix plus a timestamp instead.
 * @param {Array|null} layers - The selection passed to the export function
 * @returns {string|null} The item's name, or null if not a single-item selection
 */
function getSingleNamedItem(layers) {
  return layers?.length === 1 ? layers[0].feature?.properties?.name : null;
}

/**
 * Supported geometry types for import.
 * Multi-geometry types (MultiLineString, MultiPolygon, etc.) and GeometryCollections
 * are automatically exploded into separate simple features for editing compatibility.
 */
const SUPPORTED_IMPORT_GEOM_TYPES = ["Point", "LineString", "Polygon"];

/**
 * Explodes multi-geometries and GeometryCollections into separate features.
 * Converts MultiLineString, MultiPolygon, MultiPoint, and GeometryCollection
 * into arrays of simple features that can be edited individually.
 * @param {object} feature - GeoJSON feature that may contain multi-geometry
 * @returns {Array} Array of features with simple geometries only
 */
function explodeMultiGeometries(feature) {
  if (!feature.geometry) return [];

  const geomType = feature.geometry.type;

  // Map geometry types to user-friendly names for labels
  const labelMap = {
    LineString: "Path",
    Polygon: "Area",
    Point: "Marker",
  };

  // Handle GeometryCollection (from KML MultiGeometry)
  if (geomType === "GeometryCollection") {
    // Count occurrences of each geometry type to handle duplicates
    const typeCounts = {};
    return feature.geometry.geometries.map((geom) => {
      const type = geom.type;
      typeCounts[type] = (typeCounts[type] || 0) + 1;
      const suffix = typeCounts[type] > 1 ? ` ${typeCounts[type]}` : "";
      const typeLabel = labelMap[type] || type;

      return {
        type: "Feature",
        geometry: geom,
        properties: {
          ...feature.properties,
          name: feature.properties?.name
            ? `${feature.properties.name} (${typeLabel}${suffix})`
            : undefined,
        },
      };
    });
  }

  // Handle Multi-geometries (MultiLineString, MultiPolygon, MultiPoint)
  if (geomType.startsWith("Multi")) {
    const singleType = geomType.replace("Multi", ""); // MultiLineString -> LineString
    return feature.geometry.coordinates.map((coords, index) => {
      const count = feature.geometry.coordinates.length;
      const suffix = count > 1 && index > 0 ? ` ${index + 1}` : "";
      const typeLabel = labelMap[singleType] || singleType;

      return {
        type: "Feature",
        geometry: { type: singleType, coordinates: coords },
        properties: {
          ...feature.properties,
          name: feature.properties?.name
            ? `${feature.properties.name} (${typeLabel}${suffix})`
            : undefined,
        },
      };
    });
  }

  // Simple geometry - return as-is if supported
  if (SUPPORTED_IMPORT_GEOM_TYPES.includes(geomType)) {
    return [feature];
  }

  return []; // Unsupported type
}

// 2. IMPORT (FILE-BASED)
// --------------------------------------------------------------------

// Color parsing helpers (used by importGeoJsonToMap)

/**
 * Parses color from standard GeoJSON stroke/marker-color properties.
 * Supports hex values and CSS color names.
 * @param {object} properties - The GeoJSON feature properties
 * @returns {string|null} Normalized hex color or null
 */
function parseColorFromGeoJsonStyle(properties) {
  const raw = properties?.stroke || properties?.["marker-color"];
  return parseColor(raw);
}

/**
 * Parses a color from KML style properties (after toGeoJSON conversion).
 *
 * Standard KML: LineStyle colors are parsed by toGeoJSON into properties.stroke
 * Our exports: Inline IconStyle colors are handled separately by applyKmlIconColors()
 *
 * @param {object} properties - The feature properties from toGeoJSON
 * @returns {string} Hex color or DEFAULT_COLOR
 */
function parseColorFromKmlStyle(properties) {
  // Standard KML: LineStyle colors parsed by toGeoJSON
  if (properties.stroke) {
    const parsed = parseColor(properties.stroke);
    if (parsed) return parsed;
  }

  // --- Organic Maps specific ---
  // Organic Maps uses styleUrl like #placemark-red or icon URLs like placemark-red.png
  if (properties.styleUrl) {
    const match = properties.styleUrl.match(/#placemark-(\w+)/i);
    if (match) {
      const parsed = parseColor(match[1]);
      if (parsed) return parsed;
    }
  }
  if (properties.icon) {
    const match = properties.icon.match(/placemark-(\w+)\.png/i);
    if (match) {
      const parsed = parseColor(match[1]);
      if (parsed) return parsed;
    }
  }
  // --- End Organic Maps specific ---

  return DEFAULT_COLOR;
}

/**
 * Imports GeoJSON data to the map, applying appropriate styles.
 * @param {object} geoJsonData - The GeoJSON data to add
 * @param {string} fileType - The file type ('gpx', 'kml', 'kmz', 'geojson')
 * @returns {L.GeoJSON} The created layer group
 */
function importGeoJsonToMap(geoJsonData, fileType) {
  const targetGroup = importedItems; // All imported files go to the same group
  const isKmlBased = fileType === "kml" || fileType === "kmz";

  /**
   * Internal helper to resolve the color for a feature.
   * Color resolution: try color property, then format-specific parsing, then default.
   */
  const resolveColor = (properties) => {
    if (!properties) return DEFAULT_COLOR;
    return (
      parseColor(properties.color) || // Normalize color if present
      (isKmlBased
        ? parseColorFromKmlStyle(properties) // KML/KMZ parsing
        : parseColorFromGeoJsonStyle(properties)) || // GeoJSON stroke/marker-color
      DEFAULT_COLOR
    );
  };

  const layerGroup = L.geoJSON(geoJsonData, {
    style: (feature) => {
      const color = resolveColor(feature.properties);
      return { ...STYLE_CONFIG.path.default, color: color };
    },
    onEachFeature: (feature, layer) => {
      const color = resolveColor(feature.properties);

      // Store the resolved color
      layer.feature.properties.color = color;

      // Default a missing/empty name so it's never treated as blank downstream
      // (display, export).
      if (!layer.feature.properties.name) {
        layer.feature.properties.name = getDefaultLayerName(layer);
      }

      // All imported items use fileType as pathType
      layer.pathType = fileType;

      layer.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        selectItem(layer);
      });
    },
    pointToLayer: (feature, latlng) => {
      const color = resolveColor(feature.properties);

      const marker = L.marker(latlng, {
        icon: createMarkerIcon(color, STYLE_CONFIG.marker.default.opacity),
      });
      marker.feature = feature;
      return marker;
    },
  });

  layerGroup.eachLayer((layer) => {
    targetGroup.addLayer(layer);
  });

  updateElevationToggleIconColor();
  updateDrawControlStates();
  if (!map.hasLayer(targetGroup)) {
    map.addLayer(targetGroup);
  }
  updateOverviewList();
  return layerGroup;
}

// GeoJSON
// Specification: https://tools.ietf.org/html/rfc7946

/**
 * Imports and processes a GeoJSON file.
 * @param {File} file - The GeoJSON file to process
 */
function importGeoJsonFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (readEvent) => {
    try {
      const geojsonData = JSON.parse(readEvent.target.result);

      // Validate GeoJSON structure
      if (!geojsonData || !geojsonData.type) {
        throw new Error("Invalid GeoJSON: missing 'type' property");
      }

      // Support both FeatureCollection and single Feature
      let features = [];
      if (geojsonData.type === "FeatureCollection") {
        features = geojsonData.features || [];
      } else if (geojsonData.type === "Feature") {
        features = [geojsonData];
      } else {
        throw new Error("GeoJSON must be a FeatureCollection or Feature");
      }

      // Explode multi-geometries and filter for supported types
      // Color parsing is handled centrally in importGeoJsonToMap()
      const explodedFeatures = features.flatMap((feature) => explodeMultiGeometries(feature));

      if (explodedFeatures.length === 0) {
        return Swal.fire({
          title: "No Supported Geometries",
          text: "The GeoJSON file contains no Point, LineString, or Polygon features.",
        });
      }

      // Create a valid FeatureCollection with exploded features
      const filteredGeoJson = {
        type: "FeatureCollection",
        features: explodedFeatures,
      };

      const newLayer = importGeoJsonToMap(filteredGeoJson, "geojson");
      if (newLayer && newLayer.getBounds().isValid()) {
        map.fitBounds(newLayer.getBounds());
      }
    } catch (error) {
      console.error("Error parsing GeoJSON file:", error);
      Swal.fire({
        title: "GeoJSON Parse Error",
        text: `Could not parse the file: ${error.message}`,
      });
    }
  };
  reader.readAsText(file);
}

// GPX
// Specification: https://www.topografix.com/gpx/1/1/

/**
 * Parses colors from GPX DOM and attaches them to GeoJSON features.
 * Must be called BEFORE explosion to ensure all segments inherit the color.
 * @param {Document} dom - The parsed GPX XML document
 * @param {object} geojsonData - The GeoJSON data from toGeoJSON.gpx()
 */
function applyGpxColors(dom, geojsonData) {
  const tracksInDom = dom.querySelectorAll("trk");
  const routesInDom = dom.querySelectorAll("rte");
  const waypointsInDom = dom.querySelectorAll("wpt");

  // Extract colors from tracks (returns hex or null)
  const trackColors = Array.from(tracksInDom).map((node) => {
    const colorNode = node.querySelector("gpx_style\\:color, color");
    return colorNode ? parseColor(colorNode.textContent) : null;
  });

  // Extract colors from routes (returns hex or null)
  const routeColors = Array.from(routesInDom).map((node) => {
    const colorNode = node.querySelector("gpx_style\\:color, color");
    return colorNode ? parseColor(colorNode.textContent) : null;
  });

  // Extract colors from waypoints (returns hex or null)
  const waypointColors = Array.from(waypointsInDom).map((node) => {
    const colorNode = node.querySelector("gpx_style\\:color, color");
    return colorNode ? parseColor(colorNode.textContent) : null;
  });

  // Apply colors to features (toGeoJSON outputs: trk, then rte, then wpt)
  const trackCount = tracksInDom.length;
  const routeCount = routesInDom.length;
  let trackIndex = 0;
  let routeIndex = 0;
  let waypointIndex = 0;

  geojsonData.features.forEach((feature) => {
    const type = feature.geometry?.type;

    if (type === "LineString" || type === "MultiLineString") {
      // Tracks come first in toGeoJSON output
      if (trackIndex < trackCount) {
        if (trackColors[trackIndex]) {
          feature.properties = feature.properties || {};
          feature.properties.color = trackColors[trackIndex];
        }
        trackIndex++;
      }
      // Routes come after tracks
      else if (routeIndex < routeCount) {
        if (routeColors[routeIndex]) {
          feature.properties = feature.properties || {};
          feature.properties.color = routeColors[routeIndex];
        }
        routeIndex++;
      }
    } else if (type === "Point") {
      // Waypoints come last
      if (waypointIndex < waypointColors.length && waypointColors[waypointIndex]) {
        feature.properties = feature.properties || {};
        feature.properties.color = waypointColors[waypointIndex];
      }
      waypointIndex++;
    }
  });
}

/**
 * Imports and processes a GPX file.
 * @param {File} file - The GPX file to process
 */
function importGpxFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (readEvent) => {
    try {
      const dom = new DOMParser().parseFromString(readEvent.target.result, "text/xml");
      const geojsonData = toGeoJSON.gpx(dom);

      // Extract colors from GPX DOM and attach to features BEFORE explosion
      applyGpxColors(dom, geojsonData);

      // Extract stravaId from tracks
      const tracksInDom = dom.querySelectorAll("trk");
      let trackIndex = 0;
      geojsonData.features.forEach((feature) => {
        if (
          feature.geometry?.type === "LineString" ||
          feature.geometry?.type === "MultiLineString"
        ) {
          if (trackIndex < tracksInDom.length) {
            const stravaIdNode = tracksInDom[trackIndex].querySelector("stravaId");
            if (stravaIdNode) {
              feature.properties = feature.properties || {};
              feature.properties.stravaId = stravaIdNode.textContent.trim();
            }
          }
          trackIndex++;
        }
      });

      // Extract stravaId from waypoints
      const waypointsInDom = dom.querySelectorAll("wpt");
      const pointFeatures = geojsonData.features.filter((f) => f.geometry?.type === "Point");
      if (pointFeatures.length === waypointsInDom.length) {
        pointFeatures.forEach((feature, index) => {
          const stravaIdNode = waypointsInDom[index].querySelector("stravaId");
          if (stravaIdNode) {
            feature.properties = feature.properties || {};
            feature.properties.stravaId = stravaIdNode.textContent.trim();
          }
        });
      }

      // Explode multi-geometries and filter for supported geometry types
      geojsonData.features = geojsonData.features.flatMap((f) => explodeMultiGeometries(f));

      const newLayer = importGeoJsonToMap(geojsonData, "gpx");
      if (newLayer && newLayer.getBounds().isValid()) {
        map.fitBounds(newLayer.getBounds());
      }
    } catch (error) {
      console.error("Error parsing GPX file:", error);
      Swal.fire({
        title: "GPX Parse Error",
        text: `Could not parse the file: ${error.message}`,
      });
    }
  };
  reader.readAsText(file);
}

// KML / KMZ
// Specification: https://developers.google.com/kml/documentation/kmlreference

/**
 * Extracts inline IconStyle colors from KML DOM and attaches them to GeoJSON features.
 *
 * Why this is needed:
 * - toGeoJSON parses LineStyle/PolyStyle colors but ignores IconStyle colors
 * - This handles KML files with inline <Style><IconStyle><color> elements
 * - Primary use case: Re-importing our own KML/KMZ exports which use inline styles
 *
 * Must be called AFTER toGeoJSON conversion but BEFORE explosion.
 *
 * @param {Document} dom - The parsed KML XML document
 * @param {object} geojsonData - The GeoJSON data from toGeoJSON.kml()
 */
function applyKmlIconColors(dom, geojsonData) {
  const placemarks = dom.querySelectorAll("Placemark");

  // Require 1:1 mapping between DOM placemarks and GeoJSON features
  if (!geojsonData?.features || placemarks.length !== geojsonData.features.length) {
    return;
  }

  geojsonData.features.forEach((feature, index) => {
    if (feature.geometry?.type !== "Point") {
      return;
    }

    const placemark = placemarks[index];
    const iconStyleColor = placemark.querySelector("Style IconStyle color");

    if (iconStyleColor) {
      const kmlColor = iconStyleColor.textContent.trim();
      const cssColor = kmlToCssColor(kmlColor);
      if (cssColor) {
        feature.properties = feature.properties || {};
        feature.properties.color = cssColor;
      }
    }
  });
}

/**
 * Parses KML text content to GeoJSON with stravaId extraction.
 * @param {string} kmlText - The KML file content as text
 * @returns {object} GeoJSON data with extracted stravaId properties
 */
function parseKmlContent(kmlText) {
  const dom = new DOMParser().parseFromString(kmlText, "text/xml");
  const geojsonData = toGeoJSON.kml(dom, { styles: true });

  // Extract stravaId from ExtendedData for all placemarks
  const placemarks = dom.querySelectorAll("Placemark");
  if (geojsonData?.features?.length > 0 && placemarks.length === geojsonData.features.length) {
    geojsonData.features.forEach((feature, index) => {
      const placemark = placemarks[index];
      const stravaIdData = placemark.querySelector('Data[name="stravaId"] value');
      if (stravaIdData) {
        feature.properties = feature.properties || {};
        feature.properties.stravaId = stravaIdData.textContent.trim();
      }
    });
  }

  // Extract inline IconStyle colors (for re-importing our own KML/KMZ exports)
  // Must be called BEFORE explosion so colors propagate to all exploded features
  applyKmlIconColors(dom, geojsonData);

  // Explode multi-geometries and filter for supported geometry types
  if (geojsonData?.features) {
    geojsonData.features = geojsonData.features.flatMap((f) => explodeMultiGeometries(f));
  }

  return geojsonData;
}

/**
 * Imports and processes a KML file.
 * @param {File} file - The KML file to process
 */
function importKmlFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (readEvent) => {
    try {
      const geojsonData = parseKmlContent(readEvent.target.result);

      const newLayer = importGeoJsonToMap(geojsonData, "kml");
      if (newLayer && newLayer.getBounds().isValid()) {
        map.fitBounds(newLayer.getBounds());
      }
    } catch (error) {
      console.error("Error parsing KML file:", error);
      Swal.fire({
        title: "KML Parse Error",
        text: `Could not parse the file: ${error.message}`,
      });
    }
  };
  reader.readAsText(file);
}

/**
 * Imports and processes a KMZ file.
 * @param {File} file - The KMZ file to process
 */
async function importKmzFile(file) {
  if (!file) return;

  const zip = new JSZip();
  const justImportedLayers = L.featureGroup();

  try {
    const loadedZip = await zip.loadAsync(file);
    const kmlFiles = loadedZip.filter(
      (relativePath, file) => !file.dir && relativePath.toLowerCase().endsWith(".kml"),
    );

    if (kmlFiles.length === 0) {
      return Swal.fire({
        title: "No KML Data",
        text: "No KML files could be found within the KMZ archive.",
      });
    }

    // Process all KML files concurrently
    await Promise.all(
      kmlFiles.map(async (kmlFile) => {
        const content = await kmlFile.async("text");
        const geojsonData = parseKmlContent(content);

        // Import features if present
        if (geojsonData?.features?.length > 0) {
          const newLayer = importGeoJsonToMap(geojsonData, "kmz");
          if (newLayer) {
            justImportedLayers.addLayer(newLayer);
          }
        }
      }),
    );

    if (justImportedLayers.getLayers().length > 0) {
      const bounds = justImportedLayers.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds);
      }
    } else {
      Swal.fire({
        title: "KMZ Loaded (No Features)",
        text: "No geographical features found in the KMZ file.",
      });
    }
  } catch (error) {
    console.error("Error loading or processing KMZ file:", error);
    Swal.fire({
      title: "KMZ Read Error",
      text: `Could not read the file: ${error.message}`,
    });
  }
}

// 3. EXPORT (FILE-BASED)
// --------------------------------------------------------------------

/**
 * Shows the dialog shared by GeoJSON/GPX/KML export when a selection-based
 * export is invoked with nothing selected.
 */
function alertNothingSelected() {
  return Swal.fire({
    title: "Nothing Selected",
    text: "Please select at least one item to export.",
  });
}

/**
 * Shows a timed "Export Successful" toast, or does nothing when `shouldNotify`
 * is false - e.g. an obviously-intentional single-item download needs no
 * confirmation beyond the browser's own download indicator.
 * @param {boolean} shouldNotify
 * @param {string} title
 * @param {string} text
 */
function notifyExportSuccess(shouldNotify, title, text) {
  if (!shouldNotify) return;
  Swal.fire({ title, text, timer: 2000, showConfirmButton: false });
}

/**
 * Properties to exclude from GeoJSON export.
 * These are internal/style properties that shouldn't be included in exported files.
 */
const GEOJSON_EXPORT_EXCLUDED_PROPERTIES = [
  "color",
  "totalDistance",
  "stroke-width",
  "stroke-opacity",
  "fill",
  "fill-color",
  "fill-opacity",
];

// GeoJSON
// Specification: https://tools.ietf.org/html/rfc7946

/**
 * Exports map items to a GeoJSON file with color preservation.
 * @param {Object} options - Export options
 * @param {string} options.mode - Export mode: "all" (default), "selection", or "strava"
 * @param {string} options.filePrefix - Prefix for the filename (defaults based on mode)
 * @param {string} options.successTitle - Success dialog title (defaults based on mode)
 * @param {string} options.successText - Success dialog text (defaults based on mode)
 */
function exportGeoJson(options = {}) {
  const {
    mode = "all",
    layers = null,
    filePrefix = null,
    successTitle = "Export Successful!",
    successText = null,
  } = options;

  const features = [];
  let allLayers = [];

  // Collect layers based on mode
  if (mode === "selection") {
    if (!layers || layers.length === 0) {
      return alertNothingSelected();
    }
    allLayers = layers;
  } else if (mode === "strava") {
    stravaActivitiesLayer.eachLayer((l) => {
      allLayers.push(l);
    });
    if (allLayers.length === 0) {
      return Swal.fire({
        title: "No Activities Loaded",
        text: "Please fetch your activities before exporting.",
      });
    }
  } else {
    // mode === "all"
    allLayers = getAllExportableLayers();

    if (allLayers.length === 0) {
      return Swal.fire({
        title: "No Data to Export",
        text: "There are no items on the map to export.",
      });
    }
  }

  // Convert each layer to GeoJSON
  allLayers.forEach((layer) => {
    try {
      const geojson = layer.toGeoJSON();

      // Skip if toGeoJSON didn't produce valid geometry
      if (!geojson || !geojson.geometry || !geojson.geometry.type) {
        console.warn("Skipping layer with invalid geometry:", layer);
        return;
      }

      // Extract full precision coordinates directly from layer
      applyFullPrecisionCoordinates(layer, geojson);

      // Get color (stored hex or default)
      const color = layer.feature?.properties?.color || DEFAULT_COLOR;

      // Filter out excluded properties
      const filteredProperties = Object.keys(geojson.properties || {}).reduce((acc, key) => {
        if (!GEOJSON_EXPORT_EXCLUDED_PROPERTIES.includes(key)) {
          acc[key] = geojson.properties[key];
        }
        return acc;
      }, {});

      // Set filtered properties
      geojson.properties = {
        ...filteredProperties,
      };

      // Add standard GeoJSON styling for other tools
      if (layer instanceof L.Polyline || layer instanceof L.Polygon) {
        geojson.properties.stroke = color;
      }

      if (layer instanceof L.Marker) {
        geojson.properties["marker-color"] = color;
      }

      // Ensure type: "Feature" is present
      geojson.type = "Feature";

      features.push(geojson);
    } catch (error) {
      console.error("Error converting layer to GeoJSON:", error, layer);
      // Skip this layer and continue with others
    }
  });

  // For strava mode, check if we got any exportable features
  if (mode === "strava" && features.length === 0) {
    return Swal.fire({
      title: "No Exportable Data",
      text: "Could not generate GeoJSON for loaded activities.",
    });
  }

  // Create FeatureCollection
  const geojsonDoc = {
    type: "FeatureCollection",
    features: features,
  };

  const singleNamedItem = mode === "selection" ? getSingleNamedItem(allLayers) : null;

  // Determine filename prefix
  let finalFilePrefix = filePrefix;
  if (!finalFilePrefix) {
    if (singleNamedItem) {
      finalFilePrefix = singleNamedItem;
    } else if (mode === "selection") {
      finalFilePrefix = "Selected_Export";
    } else if (mode === "strava") {
      finalFilePrefix = "Strava_Export";
    } else {
      finalFilePrefix = "Map_Export";
    }
  }

  const fileName = singleNamedItem
    ? `${finalFilePrefix}.geojson`
    : generateTimestampedFilename(finalFilePrefix, "geojson");

  // Download file
  downloadFile(fileName, JSON.stringify(geojsonDoc, null, 2));

  notifyExportSuccess(
    mode === "all" || (mode === "selection" && allLayers.length > 1),
    successTitle,
    successText ||
      (mode === "all"
        ? "All items have been exported to GeoJSON."
        : `${allLayers.length} selected items have been exported to GeoJSON.`),
  );
}

// GPX
// Specification: https://www.topografix.com/gpx/1/1/

const GPX_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"
    xmlns:gpxx="http://www.garmin.com/xmlschemas/GpxExtensions/v3"
    xmlns:gpx_style="http://www.topografix.com/GPX/gpx_style/0/2"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.topografix.com/GPX/1/1 https://www.topografix.com/GPX/1/1/gpx.xsd http://www.topografix.com/GPX/gpx_style/0/2 https://www.topografix.com/GPX/gpx_style/0/2/gpx_style.xsd http://www.garmin.com/xmlschemas/GpxExtensions/v3 https://www.garmin.com/xmlschemas/GpxExtensionsv3.xsd">`;
const GPX_FOOTER = "\n</gpx>";

/**
 * Converts a single layer to a <trk> or <wpt> XML snippet, with no
 * header/footer, so multiple snippets can be concatenated into one GPX
 * document (see buildGpxContent).
 * Note: GPX has no polygon support; areas export as closed tracks and import as paths.
 * @param {L.Layer} layer - The layer to convert
 * @returns {string} The GPX track/waypoint snippet, or "" if unsupported
 */
function convertLayerToGpxSnippet(layer) {
  const name = layer.feature?.properties?.name || "Exported Feature";
  const description = layer.feature?.properties?.description || "";
  const color = layer.feature?.properties?.color || DEFAULT_COLOR;
  // Remove # prefix for GPX format
  const gpxColorHex = color.substring(1).toUpperCase();
  const stravaId = layer.feature?.properties?.stravaId;

  const safeName = escapeXml(name);
  const safeDescription = escapeXml(description);

  if (layer instanceof L.Polygon) {
    let latlngs = layer.getLatLngs()[0];

    // Close the polygon by adding the first point at the end
    const closedLatLngs = [...latlngs, latlngs[0]];

    const pathPoints = closedLatLngs
      .map((p) => {
        let pt = `<trkpt lat="${p.lat}" lon="${p.lng}">`;
        if (typeof p.alt === "number") {
          pt += `<ele>${p.alt}</ele>`;
        }
        pt += `</trkpt>`;
        return pt;
      })
      .join("\n      ");

    return `
  <trk>
    <name>${safeName}</name>
    <extensions>
      <gpx_style:line>
        <gpx_style:color>${gpxColorHex}</gpx_style:color>
      </gpx_style:line>
      <color>#FF${gpxColorHex}</color>${stravaId ? `\n      <stravaId>${stravaId}</stravaId>` : ""}
    </extensions>
    <trkseg>
      ${pathPoints}
    </trkseg>
  </trk>`;
  } else if (layer instanceof L.Polyline) {
    let latlngs = layer.getLatLngs();
    while (latlngs.length > 0 && Array.isArray(latlngs[0]) && !(latlngs[0] instanceof L.LatLng)) {
      latlngs = latlngs[0];
    }

    const pathPoints = latlngs
      .map((p) => {
        let pt = `<trkpt lat="${p.lat}" lon="${p.lng}">`;
        if (typeof p.alt === "number") {
          pt += `<ele>${p.alt}</ele>`;
        }
        pt += `</trkpt>`;
        return pt;
      })
      .join("\n      ");

    return `
  <trk>
    <name>${safeName}</name>
    <extensions>
      <gpx_style:line>
        <gpx_style:color>${gpxColorHex}</gpx_style:color>
      </gpx_style:line>
      <color>#FF${gpxColorHex}</color>${stravaId ? `\n      <stravaId>${stravaId}</stravaId>` : ""}
    </extensions>
    <trkseg>
      ${pathPoints}
    </trkseg>
  </trk>`;
  } else if (layer instanceof L.Marker) {
    const latlng = layer.getLatLng();
    const hasElevation = typeof latlng.alt === "number";
    const wptExtensions =
      `\n    <extensions>\n      <color>#FF${gpxColorHex}</color>` +
      (stravaId ? `\n      <stravaId>${stravaId}</stravaId>` : "") +
      `\n    </extensions>`;
    return `
  <wpt lat="${latlng.lat}" lon="${latlng.lng}">${hasElevation ? `\n    <ele>${latlng.alt}</ele>` : ""}
    <name>${safeName}</name>${safeDescription ? `\n    <desc>${safeDescription}</desc>` : ""}${wptExtensions}
  </wpt>`;
  }
  return "";
}

/**
 * Builds a single GPX document containing one <trk> or <wpt> element per
 * layer - the same "one file, several entries" approach GeoJSON/KML export
 * already use, so no zip/multi-file bundling is needed.
 * The GPX 1.1 schema requires all <wpt> elements before any <trk>, so markers
 * are grouped first while preserving each group's relative order.
 * @param {Array} layers - The layers to convert
 * @returns {string} The GPX file content as a string
 */
function buildGpxContent(layers) {
  const markers = layers.filter((layer) => layer instanceof L.Marker);
  const paths = layers.filter((layer) => !(layer instanceof L.Marker));
  const orderedLayers = [...markers, ...paths];
  return GPX_HEADER + orderedLayers.map(convertLayerToGpxSnippet).join("") + GPX_FOOTER;
}

/**
 * Handles the export and download of the GPX file.
 * @param {{layers?: Array}} [options] - Pass layers to export only a specific
 *   subset (e.g. the current selection) instead of everything on the map.
 */
function exportGpx({ layers = null } = {}) {
  if (layers && layers.length === 0) {
    return alertNothingSelected();
  }

  const allLayers = layers || getAllExportableLayers();

  if (allLayers.length === 0) {
    return Swal.fire({
      title: "No Data to Export",
      text: "There are no items on the map to export.",
    });
  }

  const singleNamedItem = getSingleNamedItem(layers);
  const filePrefix = singleNamedItem || (layers ? "Selected_Export" : "Map_Export");
  const fileName = singleNamedItem
    ? `${filePrefix}.gpx`
    : generateTimestampedFilename(filePrefix, "gpx");

  downloadFile(fileName, buildGpxContent(allLayers));

  notifyExportSuccess(
    !layers || layers.length > 1,
    "Export Successful!",
    layers
      ? `${layers.length} selected items have been exported to GPX.`
      : "All items have been exported to GPX.",
  );
}

// KML / KMZ
// Specification: https://developers.google.com/kml/documentation/kmlreference

/**
 * Converts a Leaflet layer to a KML placemark string.
 * @param {L.Layer} layer - The layer to convert
 * @param {string} defaultName - A fallback name
 * @param {string} defaultDescription - A fallback description
 * @returns {string|null} The KML placemark string or null
 */
function convertLayerToKmlPlacemark(layer, defaultName, defaultDescription = "") {
  let name = defaultName;
  let description = defaultDescription;
  if (layer.feature && layer.feature.properties) {
    name = layer.feature.properties.name || name;
    description = layer.feature.properties.description || description;
  }

  const color = layer.feature?.properties?.color || DEFAULT_COLOR;
  const kmlColor = cssToKmlColor(color);

  const safeName = escapeXml(name);
  const safeDescription = description ? escapeXml(description) : "";
  const stravaId = layer.feature?.properties?.stravaId;

  const placemarkStart =
    `  <Placemark>\n` +
    `    <name>${safeName}</name>\n` +
    (safeDescription ? `    <description>${safeDescription}</description>\n` : "");

  // KML 2.2's AbstractFeatureType schema requires Style before ExtendedData.
  const extendedDataTag = stravaId
    ? `    <ExtendedData>\n      <Data name="stravaId">\n        <value>${stravaId}</value>\n      </Data>\n    </ExtendedData>\n`
    : "";

  const placemarkEnd = `  </Placemark>`;

  if (layer instanceof L.Polyline || layer instanceof L.Polygon) {
    let latlngs;
    let coords;
    if (layer instanceof L.Polygon) {
      // Polygon: close the ring by adding the first point at the end
      latlngs = layer.getLatLngs()[0];
      const closedLatLngs = [...latlngs, latlngs[0]];
      coords = closedLatLngs
        .map((p) => `${p.lng},${p.lat},${typeof p.alt === "number" ? p.alt : 0}`)
        .join(" ");
    } else if (layer instanceof L.Polyline) {
      latlngs = layer.getLatLngs();
      while (latlngs.length > 0 && Array.isArray(latlngs[0]) && !(latlngs[0] instanceof L.LatLng)) {
        latlngs = latlngs[0];
      }
      coords = latlngs
        .map((p) => `${p.lng},${p.lat},${typeof p.alt === "number" ? p.alt : 0}`)
        .join(" ");
    }

    const geometryType = layer instanceof L.Polygon ? "Polygon" : "LineString";
    const geometryTag =
      geometryType === "Polygon"
        ? `    <Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>\n`
        : `    <LineString><coordinates>${coords}</coordinates></LineString>\n`;

    const styleTag =
      `    <Style>\n` +
      `      <LineStyle>\n` +
      `        <color>${kmlColor}</color>\n` +
      `        <width>5</width>\n` +
      `      </LineStyle>\n` +
      `    </Style>\n`;

    return placemarkStart + styleTag + extendedDataTag + geometryTag + placemarkEnd;
  }

  if (layer instanceof L.Marker) {
    const latlng = layer.getLatLng();
    const alt = typeof latlng.alt === "number" ? latlng.alt : 0;
    const pointTag = `    <Point><coordinates>${latlng.lng},${latlng.lat},${alt}</coordinates></Point>\n`;

    const styleTag =
      `    <Style>\n` +
      `      <IconStyle>\n` +
      `        <color>${kmlColor}</color>\n` +
      `        <Icon>\n` +
      `          <href>https://maps.google.com/mapfiles/kml/pushpin/wht-pushpin.png</href>\n` +
      `        </Icon>\n` +
      `      </IconStyle>\n` +
      `    </Style>\n`;

    return placemarkStart + styleTag + extendedDataTag + pointTag + placemarkEnd;
  }

  return null;
}

/**
 * Builds a KML Folder element containing placemarks.
 * @param {string} name - The name for the folder
 * @param {Array<string>} placemarks - An array of pre-formatted KML <Placemark> strings
 * @returns {string} The KML Folder element as a string
 */
function buildKmlFolder(name, placemarks) {
  const safeName = escapeXml(name);
  return (
    `  <Folder>\n` +
    `    <name>${safeName}</name>\n` +
    placemarks.map((p) => p.replace(/^/gm, "  ")).join("\n") +
    `\n  </Folder>`
  );
}

/**
 * Builds a KML string containing map data for export.
 * Uses Folder elements for maximum compatibility with Google Earth Web,
 * Google MyMaps, map.geo.admin.ch, and other KML viewers.
 * @param {string} docName - The name for the KML document
 * @param {Array} [layers] - Specific layers to export; defaults to everything
 *   on the map when omitted.
 * @returns {string|null} The KML content as a string, or null if no data
 */
function buildKmlContent(docName, layers = null) {
  const folders = [];
  let featureCounter = 0;

  const drawnFeatures = [];
  const importedFeatures = [];
  const stravaActivities = [];

  const allLayers = layers || getAllExportableLayers();

  allLayers.forEach(function (layer) {
    const defaultName =
      layer instanceof L.Marker ? `Marker_${++featureCounter}` : `Path_${++featureCounter}`;
    const kmlSnippet = convertLayerToKmlPlacemark(layer, defaultName);
    if (!kmlSnippet) return;

    switch (layer.pathType) {
      case "drawn":
      case "route":
        drawnFeatures.push(kmlSnippet);
        break;
      case "gpx":
      case "kml":
      case "geojson":
      case "kmz":
        importedFeatures.push(kmlSnippet);
        break;
      case "strava":
        stravaActivities.push(kmlSnippet);
        break;
    }
  });

  if (drawnFeatures.length > 0) {
    folders.push(buildKmlFolder("Drawn Features", drawnFeatures));
  }

  if (importedFeatures.length > 0) {
    folders.push(buildKmlFolder("Imported Features", importedFeatures));
  }

  if (stravaActivities.length > 0) {
    folders.push(buildKmlFolder("Strava Activities", stravaActivities));
  }

  if (folders.length === 0) {
    return null;
  }

  const safeDocName = escapeXml(docName);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2">\n` +
    `<Document>\n` +
    `  <name>${safeDocName}</name>\n` +
    `${folders.join("\n")}\n` +
    `</Document>\n` +
    `</kml>`
  );
}

/**
 * Handles the export and download of the KML file.
 * @param {{layers?: Array}} [options] - Pass layers to export only a specific
 *   subset (e.g. the current selection) instead of everything on the map.
 */
function exportKml({ layers = null } = {}) {
  if (layers && layers.length === 0) {
    return alertNothingSelected();
  }

  const singleNamedItem = getSingleNamedItem(layers);

  const timestamp = generateTimestamp();
  const filePrefix = singleNamedItem || (layers ? "Selected_Export" : "Map_Export");
  const fileName = singleNamedItem ? `${filePrefix}.kml` : `${filePrefix}_${timestamp}.kml`;
  const docName = singleNamedItem
    ? filePrefix
    : `${layers ? "Selected" : "Map"} Export ${timestamp}`;

  const kmlContent = buildKmlContent(docName, layers);

  if (!kmlContent) {
    return Swal.fire({
      title: "No Data to Export",
      text: "There are no items on the map to export.",
    });
  }

  const blob = new Blob([kmlContent], { type: "application/vnd.google-earth.kml+xml" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);

  notifyExportSuccess(
    !layers || layers.length > 1,
    "Export Successful!",
    layers
      ? `${layers.length} selected items have been exported to KML.`
      : "All items have been exported to KML.",
  );
}

// 4. SHARING (URL-BASED)
// --------------------------------------------------------------------

/**
 * Collects all chunks from a ReadableStream into a single Uint8Array.
 *
 * @param {ReadableStream<Uint8Array>} readable
 * @returns {Promise<Uint8Array>}
 */
async function collectStream(readable) {
  const chunks = [];
  const reader = readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Encodes text using gzip compression and base64url encoding.
 * Uses the native browser CompressionStream API — no external library required.
 * Base64url (RFC 4648) replaces + with -, / with _, and strips = padding,
 * making the output safe to use directly in URL hashes without percent-encoding.
 *
 * @param {string} text - UTF-8 text to compress
 * @returns {Promise<string>} base64url-encoded gzip-compressed string
 */
async function gzipEncode(text) {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(new TextEncoder().encode(text));
  writer.close();
  const bytes = await collectStream(stream.readable);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Decodes a gzip+base64url encoded string back to the original text.
 *
 * @param {string} encoded - base64url-encoded gzip-compressed string
 * @returns {Promise<string>} decompressed UTF-8 text
 */
async function gzipDecode(encoded) {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  // Suppress write-side rejections: errors on corrupt input propagate through
  // the readable side and are caught by the outer try/catch in importMapStateFromUrl.
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const result = await collectStream(stream.readable);
  return new TextDecoder().decode(result);
}

/**
 * Builds the compact, Polyline-encoded representation of all map features.
 *
 * Compact schema: { v: 1, f: [...features] }
 * Each feature: { t, c, n?, s?, e?, sid? }
 *   t:   "m"=marker, "p"=polyline, "a"=polygon (area)
 *   c:   [lng, lat] for markers (6 decimals); Polyline-encoded string for paths (precision 5 = ~1.1m)
 *   n:   name (omitted if empty)
 *   s:   color hex without # (omitted if DEFAULT_COLOR; # restored by parseColor() inside importGeoJsonToMap)
 *   e:   elevation — integer for markers, integer array for paths (omitted if absent or all zeros)
 *   sid: Strava activity ID (omitted if not a Strava import)
 *
 * Polyline encoding shrinks coordinate sequences far more than any general compressor can,
 * making it the dominant factor in URL length reduction. Short property names and omitted
 * defaults reduce the remaining JSON overhead before gzip is applied.
 *
 * @param {Array} [layers] - Specific layers to include; defaults to everything
 *   on the map when omitted.
 * @returns {{ v: number, f: Array }|null} Compact object, or null if no exportable layers
 */
function buildCompactObject(layers = null) {
  const allLayers = layers || getAllExportableLayers();
  if (allLayers.length === 0) return null;

  const features = [];

  allLayers.forEach((layer) => {
    try {
      const feature = {
        t: "", // type: m=marker, p=polyline, a=polygon (area)
        c: null, // coordinates (encoded for paths, array for markers)
      };

      // Add name, color, and stravaId only if present
      const name = layer.feature?.properties?.name;
      const color = layer.feature?.properties?.color;
      const stravaId = layer.feature?.properties?.stravaId;
      if (name) feature.n = name;
      // Strip # prefix from hex color for URL efficiency (auto-restored by parseColor() inside importGeoJsonToMap)
      if (color && color !== DEFAULT_COLOR) {
        feature.s = color.startsWith("#") ? color.slice(1) : color;
      }
      if (stravaId) feature.sid = stravaId;

      if (layer instanceof L.Marker) {
        const ll = layer.getLatLng();
        if (ll) {
          feature.t = "m";
          feature.c = [+ll.lng.toFixed(6), +ll.lat.toFixed(6)];
          if (typeof ll.alt === "number" && ll.alt !== 0) {
            feature.e = Math.round(ll.alt);
          }
        }
      } else if (layer instanceof L.Polygon) {
        const latlngs = layer.getLatLngs()[0];
        if (latlngs && latlngs.length > 0) {
          feature.t = "a";
          feature.c = L.PolylineUtil.encode(latlngs, 5);
          // Add elevation if all points have it and there's variation (not all zeros)
          const elevations = latlngs.map((ll) => ll.alt).filter((e) => typeof e === "number");
          const hasVariation = elevations.some((e) => e !== 0);
          if (elevations.length === latlngs.length && hasVariation) {
            feature.e = elevations.map((e) => Math.round(e));
          }
        }
      } else if (layer instanceof L.Polyline) {
        let latlngs = layer.getLatLngs();
        while (Array.isArray(latlngs[0]) && !(latlngs[0] instanceof L.LatLng)) {
          latlngs = latlngs[0];
        }
        if (latlngs && latlngs.length > 0) {
          feature.t = "p";
          feature.c = L.PolylineUtil.encode(latlngs, 5);
          // Add elevation if all points have it and there's variation (not all zeros)
          const elevations = latlngs.map((ll) => ll.alt).filter((e) => typeof e === "number");
          const hasVariation = elevations.some((e) => e !== 0);
          if (elevations.length === latlngs.length && hasVariation) {
            feature.e = elevations.map((e) => Math.round(e));
          }
        }
      }

      // Only include features with valid type and coordinates
      if (feature.t && feature.c) {
        features.push(feature);
      }
    } catch (error) {
      console.error("Error converting layer for URL sharing:", error, layer);
    }
  });

  if (features.length === 0) return null;
  return { v: 1, f: features };
}

/**
 * Encodes the current map state to a gzip-compressed, base64url-encoded string.
 * Builds the compact feature representation via buildCompactObject(), serializes to JSON,
 * then compresses with gzip and encodes as base64url for safe embedding in URL hashes.
 *
 * URL Length: "In general, the web platform does not have limits on the length of URLs
 * (although 2^31 is a common limit). Chrome limits URLs to a maximum length of 2MB for
 * practical reasons and to avoid causing denial-of-service problems in inter-process communication."
 * See: https://chromium.googlesource.com/chromium/src/+/HEAD/docs/security/url_display_guidelines/url_display_guidelines.md#URL-Length
 *
 * @param {Array} [layers] - Specific layers to include; defaults to everything
 *   on the map when omitted.
 * @returns {Promise<string|null>} Encoded map state, or null if no data to share
 */
async function encodeMapStateToUrl(layers = null) {
  const compact = buildCompactObject(layers);
  if (!compact) return null;
  return gzipEncode(JSON.stringify(compact));
}

/**
 * Builds a shareable URL containing the current map view and all features.
 * Combines the map position (#map=zoom/lat/lon) with compressed feature data (&data=...).
 * The data parameter contains all markers, polylines, and polygons encoded using
 * Polyline encoding and gzip+base64url compression.
 *
 * @param {Array} [layers] - Specific layers to include; defaults to everything
 *   on the map when omitted.
 * @returns {Promise<string|null>} Full shareable URL with hash parameters, or null if no features exist
 */
async function buildShareableUrl(layers = null) {
  const mapState = await encodeMapStateToUrl(layers);
  if (!mapState) return null;

  const center = map.getCenter();
  const zoom = map.getZoom();

  const baseUrl = window.location.origin + window.location.pathname;
  const hashParams = `#map=${zoom}/${center.lat.toFixed(6)}/${center.lng.toFixed(6)}&data=${mapState}`;

  return baseUrl + hashParams;
}

/**
 * Imports and decompresses map state from a shareable URL parameter.
 * Decodes the base64url string, decompresses with gzip, decodes Polyline-encoded
 * coordinates, converts to GeoJSON format, and adds all features to the map.
 *
 * Process:
 * 1. Decodes base64url and decompresses with gzip
 * 2. Parses the JSON structure (v=version, f=features array)
 * 3. For each feature, decodes based on type:
 *    - "m" (marker): coordinates used as-is [lng, lat] or [lng, lat, elevation]
 *    - "p" (polyline): Polyline-decoded path (precision 5), elevation applied if present
 *    - "a" (polygon/area): Polyline-decoded path (precision 5), elevation applied if present, ring closed by appending first coordinate
 * 4. Reconstructs full GeoJSON Feature objects with properties and elevation
 * 5. Adds the FeatureCollection to the map
 *
 * @param {string} encoded - base64url-encoded gzip-compressed map state
 * @returns {Promise<boolean>} True if import was successful, false if decompression/parsing failed
 */
async function importMapStateFromUrl(encoded) {
  try {
    const jsonString = await gzipDecode(encoded);
    if (!jsonString) throw new Error("Failed to decompress data");

    const data = JSON.parse(jsonString);
    if (!data.v) throw new Error("Invalid data format: missing version");
    if (data.v !== 1) throw new Error(`Unsupported data version: ${data.v}`);
    if (!data.f || !Array.isArray(data.f)) {
      throw new Error("Invalid data format");
    }

    const features = [];

    data.f.forEach((item) => {
      try {
        const feature = {
          type: "Feature",
          properties: {
            name: item.n || "",
            color: item.s || DEFAULT_COLOR,
          },
          geometry: null,
        };

        // Add stravaId if present
        if (item.sid) {
          feature.properties.stravaId = item.sid;
        }

        if (item.t === "m") {
          const coords = [...item.c];
          if (typeof item.e === "number") coords.push(item.e);
          feature.geometry = { type: "Point", coordinates: coords };
        } else if (item.t === "p") {
          const decoded = L.PolylineUtil.decode(item.c, 5);
          feature.geometry = {
            type: "LineString",
            coordinates: decoded.map(([lat, lng], idx) => {
              const coord = [lng, lat];
              if (item.e && typeof item.e[idx] === "number") coord.push(item.e[idx]);
              return coord;
            }),
          };
        } else if (item.t === "a") {
          const decoded = L.PolylineUtil.decode(item.c, 5);
          const ring = decoded.map(([lat, lng], idx) => {
            const coord = [lng, lat];
            if (item.e && typeof item.e[idx] === "number") coord.push(item.e[idx]);
            return coord;
          });
          if (ring.length > 0) ring.push([...ring[0]]);
          feature.geometry = {
            type: "Polygon",
            coordinates: [ring],
          };
        }

        if (feature.geometry) features.push(feature);
      } catch (e) {
        console.warn("Could not decode feature:", e);
      }
    });

    if (features.length === 0) throw new Error("No valid features");

    importGeoJsonToMap({ type: "FeatureCollection", features }, "geojson");
    return true;
  } catch (error) {
    console.error("Error importing map state from URL:", error);
    return false;
  }
}
