// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

const elevationCache = new Map();

/**
 * Builds the elevation cache key for a set of path coordinates.
 * @param {L.LatLng[]} latlngs - Path coordinates
 * @returns {string} Cache key
 */
function elevationCacheKey(latlngs) {
  return JSON.stringify(latlngs.map((p) => [p.lat.toFixed(6), p.lng.toFixed(6)]));
}

// Define our coordinate system names
const WGS84 = "EPSG:4326"; // Standard Lat/Lng
const LV95 = "EPSG:2056"; // Swiss Grid

// Teach proj4js what LV95 is (official definition from https://epsg.io/2056.proj4)
if (typeof proj4 !== "undefined") {
  proj4.defs(
    LV95,
    "+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs +type=crs",
  );
} else {
  console.error("proj4js is not loaded. Coordinate conversion will fail.");
}

/**
 * Clears the elevation data cache and the current elevation profile display.
 */
function clearElevationCache() {
  elevationCache.clear();
  window.elevationProfile.clearElevationProfile();
  // Also, hide the elevation div if it's visible
  const elevationDiv = document.getElementById("elevation-div");
  if (elevationDiv) {
    elevationDiv.style.visibility = "hidden";
    isElevationProfileVisible = false;
  }
  updateElevationToggleIconColor();
}

/**
 * Converts an array of points between coordinate systems LOCALLY using proj4js.
 * This is a synchronous and very fast operation.
 *
 * @param {L.LatLng[]} latlngs - An array of Leaflet LatLng objects. (p.lng/p.lat)
 * @param {string} inSr - The input EPSG code (e.g., '4326' or '2056').
 * @param {string} outSr - The output EPSG code (e.g., '2056' or '4326').
 * @returns {Array<[number, number]>} An array of [lng, lat] or [easting, northing] coordinates.
 */
function convertPath(latlngs, inSr, outSr) {
  if (typeof proj4 === "undefined") {
    throw new Error("proj4js is not loaded. Cannot convert coordinates.");
  }

  let fromProj, toProj;
  if (inSr === "4326" && outSr === "2056") {
    fromProj = WGS84;
    toProj = LV95;
  } else if (inSr === "2056" && outSr === "4326") {
    fromProj = LV95;
    toProj = WGS84;
  } else {
    throw new Error(`Unsupported conversion: ${inSr} to ${outSr}`);
  }

  const transformer = proj4(fromProj, toProj);

  // The direction is fully encoded in the transformer. For LV95 input,
  // the caller stores easting in p.lng and northing in p.lat.
  return latlngs.map((p) => {
    const coords = transformer.forward([p.lng, p.lat]);
    return [coords[0], coords[1]];
  });
}

// Spacing of the points sent to elevation APIs. Sampling a dense GPS track at every
// point reads the terrain beside the path wherever GPS drifts, inflating ascent,
// descent and hiking time. map.geo.admin.ch sends every point; passing the unsampled
// latlngs to fetchElevationForPathGeoAdminAPI reproduces its numbers.
const ELEVATION_SAMPLE_SPACING = 25; // meters
const MIN_ELEVATION_SAMPLES = 200; // Short paths get about this many points
const MAX_ELEVATION_SAMPLES = 5000; // Caps API cost and request size

/**
 * Returns the path with points inserted so that no segment is longer than spacing.
 * Original points are kept; inserted ones get an interpolated elevation where possible.
 * @param {L.LatLng[]} latlngs - Path coordinates
 * @param {number} spacing - Maximum segment length in meters
 * @returns {L.LatLng[]} Densified coordinates
 */
function densifyPath(latlngs, spacing) {
  const out = [latlngs[0]];
  for (let i = 1; i < latlngs.length; i++) {
    const a = latlngs[i - 1];
    const b = latlngs[i];
    const parts = Math.ceil(a.distanceTo(b) / spacing);
    for (let j = 1; j < parts; j++) {
      out.push(interpolateLatLng(a, b, j / parts));
    }
    out.push(b);
  }
  return out;
}

/**
 * Prepares a path for the elevation profile, whether its heights come from the
 * file or an API. A path denser than the sample spacing (a GPS recording) is
 * resampled to evenly spaced points, which drops the jittery vertices. A sparser
 * path (drawn or routed) keeps its vertices, since they sit on the terrain
 * features, and only gets long segments filled in.
 * @param {L.LatLng[]} latlngs - Path coordinates
 * @returns {L.LatLng[]} Profile coordinates
 */
function samplePathForElevation(latlngs) {
  if (latlngs.length < 2) return latlngs;
  let length = 0;
  for (let i = 1; i < latlngs.length; i++) length += latlngs[i - 1].distanceTo(latlngs[i]);
  const wanted = Math.ceil(length / ELEVATION_SAMPLE_SPACING) + 1;
  if (latlngs.length > wanted) {
    return resamplePath(latlngs, Math.min(wanted, MAX_ELEVATION_SAMPLES));
  }
  const room = MAX_ELEVATION_SAMPLES - latlngs.length;
  if (room <= 0) return latlngs;
  const spacing = Math.max(
    Math.min(ELEVATION_SAMPLE_SPACING, length / (MIN_ELEVATION_SAMPLES - 1)),
    length / room,
  );
  return densifyPath(latlngs, spacing);
}

/**
 * Fetches elevation data from Google Maps Elevation API.
 * @param {L.LatLng[]} latlngs - Path coordinates
 * @returns {Promise<L.LatLng[]|null>} Array of coordinates with elevation or null on error
 */
async function fetchElevationForPathGoogle(latlngs) {
  console.log("Fetching elevation data from: Google");
  if (!latlngs || latlngs.length < 2) return latlngs;

  try {
    // We just ask our central manager to make sure the API is ready.
    await ensureGoogleApiIsLoaded();
  } catch (error) {
    Swal.fire({
      title: "API Error",
      text: error.message,
    });
    return null;
  }

  const elevator = new google.maps.ElevationService();
  const BATCH_SIZE = 512;
  let allResults = [];

  for (let i = 0; i < latlngs.length; i += BATCH_SIZE) {
    const batch = latlngs.slice(i, i + BATCH_SIZE);
    try {
      const response = await elevator.getElevationForLocations({ locations: batch });
      if (response && response.results) {
        // Use the coordinate we actually queried, not result.location - Google's Elevation
        // API snaps/interpolates to its own DEM sample grid and can return a location that
        // drifts off the real path geometry, which showed up as a zig-zag in the elevation
        // profile's hover marker. We only need result.elevation; the position is already known.
        const batchResults = response.results.map((result, j) =>
          L.latLng(batch[j].lat, batch[j].lng, result.elevation),
        );
        allResults = allResults.concat(batchResults);
      } else {
        throw new Error("API returned no results or an invalid format.");
      }
    } catch (error) {
      console.error("Error fetching elevation data from Google:", error);
      Swal.fire({
        title: "Google Elevation Error",
        text: `Failed to fetch elevation data: ${error}`,
      });
      return null;
    }
  }
  return allResults;
}

/**
 * How many coordinates we will let a chunk have before splitting it into multiple requests/chunks
 * for the GeoAdmin API. The GeoAdmin backend has a hard limit at 5k, we take a conservative
 * approach with 3k.
 */
const MAX_GEOADMIN_REQUEST_POINT_LENGTH = 3000;

/**
 * Official LV95 (EPSG:2056) coordinate system bounds for Switzerland.
 * Source: https://epsg.io/2056
 */
const LV95_BOUNDS = {
  minEasting: 2485071.58,
  maxEasting: 2833849.15,
  minNorthing: 1074261.72,
  maxNorthing: 1299941.79,
};

const GEOADMIN_COVERAGE_ERROR =
  "GeoAdmin does not cover this entire track. Only tracks fully inside its coverage (Switzerland and nearby) are supported — use Google instead.";

/**
 * Total length in meters of a planar [easting, northing] coordinate array.
 * @param {Array<[number, number]>} coords
 * @returns {number}
 */
function planarLength(coords) {
  let length = 0;
  for (let i = 1; i < coords.length; i++) {
    length += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
  }
  return length;
}

/**
 * Checks if all LV95 coordinates are outside Switzerland bounds.
 * @param {Array<[number, number]>} lv95Coords - Array of [easting, northing] coordinates
 * @returns {boolean} True if ALL coordinates are outside bounds (path completely outside Switzerland)
 */
function areAllCoordinatesOutsideSwitzerlandBounds(lv95Coords) {
  return lv95Coords.every(
    ([easting, northing]) =>
      easting < LV95_BOUNDS.minEasting ||
      easting > LV95_BOUNDS.maxEasting ||
      northing < LV95_BOUNDS.minNorthing ||
      northing > LV95_BOUNDS.maxNorthing,
  );
}

/**
 * Fetches elevation data from the official GeoAdmin API, chunking requests like map.geo.admin.ch does.
 *
 * @see https://api3.geo.admin.ch/services/sdiservices.html#profile
 */
async function fetchElevationForPathGeoAdminAPI(latlngs) {
  console.log("Fetching elevation data from: GeoAdmin (geo.admin.ch)");

  try {
    // Step 1: Convert our WGS 84 path to LV95
    const lv95Coordinates = convertPath(latlngs, "4326", "2056");

    // Step 1.5: Reject paths completely outside Switzerland bounds without any API requests
    if (areAllCoordinatesOutsideSwitzerlandBounds(lv95Coordinates)) {
      throw new Error(GEOADMIN_COVERAGE_ERROR);
    }

    // Step 2: Split coordinates into chunks if needed (to handle 5000 point limit)
    const coordinateChunks = [];
    if (lv95Coordinates.length <= MAX_GEOADMIN_REQUEST_POINT_LENGTH) {
      coordinateChunks.push(lv95Coordinates);
    } else {
      console.log(
        `Path has ${lv95Coordinates.length} points. Splitting into chunks of ${MAX_GEOADMIN_REQUEST_POINT_LENGTH} points.`,
      );
      for (let i = 0; i < lv95Coordinates.length; i += MAX_GEOADMIN_REQUEST_POINT_LENGTH) {
        coordinateChunks.push(lv95Coordinates.slice(i, i + MAX_GEOADMIN_REQUEST_POINT_LENGTH));
      }
      // A 1-point chunk is not a valid LineString; merge it into the previous chunk
      if (coordinateChunks[coordinateChunks.length - 1].length === 1) {
        coordinateChunks[coordinateChunks.length - 2].push(...coordinateChunks.pop());
      }
    }

    // Step 3: Make API requests for each chunk
    const profileApiUrl = "https://api3.geo.admin.ch/rest/services/profile.json";
    const allRequests = coordinateChunks.map((chunk) => {
      const lv95GeoJson = JSON.stringify({
        type: "LineString",
        coordinates: chunk, // [[easting, northing], ...]
      });

      const profileParams = new URLSearchParams();
      profileParams.append("geom", lv95GeoJson);
      profileParams.append("sr", "2056"); // We are providing LV95 coordinates

      return fetch(profileApiUrl, {
        method: "POST",
        body: profileParams,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
    });

    const allResponses = await Promise.all(allRequests);

    // Step 4: Process responses and collect their points, chunk order preserved
    const swissProfilePoints = [];

    for (const [chunkIndex, profileResponse] of allResponses.entries()) {
      if (!profileResponse.ok) {
        throw new Error(
          `Profile API failed (${profileResponse.status}): ${await profileResponse.text()}`,
        );
      }

      const chunkPoints = (await profileResponse.json()) ?? [];

      // Only fully covered tracks are supported. The API silently omits points
      // outside its coverage and measures dist along the requested line, so any
      // large gap between chunk start (0) and end (planar length) is uncovered.
      const chunkLength = planarLength(coordinateChunks[chunkIndex]);
      const dists = [0, ...chunkPoints.map((p) => p.dist), chunkLength];
      for (let i = 1; i < dists.length; i++) {
        if (dists[i] - dists[i - 1] > 0.02 * chunkLength) {
          throw new Error(GEOADMIN_COVERAGE_ERROR);
        }
      }

      for (const point of chunkPoints) {
        swissProfilePoints.push(point);
      }
    }

    // Filter out any points without valid, finite numeric coordinates
    const validSwissPoints = swissProfilePoints.filter(
      (p) => isFinite(p.easting) && isFinite(p.northing),
    );

    if (validSwissPoints.length === 0) {
      throw new Error(GEOADMIN_COVERAGE_ERROR);
    }

    // Step 5: Convert the points back to WGS 84 for map display
    // NOTE: We store LV95 easting in lng, northing in lat
    const profileLv95LatLngs = validSwissPoints.map((p) => L.latLng(p.northing, p.easting));

    const profileWgs84Coords = convertPath(profileLv95LatLngs, "2056", "4326");

    // Step 6: Merge the data into L.LatLng objects with altitude
    return validSwissPoints.map((swissPoint, i) => {
      const [lng, lat] = profileWgs84Coords[i];
      // Get altitude, default to 0 if 'COMB' (combined) model isn't present
      const altitude = swissPoint.alts && isFinite(swissPoint.alts.COMB) ? swissPoint.alts.COMB : 0;
      return L.latLng(lat, lng, altitude);
    });
  } catch (error) {
    console.error("Error fetching elevation from GeoAdmin API:", error);
    Swal.fire({
      title: "GeoAdmin Elevation Error",
      text: `Failed to fetch elevation data: ${error.message}`,
    });
    return null;
  }
}

/**
 * Main dispatcher function for fetching elevation data.
 * Routes to either Google or GeoAdmin API based on user preference.
 * @param {L.LatLng[]} latlngs - Path coordinates
 * @returns {Promise<L.LatLng[]|null>} Array of coordinates with elevation or null on error
 */
async function fetchElevationForPath(latlngs) {
  const cacheKey = elevationCacheKey(latlngs);

  if (elevationCache.has(cacheKey)) {
    console.log("Returning cached elevation data.");
    return elevationCache.get(cacheKey);
  }

  // Get the selected elevation provider from localStorage (default to "google")
  const elevationProvider = localStorage.getItem("elevationProvider") || "google";

  const samples = samplePathForElevation(latlngs);
  let pointsWithElev;
  if (elevationProvider === "geoadmin") {
    pointsWithElev = await fetchElevationForPathGeoAdminAPI(samples);
  } else {
    pointsWithElev = await fetchElevationForPathGoogle(samples);
  }

  if (pointsWithElev) {
    // Cap the cache: evict the oldest entry (Map iterates in insertion order).
    if (elevationCache.size >= 32) {
      elevationCache.delete(elevationCache.keys().next().value);
    }
    elevationCache.set(cacheKey, pointsWithElev);
  }

  return pointsWithElev;
}

function hasElevation(latlng) {
  return typeof latlng.alt === "number" && isFinite(latlng.alt);
}

/**
 * Checks if a path already has elevation data.
 * @param {L.LatLng[]} latlngs - Path coordinates
 * @returns {boolean} True if at least 80% of points have elevation data with meaningful variance
 */
function hasExistingElevationData(latlngs) {
  if (!latlngs || latlngs.length === 0) return false;

  const elevationValues = latlngs.filter(hasElevation).map((p) => p.alt);

  // Require at least 80% of points to have elevation data
  // This allows for some missing values while ensuring sufficient coverage
  const threshold = latlngs.length * 0.8;
  if (elevationValues.length < threshold) return false;

  // Check if all elevation values are 0 or very close to 0
  // Many KML/GPX files use 0 as a placeholder when elevation is unknown
  // We use a small epsilon to account for floating point precision
  const allZero = elevationValues.every((val) => Math.abs(val) < 0.01);
  if (allZero) return false;

  return true;
}

/**
 * Returns a copy of the path in which every point without an elevation gets one
 * interpolated along the path distance between its nearest neighbours that have
 * one, or the nearest known elevation at either end. The layer's points are untouched.
 * @param {L.LatLng[]} latlngs - Path coordinates, at least one with an elevation
 * @returns {L.LatLng[]} Copied coordinates, all with an elevation
 */
function fillMissingElevations(latlngs) {
  const filled = latlngs.map((p) => L.latLng(p.lat, p.lng, p.alt));
  const dist = [0];
  for (let i = 1; i < filled.length; i++) {
    dist.push(dist[i - 1] + filled[i - 1].distanceTo(filled[i]));
  }
  const setAlt = (from, to, altAt) => {
    for (let i = from; i < to; i++) filled[i].alt = altAt(i);
  };

  let prev = -1; // index of the last point that has an elevation
  filled.forEach((p, i) => {
    if (!hasElevation(p)) return;
    if (prev === -1) {
      setAlt(0, i, () => p.alt);
    } else {
      const prevAlt = filled[prev].alt;
      const span = dist[i] - dist[prev];
      setAlt(prev + 1, i, (j) =>
        span > 0 ? prevAlt + ((dist[j] - dist[prev]) / span) * (p.alt - prevAlt) : prevAlt,
      );
    }
    prev = i;
  });
  if (prev !== -1) setAlt(prev + 1, filled.length, () => filled[prev].alt);
  return filled;
}

// Monotonic id of the latest addElevationProfileForLayer() call that owns the profile
let elevationProfileRequestId = 0;

/**
 * Adds elevation profile for a selected layer.
 * @param {L.Layer} layer - The layer to create an elevation profile for
 */
async function addElevationProfileForLayer(layer) {
  if (!layer || layer instanceof L.Polygon || !isElevationProfileVisible) return;

  if (!(layer instanceof L.Polyline)) return;

  const latlngs = layer.getLatLngs();
  if (latlngs?.length > 0) {
    const requestId = ++elevationProfileRequestId;
    const realDistance = calculatePathDistance(layer);
    let pointsWithElev;
    let source;

    // Check if user wants to prefer file elevation data (default: true)
    const preferFileElevation = localStorage.getItem("preferFileElevation") !== "false";

    // Check if elevation data already exists in the file
    if (hasExistingElevationData(latlngs) && preferFileElevation) {
      console.log("Using existing elevation data from file (no API call needed).");
      pointsWithElev = samplePathForElevation(fillMissingElevations(latlngs));
      source = "File";
    } else {
      if (hasExistingElevationData(latlngs) && !preferFileElevation) {
        console.log("File has elevation data, but user prefers API. Fetching from API...");
      } else {
        console.log("No elevation data in file, fetching from API...");
      }
      const provider = localStorage.getItem("elevationProvider") || "google";
      pointsWithElev = await fetchElevationForPath(latlngs);
      // Drop stale response if the selection changed or a newer call started during the fetch
      if (selectedElevationPath !== layer || requestId !== elevationProfileRequestId) return;
      source = provider === "geoadmin" ? "GeoAdmin" : "Google";
    }

    if (pointsWithElev?.length > 0) {
      window.elevationProfile.drawElevationProfile(pointsWithElev, realDistance, source);
    } else {
      console.warn("No valid elevation data.");
      window.elevationProfile.clearElevationProfile();
    }
  }
}

/**
 * Removes elevation data from the selected path and reloads the profile from API.
 */
async function removeElevationFromPath() {
  if (!selectedElevationPath) return;

  const latlngs = selectedElevationPath.getLatLngs();
  if (!latlngs || latlngs.length === 0) return;

  // Strip altitude from each point
  for (let i = 0; i < latlngs.length; i++) {
    latlngs[i].alt = undefined;
  }
  scheduleDataEditorRefresh();

  // Keep the cache entry — the cache key is coordinate-based, so the
  // cached API data is still valid for these same coordinates.  This
  // avoids redundant API calls when the user repeatedly removes and
  // re-adds elevation data without changing the path geometry.
  await addElevationProfileForLayer(selectedElevationPath);
  Swal.fire({
    toast: true,
    icon: "success",
    title: "Elevation data removed from path",
    showConfirmButton: false,
    timer: 1500,
  });
}

/**
 * Adds API elevation data to the selected path's coordinates.
 * Locates each API point on the path and interpolates between them, so the
 * profile drawn from the file afterwards equals the API profile.
 */
async function addElevationToPath() {
  if (!selectedElevationPath) return;

  const latlngs = selectedElevationPath.getLatLngs();
  if (!latlngs || latlngs.length < 2) return;

  // Get cached API data
  const cacheKey = elevationCacheKey(latlngs);
  const apiData = elevationCache.get(cacheKey);
  if (!apiData || apiData.length === 0) {
    console.warn("No cached API elevation data to add.");
    return;
  }

  const origDistances = [0];
  for (let i = 1; i < latlngs.length; i++) {
    origDistances.push(origDistances[i - 1] + latlngs[i - 1].distanceTo(latlngs[i]));
  }

  // Path distance of each API point: they were sampled from this path in order,
  // so walking forward to the first segment the point lies on finds each one.
  const cosLat = Math.cos((latlngs[0].lat * Math.PI) / 180);
  const METERS_PER_DEGREE = 111320;
  const apiDistances = [];
  let seg = 0;
  for (const p of apiData) {
    let t;
    for (;;) {
      const a = latlngs[seg];
      const b = latlngs[seg + 1];
      const dx = (b.lng - a.lng) * cosLat;
      const dy = b.lat - a.lat;
      const px = (p.lng - a.lng) * cosLat;
      const py = p.lat - a.lat;
      const len2 = dx * dx + dy * dy;
      t = len2 > 0 ? Math.min(Math.max((px * dx + py * dy) / len2, 0), 1) : 0;
      const offset = Math.hypot(px - t * dx, py - t * dy) * METERS_PER_DEGREE;
      if (offset < 0.5 || seg >= latlngs.length - 2) break;
      seg++;
    }
    apiDistances.push(origDistances[seg] + t * (origDistances[seg + 1] - origDistances[seg]));
  }

  // Interpolate elevation for each original point between its neighbouring API points
  let k = 0;
  for (let i = 0; i < latlngs.length; i++) {
    const d = origDistances[i];
    while (k < apiDistances.length - 2 && apiDistances[k + 1] < d) k++;
    const next = Math.min(k + 1, apiData.length - 1);
    const span = apiDistances[next] - apiDistances[k];
    const t = span > 0 ? Math.min(Math.max((d - apiDistances[k]) / span, 0), 1) : 0;
    const e1 = apiData[k].alt || 0;
    const e2 = apiData[next].alt || 0;
    latlngs[i].alt = e1 + t * (e2 - e1);
  }
  scheduleDataEditorRefresh();

  // Keep the cache entry so that removing and re-adding elevation
  // does not trigger another API call for the same coordinates.
  await addElevationProfileForLayer(selectedElevationPath);
  Swal.fire({
    toast: true,
    icon: "success",
    title: "Elevation data added to path",
    showConfirmButton: false,
    timer: 1500,
  });
}
