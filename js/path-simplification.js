// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Path & area simplification.
// Reduces the number of points in a path/area geometry using the simplify.js
// library (Douglas-Peucker). Used on demand for items in the Drawn Items layer.

/**
 * Simplification settings for paths and areas.
 * Tolerance is in decimal degrees (~0.00005° ≈ 5.5m at equator).
 */
const pathSimplificationConfig = {
  TOLERANCE: 0.00015,
  MIN_POINTS: 100,
};

/**
 * Simplifies a geometry's coordinates using the simplify.js library and provided configuration.
 * @param {Array} coordinates - Array of coordinates in [lng, lat] format
 * @param {string} type - Geometry type ('LineString', 'Polygon', or 'MultiLineString')
 * @param {object} config - Configuration object with TOLERANCE and MIN_POINTS properties
 * @returns {{simplified: boolean, coords: Array}} Object with simplification flag and resulting coordinates
 */
function simplifyPath(coordinates, type, config) {
  let overallSimplified = false;
  let newCoordinates;

  const simplifySinglePath = (pathCoords) => {
    if (pathCoords.length <= config.MIN_POINTS) {
      return { simplified: false, coords: pathCoords };
    }

    // Check if coordinates have altitude data (3D coordinates)
    const hasAltitude = pathCoords.some((c) => c.length === 3 && c[2] !== undefined);

    // Add index to each point so we can track which ones are kept after simplification
    const points = pathCoords.map((c, i) => ({ x: c[0], y: c[1], idx: i }));
    const simplifiedPoints = simplify(points, config.TOLERANCE, true);

    if (simplifiedPoints.length < pathCoords.length) {
      console.log(
        `Path segment simplified: ${pathCoords.length} -> ${simplifiedPoints.length} points`,
      );

      // If original had altitude, restore it using the index
      if (hasAltitude) {
        const simplifiedWithAlt = simplifiedPoints.map((p) => {
          const originalCoord = pathCoords[p.idx];
          return originalCoord.length === 3 ? [p.x, p.y, originalCoord[2]] : [p.x, p.y];
        });
        return { simplified: true, coords: simplifiedWithAlt };
      }

      return { simplified: true, coords: simplifiedPoints.map((p) => [p.x, p.y]) };
    }

    return { simplified: false, coords: pathCoords };
  };

  if (type === "LineString" || type === "Polygon") {
    // LineString and Polygon are both single arrays of coordinates
    // Polygon is treated as a closed LineString for simplification purposes
    const result = simplifySinglePath(coordinates);
    overallSimplified = result.simplified;
    newCoordinates = result.coords;
  } else if (type === "MultiLineString") {
    newCoordinates = coordinates.map((line) => {
      const result = simplifySinglePath(line);
      if (result.simplified) {
        overallSimplified = true;
      }
      return result.coords;
    });
  } else {
    return { simplified: false, coords: coordinates };
  }

  return { simplified: overallSimplified, coords: newCoordinates };
}

/**
 * Simplifies a layer that's currently in leaflet-draw Edit mode and rebuilds its vertex
 * handles to match. Must only be called once the layer's own editing handler is active
 * (layer.editing.enable() has already run) - callers driven by EDITSTART need to defer
 * past leaflet-draw's own synchronous backup/enable sequence first, see draw-tools.js.
 * @param {L.Polygon|L.Polyline} layer - The layer currently being edited
 * @param {object} [config] - Simplification config; defaults to pathSimplificationConfig
 * @returns {boolean} Whether the geometry was actually simplified
 */
function applySimplificationToEditingLayer(layer, config = pathSimplificationConfig) {
  const isPolygon = layer instanceof L.Polygon;
  // leaflet-draw's vertex handles hold a direct reference to this exact array, captured
  // once when editing.enable() first ran and never resynced except on Cancel - mutate it
  // in place (mirroring leaflet-draw's own _spliceLatLngs) rather than calling
  // layer.setLatLngs(), which would replace the array and desync the handles from the
  // layer's actual geometry, both this session and every future edit session on it.
  const ring = isPolygon ? layer.getLatLngs()[0] : layer.getLatLngs();
  const coords = ring.map((latlng) =>
    latlng.alt !== undefined ? [latlng.lng, latlng.lat, latlng.alt] : [latlng.lng, latlng.lat],
  );

  const result = simplifyPath(coords, isPolygon ? "Polygon" : "LineString", config);
  if (!result.simplified) return false;

  ring.length = 0;
  for (const c of result.coords) {
    ring.push(c.length === 3 ? L.latLng(c[1], c[0], c[2]) : L.latLng(c[1], c[0]));
  }
  layer._bounds = L.latLngBounds(ring);
  layer.redraw();
  layer.editing.updateMarkers();
  // leaflet-draw's own Save handler only includes layers with this flag (normally set by
  // its vertex-drag handlers) in the draw:edited event - without it, a save with no manual
  // vertex edits would skip draw-tools.js's draw:edited handler and leave totalDistance stale.
  layer.edited = true;
  return true;
}
