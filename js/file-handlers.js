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
 * clockwise, using the shoelace formula. Longitudes are unwrapped as the
 * ring is walked - a >180 degree jump between consecutive vertices is
 * treated as an antimeridian crossing rather than an actual half-world
 * step - so the result stays correct for rings that cross +/-180 degrees.
 * @param {Array} ring - Closed ring coordinates (first and last equal)
 * @returns {boolean} True if the ring winds clockwise
 */
function isRingClockwise(ring) {
  let sum = 0;
  let x1 = ring[0][0];
  for (let i = 0; i < ring.length - 1; i++) {
    const y1 = ring[i][1];
    const y2 = ring[i + 1][1];
    let x2 = ring[i + 1][0];
    if (x2 - x1 > 180) x2 -= 360;
    else if (x2 - x1 < -180) x2 += 360;
    sum += (x2 - x1) * (y2 + y1);
    x1 = x2;
  }
  return sum > 0;
}

/**
 * Converts a layer into the portable GeoJSON feature that represents it everywhere its data
 * leaves the map: the GeoJSON Editor tab, a GeoJSON export, and autosave (which adds its
 * internal state in a sibling key afterwards). Exactly type/properties/geometry - an imported
 * layer's feature can carry extra top-level keys from its source file, and layer.internal is
 * deliberately not part of layer.feature at all. See the LAYER DATA MODEL note in config.js.
 * Builds the geometry straight from the layer's latlngs at full precision - layer.toGeoJSON()
 * would round every coordinate to 6 decimal places and materialize the whole array a second time.
 * @param {L.Layer} layer - The layer to convert
 * @returns {object|null} A GeoJSON Feature, or null if the layer has no usable geometry
 */
function layerToPortableFeature(layer) {
  const toCoord = (ll) => {
    const coord = [ll.lng, ll.lat];
    if (typeof ll.alt === "number") coord.push(ll.alt);
    return coord;
  };

  let geometry;
  if (layer instanceof L.Marker) {
    geometry = { type: "Point", coordinates: toCoord(layer.getLatLng()) };
  } else if (layer instanceof L.Polygon) {
    const coords = layer.getLatLngs()[0].map(toCoord);
    coords.push(coords[0]); // Close the polygon
    // RFC 7946 section 3.1.6: exterior rings MUST wind counterclockwise.
    if (isRingClockwise(coords)) coords.reverse();
    geometry = { type: "Polygon", coordinates: [coords] };
  } else if (layer instanceof L.Polyline) {
    geometry = {
      type: "LineString",
      coordinates: flattenRingPoints(layer.getLatLngs()).map(toCoord),
    };
  } else {
    return null; // No usable geometry (e.g. an L.FeatureGroup from a pasted GeometryCollection)
  }

  // Shallow property copy - callers can add or drop top-level properties without touching the
  // live layer; nested values stay shared.
  return { type: "Feature", properties: { ...layer.feature?.properties }, geometry };
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
 * Default filename prefix for an export: the single named item itself,
 * or a generic "Selected"/"Map" prefix for anything else (bulk exports,
 * which also get a timestamp appended by the caller).
 * @param {string|null} singleNamedItem - Result of getSingleNamedItem()
 * @param {boolean} hasSelection - Whether the export is scoped to a selection
 * @returns {string} The resolved filename prefix
 */
function resolveExportFilePrefix(singleNamedItem, hasSelection) {
  return singleNamedItem || (hasSelection ? "Selected_Export" : "Map_Export");
}

/**
 * Supported geometry types for import.
 * Multi-geometry types (MultiLineString, MultiPolygon, etc.), GeometryCollections, and
 * polygons with holes are automatically exploded into separate simple features for
 * editing compatibility.
 */
const SUPPORTED_IMPORT_GEOM_TYPES = ["Point", "LineString", "Polygon"];

/**
 * True when coordinates nest down to [lng, lat(, alt)] positions with finite numbers.
 * Leaflet's LatLng constructor throws on non-numeric values, which would abort an
 * entire import over one bad feature - such features are dropped instead.
 */
function hasFiniteCoords(coords) {
  if (!Array.isArray(coords)) return false;
  return Array.isArray(coords[0])
    ? coords.every(hasFiniteCoords)
    : coords.length >= 2 && Number.isFinite(coords[0]) && Number.isFinite(coords[1]);
}

/**
 * Explodes multi-geometries and GeometryCollections into separate features.
 * Converts MultiLineString, MultiPolygon, MultiPoint, and GeometryCollection
 * into arrays of simple features that can be edited individually; a Polygon
 * with holes is split into one area per ring. Malformed features (non-finite
 * or missing coordinates) are dropped so one bad record can't abort an import.
 * @param {object} feature - GeoJSON feature that may contain multi-geometry
 * @returns {Array} Array of features with simple single-ring geometries only
 */
function explodeMultiGeometries(feature) {
  if (!feature?.geometry || typeof feature.geometry.type !== "string") return [];

  const geomType = feature.geometry.type;

  // Map geometry types to user-friendly names for labels
  const labelMap = {
    LineString: "Path",
    Polygon: "Area",
    Point: "Marker",
  };

  // Handle GeometryCollection (from KML MultiGeometry)
  if (geomType === "GeometryCollection") {
    if (!Array.isArray(feature.geometry.geometries)) return [];
    // Count occurrences of each geometry type to handle duplicates
    const typeCounts = {};
    return feature.geometry.geometries.flatMap((geom) => {
      const type = geom.type;
      typeCounts[type] = (typeCounts[type] || 0) + 1;
      const suffix = typeCounts[type] > 1 ? ` ${typeCounts[type]}` : "";
      const typeLabel = labelMap[type] || type;

      // Recurse so a nested Multi*/GeometryCollection member is exploded too instead of
      // passing through as one un-editable multi-geometry; simple members return as-is.
      return explodeMultiGeometries({
        type: "Feature",
        geometry: geom,
        properties: {
          ...feature.properties,
          name: feature.properties?.name
            ? `${feature.properties.name} (${typeLabel}${suffix})`
            : undefined,
        },
      });
    });
  }

  // Every remaining branch reads coordinates; a feature without an array there is malformed.
  if (!Array.isArray(feature.geometry.coordinates)) return [];

  // Handle Multi-geometries (MultiLineString, MultiPolygon, MultiPoint)
  if (geomType.startsWith("Multi")) {
    const singleType = geomType.replace("Multi", ""); // MultiLineString -> LineString
    const count = feature.geometry.coordinates.length;
    return feature.geometry.coordinates.flatMap((coords, index) => {
      const suffix = count > 1 && index > 0 ? ` ${index + 1}` : "";
      const typeLabel = labelMap[singleType] || singleType;

      // Recurse so a MultiPolygon part with holes is split like any standalone polygon.
      return explodeMultiGeometries({
        type: "Feature",
        geometry: { type: singleType, coordinates: coords },
        properties: {
          ...feature.properties,
          name: feature.properties?.name
            ? `${feature.properties.name} (${typeLabel}${suffix})`
            : undefined,
        },
      });
    });
  }

  // A polygon's rings beyond the first are holes (RFC 7946). The app has no hole support,
  // so each ring becomes its own area - keeping the geometry at the cost of the "excluded
  // region" meaning, which is invisible here anyway: areas render without fill.
  if (geomType === "Polygon" && feature.geometry.coordinates.length > 1) {
    // Recurse so each single-ring polygon passes the coordinate validation below.
    return feature.geometry.coordinates.flatMap((ring, index) =>
      explodeMultiGeometries({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          ...feature.properties,
          name: feature.properties?.name
            ? `${feature.properties.name} (${labelMap.Polygon}${index > 0 ? ` ${index + 1}` : ""})`
            : undefined,
        },
      }),
    );
  }

  // Simple geometry - return as-is if supported and its coordinates can't crash Leaflet
  if (SUPPORTED_IMPORT_GEOM_TYPES.includes(geomType)) {
    return hasFiniteCoords(feature.geometry.coordinates) ? [feature] : [];
  }

  return []; // Unsupported type
}

// 2. IMPORT (FILE-BASED)
// --------------------------------------------------------------------

// Color parsing helpers (used by importGeoJsonToMap)

/**
 * Parses color from standard GeoJSON stroke/marker-color properties.
 * Prefers the simplestyle key matching the geometry ("marker-color" for points,
 * "stroke" for everything else); the other key is kept as a fallback so a color
 * stored under the wrong key still survives. Supports hex values and CSS color names.
 * @param {object} properties - The GeoJSON feature properties
 * @param {boolean} isPoint - Whether the feature's geometry is a Point
 * @returns {string|null} Normalized hex color or null
 */
function parseColorFromGeoJsonStyle(properties, isPoint) {
  const raw = isPoint
    ? properties?.["marker-color"] || properties?.stroke
    : properties?.stroke || properties?.["marker-color"];
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
 * Style properties stripped from every imported feature.
 *
 * The app renders everything with its own STYLE_CONFIG (line weight, opacity, and no fill for
 * areas) and owns a single color, stored under stroke/marker-color by setLayerColor(). Keeping a
 * source's own style keys would mean exporting styling the app never applied - and would leave
 * `fill`/`fill-color` behind as a second, stale color as soon as the user recolors the item.
 *
 * "color" is the non-standard key resolveColor() reads (set by applyGpxProperties(),
 * applyKmlIconColors(), share-link decoding, or the source file itself); it goes once resolved,
 * so it can't linger next to the simplestyle key that now holds the same color.
 *
 * styleHash/styleMapHash are bookkeeping toGeoJSON derives from shared KML styles (a hash of
 * the referenced style's XML; a StyleMap's key/styleUrl pairs) - meaningless without the KML
 * document they index into. styleUrl and icon stay - they are real KML content, and
 * parseColorFromKmlStyle() reads them for Organic Maps colors.
 */
const DISCARDED_STYLE_PROPERTIES = [
  "color",
  "stroke-width",
  "stroke-opacity",
  "fill",
  "fill-color",
  "fill-opacity",
  "styleHash",
  "styleMapHash",
];

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
  const resolveColor = (feature) => {
    const properties = feature.properties;
    if (!properties) return DEFAULT_COLOR;
    return (
      parseColor(properties.color) || // Normalize color if present
      (isKmlBased
        ? parseColorFromKmlStyle(properties) // KML/KMZ parsing
        : parseColorFromGeoJsonStyle(properties, feature.geometry?.type === "Point")) || // GeoJSON stroke/marker-color
      DEFAULT_COLOR
    );
  };

  const layerGroup = L.geoJSON(geoJsonData, {
    style: (feature) => {
      const color = resolveColor(feature);
      return { ...STYLE_CONFIG.path.default, color: color };
    },
    onEachFeature: (feature, layer) => {
      const color = resolveColor(feature);

      // Store the resolved color under its simplestyle-spec key, then drop the style
      // properties the app renders on its own terms (see DISCARDED_STYLE_PROPERTIES).
      setLayerColor(layer, color);
      DISCARDED_STYLE_PROPERTIES.forEach((key) => delete layer.feature.properties[key]);

      // Default a missing/empty name so it's never treated as blank downstream
      // (display, export).
      if (!layer.feature.properties.name) {
        layer.feature.properties.name = getDefaultLayerName(layer);
      }

      // All imported items use fileType as pathType - a file's own pathType is never trusted.
      layer.internal = { pathType: fileType };

      layer.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        selectItem(layer);
      });
    },
    pointToLayer: (feature, latlng) => {
      const color = resolveColor(feature);

      const marker = L.marker(wrapLatLngIfNeeded(latlng), {
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
          text: "The GeoJSON file contains no Point, LineString, or Polygon features with valid coordinates.",
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
 * Attaches colors and Strava IDs from the GPX DOM to GeoJSON features.
 * Must be called BEFORE explosion so all exploded segments inherit them.
 *
 * toGeoJSON emits features in DOM order (tracks, routes, waypoints) but skips
 * tracks without a >=2-point segment and routes with <2 points, so the DOM
 * lists are filtered to the nodes that actually produce a feature before the
 * positional walk - otherwise one dropped track shifts every later match.
 * @param {Document} dom - The parsed GPX XML document
 * @param {object} geojsonData - The GeoJSON data from toGeoJSON.gpx()
 */
function applyGpxProperties(dom, geojsonData) {
  const tracks = [...dom.querySelectorAll("trk")].filter((trk) =>
    [...trk.querySelectorAll("trkseg")].some((seg) => seg.querySelectorAll("trkpt").length >= 2),
  );
  const routes = [...dom.querySelectorAll("rte")].filter(
    (rte) => rte.querySelectorAll("rtept").length >= 2,
  );
  const lineNodes = [...tracks, ...routes];
  const pointNodes = [...dom.querySelectorAll("wpt")];
  let lineIndex = 0;
  let pointIndex = 0;

  geojsonData.features.forEach((feature) => {
    const type = feature.geometry?.type;
    const node =
      type === "LineString" || type === "MultiLineString"
        ? lineNodes[lineIndex++]
        : type === "Point"
          ? pointNodes[pointIndex++]
          : null;
    if (!node) return;

    const color = parseColor(node.querySelector("gpx_style\\:color, color")?.textContent);
    const stravaId = node.querySelector("stravaId")?.textContent.trim();
    if (color || stravaId) {
      feature.properties = feature.properties || {};
      if (color) feature.properties.color = color;
      if (stravaId) feature.properties.stravaId = stravaId;
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

      // toGeoJSON maps GPX's <desc> to a `desc` property, while KML imports and both the
      // GPX and KML exporters use `description`. Normalized here so one key means one thing
      // everywhere - otherwise a GPX description survives the import but no export writes it.
      geojsonData.features.forEach(({ properties }) => {
        if (properties?.desc) {
          properties.description = properties.desc;
          delete properties.desc;
        }
      });

      // Extract colors and Strava IDs from GPX DOM and attach to features BEFORE explosion
      applyGpxProperties(dom, geojsonData);

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

// GeoJSON
// Specification: https://tools.ietf.org/html/rfc7946

/**
 * Exports map items to a GeoJSON file with color preservation.
 * @param {Object} options - Export options
 * @param {string} options.mode - Export mode: "all" (default), "selection", or "strava"
 */
function exportGeoJson({ mode = "all", layers = null } = {}) {
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

  // Convert each layer to GeoJSON. Nothing to filter or add: layerToPortableFeature() already
  // yields exactly the portable content (including stroke/marker-color), so this writes the
  // same features the GeoJSON Editor tab shows.
  allLayers.forEach((layer) => {
    try {
      const feature = layerToPortableFeature(layer);
      if (!feature) {
        console.warn("Skipping layer with invalid geometry:", layer);
        return;
      }
      features.push(feature);
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

  const filePrefix =
    mode === "strava"
      ? "Strava_Export"
      : resolveExportFilePrefix(singleNamedItem, mode === "selection");

  const fileName = singleNamedItem
    ? `${filePrefix}.geojson`
    : generateTimestampedFilename(filePrefix, "geojson");

  // Download file
  downloadFile(fileName, JSON.stringify(geojsonDoc, null, 2));

  notifyExportSuccess(
    mode === "all" || (mode === "selection" && allLayers.length > 1),
    "Export Successful!",
    mode === "all"
      ? "All items have been exported to GeoJSON."
      : `${allLayers.length} selected items have been exported to GeoJSON.`,
  );
}

// GPX
// Specification: https://www.topografix.com/gpx/1/1/

const GPX_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${APP_NAME}" xmlns="http://www.topografix.com/GPX/1/1"
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
  const color = getLayerColor(layer);
  // Remove # prefix for GPX format
  const gpxColorHex = color.substring(1).toUpperCase();
  const stravaId = layer.feature?.properties?.stravaId;

  const safeName = escapeXml(name);
  const safeDescription = escapeXml(description);

  if (layer instanceof L.Polyline) {
    // L.Polygon extends L.Polyline, so areas land here too - they only differ in closing the ring.
    let latlngs;
    if (layer instanceof L.Polygon) {
      const ring = layer.getLatLngs()[0];
      latlngs = [...ring, ring[0]];
    } else {
      latlngs = flattenRingPoints(layer.getLatLngs());
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

    // GPX 1.1's trkType is an ordered sequence: name, then desc, then extensions.
    return `
  <trk>
    <name>${safeName}</name>${safeDescription ? `\n    <desc>${safeDescription}</desc>` : ""}
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
  const filePrefix = resolveExportFilePrefix(singleNamedItem, !!layers);
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

  const color = getLayerColor(layer);
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

  if (layer instanceof L.Polyline) {
    // L.Polygon extends L.Polyline, so areas land here too - they only differ in closing the ring.
    let latlngs;
    if (layer instanceof L.Polygon) {
      const ring = layer.getLatLngs()[0];
      latlngs = [...ring, ring[0]];
    } else {
      latlngs = flattenRingPoints(layer.getLatLngs());
    }
    const coords = latlngs
      .map((p) => `${p.lng},${p.lat},${typeof p.alt === "number" ? p.alt : 0}`)
      .join(" ");

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
  // Reuses ui-handlers.js's getGroupTitle() so a snippet always lands in the same
  // folder its layer would be grouped under in the overview list.
  const featuresByGroup = {
    DrawnItems: drawnFeatures,
    ImportedFiles: importedFeatures,
    StravaActivities: stravaActivities,
  };

  allLayers.forEach(function (layer) {
    const defaultName =
      layer instanceof L.Marker ? `Marker_${++featureCounter}` : `Path_${++featureCounter}`;
    const kmlSnippet = convertLayerToKmlPlacemark(layer, defaultName);
    if (!kmlSnippet) return;

    const groupKey = getGroupTitle(layer.internal?.pathType);
    featuresByGroup[groupKey].push(kmlSnippet);
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
  const filePrefix = resolveExportFilePrefix(singleNamedItem, !!layers);
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

  downloadFile(fileName, kmlContent);

  notifyExportSuccess(
    !layers || layers.length > 1,
    "Export Successful!",
    layers
      ? `${layers.length} selected items have been exported to KML.`
      : "All items have been exported to KML.",
  );
}
