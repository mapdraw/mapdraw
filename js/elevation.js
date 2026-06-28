// Copyright (C) 2025 Aron Sommer. See LICENSE file for full license details.

const elevationCache = new Map();

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

  // 2. Get the transformation function from proj4
  const transformer = proj4(fromProj, toProj);

  // 3. Perform the conversion by mapping over the array

  // Case A: WGS84 (Lng, Lat) -> LV95 (Easting, Northing)
  if (toProj === LV95) {
    return latlngs.map((p) => {
      const coords = transformer.forward([p.lng, p.lat]);
      return [coords[0], coords[1]]; // [easting, northing]
    });
  }
  // Case B: LV95 (Easting, Northing) -> WGS84 (Lng, Lat)
  // Note: The caller stores Easting in p.lng, Northing in p.lat
  else {
    return latlngs.map((p) => {
      const coords = transformer.forward([p.lng, p.lat]);
      return [coords[0], coords[1]]; // [lng, lat]
    });
  }
}

/**
 * Fetches elevation data from Google Maps Elevation API.
 * Implements adaptive point sampling based on path complexity.
 * @param {L.LatLng[]} latlngs - Path coordinates
 * @param {number} realDistance - Actual path distance in meters
 * @returns {Promise<L.LatLng[]|null>} Array of coordinates with elevation or null on error
 */
async function fetchElevationForPathGoogle(latlngs, realDistance) {
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

  // Define thresholds for adaptive path sampling
  const SIMPLE_PATH_THRESHOLD = 200; // Simple paths (≤200 points) will be upsampled to 200
  const MAX_POINTS_TO_REQUEST = 5000; // Absolute maximum to prevent errors and high costs

  const actualPoints = latlngs.length;
  let pointsToSend;

  if (actualPoints > MAX_POINTS_TO_REQUEST) {
    // CASE 1: Path is TOO complex - downsample to absolute cap
    console.log(
      `[Elevation] Path is too complex (${actualPoints} points). Downsampling to ${MAX_POINTS_TO_REQUEST} points.`,
    );
    pointsToSend = resamplePath(latlngs, MAX_POINTS_TO_REQUEST);
  } else if (actualPoints > SIMPLE_PATH_THRESHOLD) {
    // CASE 2: Path is "complex" - use exact points
    console.log(
      `[Elevation] Path is "complex" (${actualPoints} points). Sending all original points.`,
    );
    pointsToSend = latlngs;
  } else {
    // CASE 3: Path is "simple" - upsample to 200 points
    console.log(
      `[Elevation] Path is "simple" (${actualPoints} points). Upsampling to ${SIMPLE_PATH_THRESHOLD} points.`,
    );
    pointsToSend = resamplePath(latlngs, SIMPLE_PATH_THRESHOLD);
  }
  for (let i = 0; i < pointsToSend.length; i += BATCH_SIZE) {
    const batch = pointsToSend.slice(i, i + BATCH_SIZE);
    try {
      const response = await elevator.getElevationForLocations({ locations: batch });
      if (response && response.results) {
        const batchResults = response.results.map((result) =>
          L.latLng(result.location.lat(), result.location.lng(), result.elevation),
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
 * Fetches elevation data from the official GeoAdmin API.
 * This mimics the logic from 'profile_helpers.py'.
 *
 * @see https://api3.geo.admin.ch/services/sdiservices.html#profile
 */
async function fetchElevationForPathGeoAdminAPI(latlngs) {
  const ENABLE_GEOADMIN_DEBUG = false; // Set to true for debug output in console

  console.log("Fetching elevation data from: GeoAdmin (geo.admin.ch)");

  try {
    // Step 1: Convert our WGS 84 path to LV95
    const lv95Coordinates = await convertPath(latlngs, "4326", "2056");

    // Step 1.5: Check if all coordinates are outside Switzerland bounds
    if (areAllCoordinatesOutsideSwitzerlandBounds(lv95Coordinates)) {
      throw new Error(
        "Path is completely outside Switzerland. The GeoAdmin elevation service only covers Switzerland.",
      );
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

    // Step 4: Process responses and stitch them together
    let swissProfilePoints = [];
    let previousDist = 0;

    for (const profileResponse of allResponses) {
      if (!profileResponse.ok) {
        throw new Error(
          `Profile API failed (${profileResponse.status}): ${await profileResponse.text()}`,
        );
      }

      const chunkPoints = await profileResponse.json();

      if (!chunkPoints || chunkPoints.length === 0) {
        throw new Error("Profile API returned no data for a chunk.");
      }

      // Adjust distance values to account for previous chunks
      const adjustedPoints = chunkPoints.map((point) => ({
        ...point,
        dist: point.dist + previousDist,
      }));

      swissProfilePoints = swissProfilePoints.concat(adjustedPoints);
      previousDist = swissProfilePoints[swissProfilePoints.length - 1].dist;
    }
    if (!swissProfilePoints || swissProfilePoints.length === 0) {
      throw new Error("Profile API returned no data.");
    }

    // Filter out any points without valid, finite numeric coordinates
    const validSwissPoints = swissProfilePoints.filter(
      (p) => isFinite(p.easting) && isFinite(p.northing),
    );

    if (validSwissPoints.length === 0) {
      // This can happen if the *entire* line is outside Switzerland
      throw new Error(
        "Profile API returned data, but no valid coordinates (line may be outside data area).",
      );
    }

    // Step 3: Convert the points back to WGS 84 for map display
    // NOTE: We store LV95 easting in lng, northing in lat
    const profileLv95LatLngs = validSwissPoints.map((p) => L.latLng(p.northing, p.easting));

    const profileWgs84Coords = await convertPath(profileLv95LatLngs, "2056", "4326");

    // Step 4: Merge the data into L.LatLng objects with altitude
    const pointsWithElev = [];
    let debugDataForTable = [];

    for (let i = 0; i < validSwissPoints.length; i++) {
      const swissPoint = validSwissPoints[i];
      const wgs84Coord = profileWgs84Coords[i]; // [lng, lat]

      // Get altitude, default to 0 if 'COMB' (combined) model isn't present
      const altitude = swissPoint.alts && isFinite(swissPoint.alts.COMB) ? swissPoint.alts.COMB : 0;

      pointsWithElev.push(L.latLng(wgs84Coord[1], wgs84Coord[0], altitude));

      if (ENABLE_GEOADMIN_DEBUG) {
        debugDataForTable.push({
          Distance: swissPoint.dist,
          Altitude: altitude,
          Easting: swissPoint.easting,
          Northing: swissPoint.northing,
          Longitude: wgs84Coord[0],
          Latitude: wgs84Coord[1],
        });
      }
    }

    if (ENABLE_GEOADMIN_DEBUG) {
      console.log("--- GeoAdmin Debug Data (View Only) ---");
      console.table(debugDataForTable);

      let csvContent = "Distance;Altitude;Easting;Northing;Longitude;Latitude\n";
      debugDataForTable.forEach((row) => {
        csvContent += `${row.Distance};${row.Altitude};${row.Easting};${row.Northing};${row.Longitude};${row.Latitude}\n`;
      });

      window.copyGeoAdminCSV = () => {
        copy(csvContent);
        console.log("CSV data copied to clipboard!");
      };

      console.log(
        "%cTo copy data as CSV, type copyGeoAdminCSV() in the console and press Enter.",
        "font-size: var(--font-size-14);",
      );
    }

    return pointsWithElev;
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
 * @param {number} realDistance - Actual path distance in meters
 * @returns {Promise<L.LatLng[]|null>} Array of coordinates with elevation or null on error
 */
async function fetchElevationForPath(latlngs, realDistance) {
  const cacheKey = JSON.stringify(latlngs.map((p) => [p.lat.toFixed(6), p.lng.toFixed(6)]));

  if (elevationCache.has(cacheKey)) {
    console.log("Returning cached elevation data.");
    return Promise.resolve(elevationCache.get(cacheKey));
  }

  // Get the selected elevation provider from localStorage (default to "google")
  const elevationProvider = localStorage.getItem("elevationProvider") || "google";

  let pointsWithElev;
  if (elevationProvider === "geoadmin") {
    pointsWithElev = await fetchElevationForPathGeoAdminAPI(latlngs);
  } else {
    pointsWithElev = await fetchElevationForPathGoogle(latlngs, realDistance);
  }

  if (pointsWithElev) {
    elevationCache.set(cacheKey, pointsWithElev);
  }

  return pointsWithElev;
}

/**
 * Updates the elevation toggle icon color based on visibility state.
 */
function updateElevationToggleIconColor() {
  if (elevationToggleControl) {
    const materialSymbolsIcon = elevationToggleControl
      .getContainer()
      .querySelector(".material-symbols");
    if (materialSymbolsIcon) {
      materialSymbolsIcon.style.color = isElevationProfileVisible
        ? "var(--highlight-color)"
        : "var(--icon-color)";
    }
  }
}

/**
 * Checks if a path already has elevation data.
 * @param {L.LatLng[]} latlngs - Path coordinates
 * @returns {boolean} True if at least 80% of points have elevation data with meaningful variance
 */
function hasExistingElevationData(latlngs) {
  if (!latlngs || latlngs.length === 0) return false;

  const elevationValues = latlngs
    .filter((p) => typeof p.alt === "number" && isFinite(p.alt))
    .map((p) => p.alt);

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
 * Adds elevation profile for a selected layer.
 * @param {L.Layer} layer - The layer to create an elevation profile for
 */
async function addElevationProfileForLayer(layer) {
  if (!layer || layer instanceof L.Polygon || !isElevationProfileVisible) return;

  if (!(layer instanceof L.Polyline)) return;

  let latlngs = layer instanceof L.Polyline ? layer.getLatLngs() : layer.getLatLngs()[0];
  if (latlngs?.length > 0) {
    const realDistance = calculatePathDistance(layer);
    let pointsWithElev;
    let source;

    // Check if user wants to prefer file elevation data (default: true)
    const preferFileElevation = localStorage.getItem("preferFileElevation") !== "false";

    // Check if elevation data already exists in the file
    if (hasExistingElevationData(latlngs) && preferFileElevation) {
      console.log("Using existing elevation data from file (no API call needed).");
      pointsWithElev = latlngs;
      source = "File";
    } else {
      if (hasExistingElevationData(latlngs) && !preferFileElevation) {
        console.log("File has elevation data, but user prefers API. Fetching from API...");
      } else {
        console.log("No elevation data in file, fetching from API...");
      }
      const provider = localStorage.getItem("elevationProvider") || "google";
      pointsWithElev = await fetchElevationForPath(latlngs, realDistance);
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
 * Uses distance-based interpolation to map API elevations to original path points.
 */
async function addElevationToPath() {
  if (!selectedElevationPath) return;

  const latlngs = selectedElevationPath.getLatLngs();
  if (!latlngs || latlngs.length === 0) return;

  // Get cached API data
  const cacheKey = JSON.stringify(latlngs.map((p) => [p.lat.toFixed(6), p.lng.toFixed(6)]));
  const apiData = elevationCache.get(cacheKey);
  if (!apiData || apiData.length === 0) {
    console.warn("No cached API elevation data to add.");
    return;
  }

  // Build distance→elevation pairs from API data
  const apiDistElev = [{ distance: 0, elevation: apiData[0].alt || 0 }];
  let cumDist = 0;
  for (let i = 1; i < apiData.length; i++) {
    cumDist += apiData[i - 1].distanceTo(apiData[i]);
    apiDistElev.push({ distance: cumDist, elevation: apiData[i].alt || 0 });
  }
  const apiTotal = apiDistElev[apiDistElev.length - 1].distance;

  // Build cumulative distances for original path
  const origDistances = [0];
  for (let i = 1; i < latlngs.length; i++) {
    origDistances.push(origDistances[i - 1] + latlngs[i - 1].distanceTo(latlngs[i]));
  }
  const origTotal = origDistances[origDistances.length - 1];

  // Interpolate elevation for each original point
  for (let i = 0; i < latlngs.length; i++) {
    const targetDist =
      apiTotal > 0 && origTotal > 0 ? (origDistances[i] / origTotal) * apiTotal : origDistances[i];

    // Find surrounding API points for interpolation
    let j = 0;
    while (j < apiDistElev.length - 1 && apiDistElev[j + 1].distance < targetDist) {
      j++;
    }

    if (j >= apiDistElev.length - 1) {
      latlngs[i].alt = apiDistElev[apiDistElev.length - 1].elevation;
    } else {
      const d1 = apiDistElev[j].distance;
      const d2 = apiDistElev[j + 1].distance;
      const e1 = apiDistElev[j].elevation;
      const e2 = apiDistElev[j + 1].elevation;
      const t = d2 - d1 > 0 ? (targetDist - d1) / (d2 - d1) : 0;
      latlngs[i].alt = e1 + t * (e2 - e1);
    }
  }

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
