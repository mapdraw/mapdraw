# Third-Party Code Reference

This folder contains original source files from third-party projects that were used as a reference for code in this repository.

---

### `geoadmin-elevation-profile/utils.ts`

- **Source:** `https://github.com/geoadmin/web-mapviewer/blob/develop/packages/geoadmin-elevation-profile/src/utils.ts`
- **Used In:** `js/elevation-profile.js`
- **Purpose:** This file is the original source for the core statistical logic in `elevation-profile.js`.
  - It served as the reference for calculating `ascent` and `descent` directly from raw, unsmoothed data points.
  - The `calculateSwissHikingTime` and `formatHikingTime` functions were adapted from this file. (Note: A bug in the original `hikingTime` loop, `points.length - 2`, skipped the last segment; our implementation uses `points.length - 1`. [Reported](https://github.com/geoadmin/web-mapviewer/issues/1477) and fixed upstream, but the fix has not reached `develop`, so this copy still shows it.)

---

### `geoadmin-elevation-profile/profile.api.ts`

- **Source:** `https://github.com/geoadmin/web-mapviewer/blob/develop/packages/geoadmin-elevation-profile/src/profile.api.ts`
- **Used In:** `js/elevation.js`
- **Purpose:** Official TypeScript client implementation for the GeoAdmin elevation profile API. Used as reference to implement chunking logic in `fetchElevationForPathGeoAdminAPI()` for handling paths that exceed the API's 5000-point limit:
  - Splits paths exceeding 3000 points into chunks (the same conservative limit the reference uses)
  - Makes parallel API requests for each chunk using `Promise.all()`
  - Concatenates the chunk responses in order. We ignore the API's `dist` field and recompute distances from the coordinates, so no per-chunk offset is needed (the reference offsets `dist` instead).

---

### `geoadmin-service-alti/profile_helpers.py`

- **Source:** `https://github.com/geoadmin/service-alti/blob/develop/app/helpers/profile_helpers.py`
- **Used In:** `js/elevation.js`
- **Purpose:** This file is the original Python backend source for the `map.geo.admin.ch` elevation profile service. It was used as a reference for the sampling logic in `elevation.js`, specifically the 200-point default (`PROFILE_DEFAULT_AMOUNT_POINTS`) and 5000-point maximum (`PROFILE_MAX_AMOUNT_POINTS`) constants. Note: These constants are applied in the `fetchElevationForPathGoogle()` function for the Google Elevation API implementation, while the GeoAdmin API implementation uses the chunking approach from `profile.api.ts` instead.
