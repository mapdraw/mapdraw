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
