// Copyright (C) 2025 Aron Sommer. See LICENSE file for full license details.

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Ensures the Google Maps API is loaded only once. Returns a promise that resolves
 * when the API is ready, handling concurrent load requests gracefully.
 * @returns {Promise<void>} Promise that resolves when the API is loaded
 */
function ensureGoogleApiIsLoaded() {
  if (window.googleMapsApiPromise) {
    return window.googleMapsApiPromise;
  }

  window.googleMapsApiPromise = new Promise((resolve, reject) => {
    window.onGoogleMapsApiReady = () => {
      resolve();
      delete window.onGoogleMapsApiReady;
    };

    if (!googleApiKey) {
      const errorMsg = "Google API key is not configured.";
      console.error(errorMsg);
      return reject(new Error(errorMsg));
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${googleApiKey}&loading=async&libraries=elevation,maps&callback=onGoogleMapsApiReady`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Failed to load the Google Maps script."));
    document.head.appendChild(script);
  });

  return window.googleMapsApiPromise;
}

/**
 * Parses a string to determine if it represents valid geographic coordinates.
 * Inspired by the OpenStreetMap website controller implementation.
 * @see https://github.com/openstreetmap/openstreetmap-website/blob/master/app/controllers/searches_controller.rb
 *
 * Supports two main formats:
 * 1. Decimal Degrees (DD):
 * - Two numbers (integer or decimal) separated by a comma, space, or slash.
 * - Numbers can have an optional +/- prefix.
 * - Examples: "47.5, 8.5", "-34.60 -58.38", "+40.7128 / -74.0060"
 *
 * 2. Degrees, Minutes, Seconds (DMS):
 * - Can use N, S, E, W indicators at the start or end.
 * - Supports degree (°), minute (', ′), and second (", ″) symbols, but they are optional.
 * - Examples: "N 47° 28' 41.75"", "47 28 41.75 N 7 41 37.13 E"
 *
 * @param {string} inputString - The string to parse
 * @returns {L.LatLng|null} Leaflet LatLng object if valid, otherwise null
 */
function parseCoordinateString(inputString) {
  const dmsToDecimal = (captures, Hemi) => {
    const degrees = parseFloat(captures[`${Hemi}d`] || 0);
    const minutes = parseFloat(captures[`${Hemi}m`] || 0);
    const seconds = parseFloat(captures[`${Hemi}s`] || 0);
    const sign =
      captures[Hemi].toLowerCase() === "s" || captures[Hemi].toLowerCase() === "w" ? -1 : 1;
    return sign * (degrees + minutes / 60 + seconds / 3600);
  };

  const dmsSubPattern = (prefix) => {
    return (
      `(?:(?<${prefix}d>\\d{1,3}(?:\\.\\d+)?)[°]?)` +
      `|(?:(?<${prefix}d>\\d{1,3})[°]?\\s*(?<${prefix}m>\\d{1,2}(?:\\.\\d+)?)[\\'′]?)` +
      `|(?:(?<${prefix}d>\\d{1,3})[°]?\\s*(?<${prefix}m>\\d{1,2})[\\'′]?\\s*(?<${prefix}s>\\d{1,2}(?:\\.\\d+)?)[\\"″]?)`
    );
  };

  const query = inputString.trim();
  let lat, lon;
  let match = null;

  const dmsRegex1 = new RegExp(
    `^(?<ns>[NS])\\s*(${dmsSubPattern("ns")})\\W+(?<ew>[EW])\\s*(${dmsSubPattern("ew")})$`,
    "i",
  );
  match = query.match(dmsRegex1);

  if (!match) {
    const dmsRegex2 = new RegExp(
      `^(${dmsSubPattern("ns")})\\s*(?<ns>[NS])\\W+(${dmsSubPattern("ew")})\\s*(?<ew>[EW])$`,
      "i",
    );
    match = query.match(dmsRegex2);
  }

  if (match && match.groups) {
    lat = dmsToDecimal(match.groups, "ns");
    lon = dmsToDecimal(match.groups, "ew");
  } else {
    const decimalRegex = /^(?<lat>[+-]?\d+(?:\.\d+)?)(?:\s+|\s*[,/]\s*)(?<lon>[+-]?\d+(?:\.\d+)?)$/;
    match = query.match(decimalRegex);
    if (match && match.groups) {
      lat = parseFloat(match.groups.lat);
      lon = parseFloat(match.groups.lon);
    }
  }

  if (typeof lat !== "undefined" && typeof lon !== "undefined") {
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return L.latLng(lat, lon);
    }
  }

  return null;
}

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
 * Copies text to clipboard using modern Clipboard API with fallback to legacy execCommand.
 * @param {string} text - The string to copy to clipboard
 * @returns {Promise<void>} Promise that resolves on success, rejects on failure
 */
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      const successful = document.execCommand("copy");
      if (successful) {
        resolve();
      } else {
        reject(new Error("Copy command failed."));
      }
    } catch (err) {
      reject(err);
    }
    document.body.removeChild(textArea);
  });
}

/**
 * Triggers a browser download for a text-based file.
 * Uses Blob with proper MIME types to ensure correct file extensions on all platforms.
 * @param {string} filename - Desired name of the file
 * @param {string} text - Content of the file
 */
function downloadFile(filename, text) {
  // Determine MIME type based on file extension
  const extension = filename.split(".").pop().toLowerCase();
  const mimeTypes = {
    geojson: "application/geo+json",
    gpx: "application/gpx+xml",
    json: "application/json",
    kml: "application/vnd.google-earth.kml+xml",
    kmz: "application/vnd.google-earth.kmz",
  };
  const mimeType = mimeTypes[extension] || "text/plain";

  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);

  const element = document.createElement("a");
  element.href = url;
  element.download = filename;
  element.style.display = "none";
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
  URL.revokeObjectURL(url);
}

/**
 * Generates a timestamp string in YYYYMMDDHHmmss format.
 * @returns {string} Timestamp string (14 digits)
 */
function generateTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  const hours = now.getHours().toString().padStart(2, "0");
  const minutes = now.getMinutes().toString().padStart(2, "0");
  const seconds = now.getSeconds().toString().padStart(2, "0");
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

/**
 * Generates a timestamped filename.
 * @param {string} baseName - Base name for the file (e.g., "Map_Export", "Strava_Export")
 * @param {string} extension - File extension without dot (e.g., "kmz", "geojson", "kml", "json")
 * @returns {string} Filename with timestamp (e.g., "Map_Export_20251210143025.kmz")
 */
function generateTimestampedFilename(baseName, extension) {
  return `${baseName}_${generateTimestamp()}.${extension}`;
}

/**
 * Calculates the total distance of a path in meters.
 * @param {L.Polyline | L.Polygon} path - The layer to measure
 * @returns {number} Total distance in meters
 */
function calculatePathDistance(path) {
  if (!(path instanceof L.Polyline) && !(path instanceof L.Polygon)) return 0;
  let latlngs = path.getLatLngs();
  while (latlngs.length > 0 && Array.isArray(latlngs[0]) && !(latlngs[0] instanceof L.LatLng)) {
    latlngs = latlngs[0];
  }
  if (latlngs.length < 2) return 0;

  let cumulativeDistance = 0;
  for (let i = 0; i < latlngs.length - 1; i++) {
    const p1 = latlngs[i];
    const p2 = latlngs[i + 1];
    if (p1 && typeof p1.distanceTo === "function" && p2) {
      cumulativeDistance += p1.distanceTo(p2);
    }
  }

  // For polygons, add the closing segment from last point back to first
  if (path instanceof L.Polygon && latlngs.length > 0) {
    const lastPoint = latlngs[latlngs.length - 1];
    const firstPoint = latlngs[0];
    if (lastPoint && typeof lastPoint.distanceTo === "function" && firstPoint) {
      cumulativeDistance += lastPoint.distanceTo(firstPoint);
    }
  }

  return cumulativeDistance;
}

/**
 * Calculates the area of a polygon in square meters using geodesic calculations.
 * @param {L.Polygon} polygon - The polygon to measure
 * @returns {number} Area in square meters
 */
function calculatePolygonArea(polygon) {
  if (!(polygon instanceof L.Polygon)) return 0;
  let latlngs = polygon.getLatLngs()[0];
  if (!latlngs || latlngs.length < 3) return 0;

  // Use L.GeometryUtil.geodesicArea if available, otherwise use spherical approximation
  if (L.GeometryUtil && typeof L.GeometryUtil.geodesicArea === "function") {
    return L.GeometryUtil.geodesicArea(latlngs);
  }

  // Fallback: simple spherical area calculation
  const earthRadius = 6378137; // meters
  let area = 0;
  const len = latlngs.length;

  if (len > 2) {
    for (let i = 0; i < len; i++) {
      const p1 = latlngs[i];
      const p2 = latlngs[(i + 1) % len];
      area +=
        (((p2.lng - p1.lng) * Math.PI) / 180) *
        (2 + Math.sin((p1.lat * Math.PI) / 180) + Math.sin((p2.lat * Math.PI) / 180));
    }
    area = (area * earthRadius * earthRadius) / 2;
  }

  return Math.abs(area);
}

/**
 * Formats an area in square meters into a human-readable string respecting the global unit setting.
 * @param {number} sqMeters - Area in square meters
 * @param {boolean} [includeSecondary=false] - If true, includes other unit system in parentheses
 * @returns {string} Formatted area string (e.g., "41.29 km²" or "15.94 mi²")
 */
function formatArea(sqMeters, includeSecondary = false) {
  if (typeof sqMeters !== "number" || isNaN(sqMeters)) {
    return "";
  }

  const SQ_METERS_TO_SQ_KM = 0.000001;
  const SQ_METERS_TO_SQ_MILES = 0.0000003861;

  const sqKm = sqMeters * SQ_METERS_TO_SQ_KM;
  const sqMiles = sqMeters * SQ_METERS_TO_SQ_MILES;

  let primaryDisplay, secondaryDisplay;

  if (useImperialUnits) {
    primaryDisplay = sqMeters === 0 ? "0 mi²" : `${sqMiles.toFixed(2)} mi²`;
    secondaryDisplay = `${sqKm.toFixed(2)} km²`;
  } else {
    primaryDisplay = sqMeters === 0 ? "0 km²" : `${sqKm.toFixed(2)} km²`;
    secondaryDisplay = `${sqMiles.toFixed(2)} mi²`;
  }

  return includeSecondary ? `${primaryDisplay} (${secondaryDisplay})` : primaryDisplay;
}

/**
 * Resamples a path to have exactly the specified number of evenly-spaced points
 * by interpolating along the original path geometry.
 * @param {Array<L.LatLng>} latlngs - Original array of points
 * @param {number} maxPoints - Target number of points for the resampled path
 * @returns {Array<L.LatLng>} Resampled array of points
 */
function resamplePath(latlngs, maxPoints) {
  if (!latlngs || latlngs.length < 2) {
    return latlngs;
  }

  let totalDistance = 0;
  const cumulativeDistances = [0];
  for (let i = 1; i < latlngs.length; i++) {
    totalDistance += latlngs[i].distanceTo(latlngs[i - 1]);
    cumulativeDistances.push(totalDistance);
  }

  if (totalDistance === 0) {
    const firstPoint = latlngs[0];
    const newPoints = [];
    for (let i = 0; i < maxPoints; i++) {
      newPoints.push(L.latLng(firstPoint.lat, firstPoint.lng));
    }
    return newPoints;
  }

  const intervalDistance = totalDistance / (maxPoints - 1);

  const newPoints = [];
  let currentVertexIndex = 1;

  for (let i = 0; i < maxPoints; i++) {
    const targetDistance = intervalDistance * i;

    if (i === maxPoints - 1) {
      const lastOriginalPoint = latlngs[latlngs.length - 1];
      newPoints.push(L.latLng(lastOriginalPoint.lat, lastOriginalPoint.lng));
      continue;
    }

    while (
      cumulativeDistances[currentVertexIndex] < targetDistance &&
      currentVertexIndex < latlngs.length - 1
    ) {
      currentVertexIndex++;
    }

    const prevVertex = latlngs[currentVertexIndex - 1];
    const nextVertex = latlngs[currentVertexIndex];

    const distanceOfSegment =
      cumulativeDistances[currentVertexIndex] - cumulativeDistances[currentVertexIndex - 1];
    const distanceFromPrevVertex = targetDistance - cumulativeDistances[currentVertexIndex - 1];

    const fraction = distanceOfSegment === 0 ? 0 : distanceFromPrevVertex / distanceOfSegment;

    const newLat = prevVertex.lat + (nextVertex.lat - prevVertex.lat) * fraction;
    const newLng = prevVertex.lng + (nextVertex.lng - prevVertex.lng) * fraction;

    newPoints.push(L.latLng(newLat, newLng));
  }

  return newPoints;
}

/**
 * Sets up autocomplete functionality for a text input field using geocoding.
 * @param {HTMLInputElement} inputEl - Input element for autocomplete
 * @param {HTMLElement} suggestionsEl - Container element for suggestions
 * @param {function(L.LatLng, string): void} callback - Callback when location is selected
 */
async function setupAutocomplete(inputEl, suggestionsEl, callback) {
  const geocoder = new GeoSearch.OpenStreetMapProvider({
    // https://nominatim.org/release-docs/develop/api/Search/#parameters
    params: {
      // email: "your-email@example.com",
      // countrycodes: "ch",
      limit: 5,
    },
  });

  let debounceTimeout;
  let activeSuggestionIndex = -1;

  function updateActiveSuggestion() {
    const items = suggestionsEl.querySelectorAll(".autocomplete-suggestion-item");
    items.forEach((item, index) => {
      item.classList.toggle("active", index === activeSuggestionIndex);
    });
  }

  inputEl.addEventListener("input", () => {
    const query = inputEl.value.trim();

    const latLng = parseCoordinateString(query);

    if (latLng) {
      clearTimeout(debounceTimeout);
      suggestionsEl.innerHTML = "";
      suggestionsEl.style.display = "none";

      callback(latLng, `${latLng.lat.toFixed(5)}, ${latLng.lng.toFixed(5)}`);

      return;
    }

    clearTimeout(debounceTimeout);
    activeSuggestionIndex = -1; // Reset on new input
    if (query.length < 3) {
      suggestionsEl.innerHTML = "";
      suggestionsEl.style.display = "none";
      return;
    }
    debounceTimeout = setTimeout(async () => {
      const results = await geocoder.search({ query });
      suggestionsEl.innerHTML = "";
      if (results && results.length > 0) {
        suggestionsEl.style.display = "block";
        results.forEach((result) => {
          const item = document.createElement("div");
          item.className = "autocomplete-suggestion-item";
          item.textContent = result.label;
          item.addEventListener("click", (e) => {
            L.DomEvent.stop(e);
            inputEl.value = result.label;
            callback(L.latLng(result.y, result.x), result.label); // Pass latlng and label
            suggestionsEl.innerHTML = "";
            suggestionsEl.style.display = "none";
          });
          suggestionsEl.appendChild(item);
        });
      } else {
        suggestionsEl.style.display = "none";
      }
    }, 300);
  });

  inputEl.addEventListener("keydown", (e) => {
    const items = suggestionsEl.querySelectorAll(".autocomplete-suggestion-item");
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeSuggestionIndex = (activeSuggestionIndex + 1) % items.length;
      updateActiveSuggestion();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeSuggestionIndex = (activeSuggestionIndex - 1 + items.length) % items.length;
      updateActiveSuggestion();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeSuggestionIndex > -1) {
        items[activeSuggestionIndex].click();
        activeSuggestionIndex = -1;
      }
    } else if (e.key === "Escape") {
      suggestionsEl.style.display = "none";
      activeSuggestionIndex = -1;
    }
  });

  inputEl.addEventListener("blur", () => {
    setTimeout(() => {
      suggestionsEl.style.display = "none";
    }, 150);
  });
}

/**
 * Formats a distance in meters into a human-readable string respecting the global unit setting.
 * @param {number} meters - Distance in meters
 * @param {boolean} [includeSecondary=false] - If true, includes other unit system in parentheses
 * @returns {string} Formatted distance string (e.g., "10.54 km" or "6.55 mi")
 */
function formatDistance(meters, includeSecondary = false) {
  if (typeof meters !== "number" || isNaN(meters)) {
    return "";
  }

  const METERS_TO_FEET = 3.28084;
  const METERS_TO_MILES = 0.000621371;

  const km = meters / 1000;
  const miles = meters * METERS_TO_MILES;

  let primaryDisplay, secondaryDisplay;

  if (useImperialUnits) {
    if (miles < 0.1 && miles > 0) {
      primaryDisplay = `${Math.round(meters * METERS_TO_FEET)} ft`;
    } else {
      if (meters === 0) {
        primaryDisplay = "0 mi";
      } else {
        primaryDisplay = `${miles.toFixed(2)} mi`;
      }
    }
    secondaryDisplay = km < 1 ? `${Math.round(meters)} m` : `${km.toFixed(2)} km`;
  } else {
    if (km < 1) {
      primaryDisplay = `${Math.round(meters)} m`;
    } else {
      primaryDisplay = `${km.toFixed(2)} km`;
    }
    secondaryDisplay =
      miles < 0.1 ? `${Math.round(meters * METERS_TO_FEET)} ft` : `${miles.toFixed(2)} mi`;
  }

  return includeSecondary ? `${primaryDisplay} (${secondaryDisplay})` : primaryDisplay;
}

/**
 * Creates and saves a new marker to the map at the specified location.
 * This is a shared utility used by search results, POI finder, and context menu.
 * @param {number|L.LatLng} lat - Latitude or LatLng object
 * @param {number} [lon] - Longitude (optional if lat is a LatLng object)
 * @param {string} [name] - Optional name for the marker
 * @returns {L.Marker} The created marker
 */
function createAndSaveMarker(lat, lon, name) {
  // Handle both (lat, lon, name) and (latLng, name) calling conventions
  let latLng;
  let markerName;

  if (lat instanceof L.LatLng) {
    latLng = lat;
    markerName = lon; // Second parameter is name in this case
  } else {
    latLng = L.latLng(lat, lon);
    markerName = name;
  }

  const newMarker = L.marker(latLng, {
    icon: createMarkerIcon(DEFAULT_COLOR, STYLE_CONFIG.marker.default.opacity),
  });

  newMarker.pathType = "drawn";
  newMarker.feature = {
    properties: {
      color: DEFAULT_COLOR,
    },
  };

  // Add name if provided
  if (markerName) {
    newMarker.feature.properties.name = markerName;
  }

  drawnItems.addLayer(newMarker);
  editableLayers.addLayer(newMarker);

  newMarker.on("click", (ev) => {
    L.DomEvent.stopPropagation(ev);
    selectItem(newMarker);
  });

  selectItem(newMarker);
  updateDrawControlStates();
  updateOverviewList();

  return newMarker;
}
