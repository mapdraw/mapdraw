# System Architecture & Data Specifications

**Complete documentation of the system architecture, file handling, and internal data structures.**

---

## Table of Contents

1. [Vision](#vision)
2. [Document Organization](#document-organization)
3. [System Architecture](#system-architecture)
4. [Data Storage](#data-storage)
5. [Format Compatibility Matrix](#format-compatibility-matrix)
6. [Coordinate Precision](#coordinate-precision)
7. [Color System](#color-system)
8. [Import System](#import-system)
9. [Export System](#export-system)
10. [URL Sharing System](#url-sharing-system)
11. [Performance & Optimization](#performance--optimization)
12. [Error Handling & Validation](#error-handling--validation)
13. [Dependencies](#dependencies)
14. [WMS Layers System](#wms-layers-system)
15. [Editing Behavior](#editing-behavior)
16. [Known Limitations](#known-limitations)

---

## Vision

All imported and drawn items store **full-precision coordinates**, **name**, **description**, **color**, and **stravaId** (if available).

All formats are interoperable - data imported from GeoJSON, GPX, KML, or KMZ can be exported to GeoJSON, GPX, or KML without data loss.

**Property edits** (name, color) work on all items without duplication. **Geometry edits** require duplication to the drawing layer (via the "Duplicate" button). **Custom colors** are preserved as hex values for maximum compatibility.

---

## Document Organization

MapDraw is a **Vanilla JavaScript** application with modular organization.

### Core Modules

| Script                  | Responsibility                                                                                                                                                        |
| :---------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.js`               | **Entry Point**. Orchestrates map initialization, global event listeners, and layer management.                                                                       |
| `autosave.js`           | Periodic state persistence to IndexedDB with session restoration.                                                                                                     |
| `config.js`             | App-wide constants, styling defaults, and color palette definitions.                                                                                                  |
| `secrets.js`            | API keys for external services (`osmClientId`, map tile keys, etc.) — not committed to git, created from template.                                                    |
| `utils.js`              | Geometry calculations (distance, area), coordinate parsing, and common helpers.                                                                                       |
| `color-utils.js`        | Color parsing and conversion utilities (all 148 CSS Color Level 4 named color keywords, hex normalization, KML format).                                               |
| `file-handlers.js`      | Complex I/O logic for GeoJSON, GPX, KML, and KMZ import/export.                                                                                                       |
| `ui-handlers.js`        | Manages the Sidebar, Contents tab, color picker, and interactive UI elements.                                                                                         |
| `map-interactions.js`   | Marker dragging, path selection, elevation marker sync, and map interaction handlers.                                                                                 |
| `elevation.js`          | Data fetching logic for Google and GeoAdmin (Swiss) elevation APIs with caching.                                                                                      |
| `elevation-profile.js`  | UI rendering of the D3-powered elevation chart with hover synchronization.                                                                                            |
| `routing.js`            | Integration with Mapbox/OSRM routing engines and waypoint management.                                                                                                 |
| `strava.js`             | OAuth flow, activity fetching (coordinates decoded from `summary_polyline`), and GPX download trigger for individual activities.                                      |
| `search.js`             | Search modal with geocoding via OSM Nominatim and coordinate parsing.                                                                                                 |
| `poi-finder.js`         | Points of Interest discovery via Overpass API with category filtering.                                                                                                |
| `wms-import.js`         | Web Map Service layer management with GetCapabilities parsing.                                                                                                        |
| `contextmenu.js`        | Right-click context menu for coordinate display and routing point assignment.                                                                                         |
| `leaflet-wms-gutter.js` | WMS tile gutter extension to prevent icon clipping at tile boundaries.                                                                                                |
| `sweetalert2-config.js` | Global SweetAlert2 modal configuration and theming.                                                                                                                   |
| `data-editor.js`        | Desktop-only GeoJSON editor tab (powered by CodeMirror) for viewing and directly editing all map features; supports apply, reset, find-selected, and copy operations. |
| `osm.js`                | OpenStreetMap integration: OAuth 2.0 PKCE authentication, POI node contribution, OSM note submission, and contribution management (view/delete past nodes).           |
| `dev-panel.js`          | Hidden developer debugging panel for inspecting global state.                                                                                                         |

---

## System Architecture

### Application Flow

1. **Entry Point**: `index.html` loads scripts individually in development. During deployment, the [GitHub Actions workflow](https://github.com/mapdraw/mapdraw/blob/main/.github/workflows/deploy.yml) concatenates all scripts between `<!-- START-BUNDLE -->` / `<!-- END-BUNDLE -->` markers and minifies them into a single `js/app.min.js` via Terser.
2. **Initialization**: On `DOMContentLoaded`, `js/main.js` calls `initializeMap()`.
3. **Map Setup**: Leaflet instances, panes, and FeatureGroups are created.
4. **State Restoration**: Map view and shared features are restored from URL hash or IndexedDB (autosave).
5. **Event Handling**: Global listeners for map interactions, UI tabs, and file uploads are attached.

### Global State Management

The application uses **Global Variables** in `main.js` as the single source of truth for the map state:

- `map`: The Leaflet map instance.
- `drawnItems` / `importedItems`: Primary feature storage (FeatureGroups).
- `stravaActivitiesLayer`: Live Strava activity data (FeatureGroup).
- `editableLayers`: Layers linked to Leaflet.Draw for geometry editing.
- `currentRoutePath`: Active routing result (Polyline, not in a FeatureGroup).
- `globallySelectedItem`: Currently active layer for editing/info display.

---

## Data Storage

### Layer Groups (Leaflet FeatureGroups)

All map features are managed in specific [Leaflet FeatureGroups](https://github.com/mapdraw/mapdraw/search?q=L.featureGroup+path:js/main.js) to maintain clear separation:

| Layer Group             | Purpose                                                  | Can Edit Geometry?   |
| :---------------------- | :------------------------------------------------------- | :------------------- |
| `drawnItems`            | User-drawn features (markers, paths, areas)              | ✅ Yes               |
| `importedItems`         | All imported files (GeoJSON, GPX, KML, KMZ)              | ❌ No (Read-only)    |
| `editableLayers`        | Mirrors `drawnItems` - these layers link to Leaflet.Draw | ✅ Yes               |
| `stravaActivitiesLayer` | Live Strava activity data                                | ❌ No                |
| `currentRoutePath`      | Active routing result (Polyline)                         | ⚠️ Via routing panel |

### Feature Structure

Every layer (Path, Area, or Marker) has a [`.feature` object](https://github.com/mapdraw/mapdraw/search?q=layer.feature+path:js/) following the GeoJSON structure:

```javascript
layer.feature = {
  properties: {
    name: "string",           // User-editable; displayed as "Marker" / "Path" / "Area" when empty
    description: "string",    // Optional, preserved in all exports (editable via the Data Editor tab; no dedicated sidebar field)
    color: "#DC143C",         // Hex color value (CSS standard colors or custom)
    stravaId: "123456789",    // Optional, preserved from Strava/import
    totalDistance: 1234.56    // Calculated internally, excluded from standard exports
  },
  geometry: {
    type: "Point" | "LineString" | "Polygon",
    coordinates: [[lng, lat, alt?], ...]  // Full JS precision (~15 digits)
  }
}
```

### Layer Metadata

Beyond the GeoJSON object, [layers store additional metadata](https://github.com/mapdraw/mapdraw/search?q=layer.pathType+path:js/) at runtime:

```javascript
layer.pathType = "drawn" | "gpx" | "kml" | "kmz" | "geojson" | "route" | "strava";
layer.isManuallyHidden = false; // Visibility override (Eye icon in Contents tab)
layer.isDeletedFromToolbar = false; // Transiently set to true during a toolbar delete operation
```

**Note:** `editableLayers` is a separate FeatureGroup that contains the same layers as `drawnItems`. When a layer is drawn, it's added to both groups. This design allows Leaflet.Draw to manage editing while `drawnItems` handles visual rendering and layer control visibility.

---

## Format Compatibility Matrix

**Import:** GeoJSON, GPX, KML, KMZ • **Export:** GeoJSON, GPX, KML (KMZ is import-only)

| Property              | GeoJSON                      | GPX                                | KML                                                                      |
| :-------------------- | :--------------------------- | :--------------------------------- | :----------------------------------------------------------------------- |
| **Coordinates**       | ✅ Full precision            | ✅ Full precision                  | ✅ Full precision                                                        |
| **Name**              | ✅ `properties.name`         | ✅ `<name>`                        | ✅ `<name>`                                                              |
| **Description**       | ✅ `properties.description`  | ✅ `<desc>`                        | ✅ `<description>`                                                       |
| **Color**             | ✅ `stroke` / `marker-color` | ✅ `<gpx_style:color>` / `<color>` | ✅ `<color>` / `<styleUrl>`                                              |
| **StravaId**          | ✅ `properties.stravaId`     | ✅ `<extensions>`                  | ✅ `<ExtendedData>`                                                      |
| **Elevation**         | ✅ Coordinates[2]            | ✅ `<ele>`                         | ✅ Coordinates (3rd value)                                               |
| **Custom Properties** | ✅ All preserved             | ❌ Not supported                   | ❌ Not supported (only `stravaId` is round-tripped via `<ExtendedData>`) |

---

## Coordinate Precision

| Context              | Precision                                      | Format                                                                                     |
| :------------------- | :--------------------------------------------- | :----------------------------------------------------------------------------------------- |
| **Internal Storage** | Full precision                                 | JavaScript Number (~15 significant digits)                                                 |
| **GeoJSON Export**   | Full precision                                 | Manually extracted from geometry                                                           |
| **GPX Export**       | Full precision                                 | From `getLatLng()` coordinates                                                             |
| **KML Export**       | Full precision                                 | Serialized from coordinate array                                                           |
| **URL Sharing**      | 5 decimals (paths/areas), 6 decimals (markers) | Paths/areas: Polyline encoded (Precision 5, ~1.1m accuracy); markers: `toFixed(6)` lat/lon |

**Elevation Handling:**

- Stored as the third coordinate element: `[lng, lat, alt]`
- GPX: Exported using `<ele>` tags within `<trkpt>` or `<wpt>`
- KML: Part of the coordinate string `lng,lat,alt`
- Elevation is preserved through all import/export round-trips

---

## Color System

### Architecture

The app uses a **hex-based color system** for maximum flexibility and compatibility:

- **Internal Storage**: Colors stored as hex values (e.g., `"#DC143C"`) in `feature.properties.color`
- **Import Support**: Accepts all 148 CSS Color Level 4 named color keywords plus any custom hex value
- **Export**: Outputs hex values in format-native properties (e.g., `stroke`, `marker-color`, `<color>`)
- **Default Color**: `#DC143C` (Crimson) when color cannot be parsed

### Color Picker Palette

The UI color picker displays **16 CSS standard colors** defined in `COLOR_PALETTE` in [js/config.js](https://github.com/mapdraw/mapdraw/blob/main/js/config.js).

### Custom Color Support

Colors outside the 16-color palette are fully supported:

1. **Import**: Any CSS color name or hex value is accepted and preserved exactly
2. **Display**: Custom colors show in a special "custom color swatch" in the picker
3. **Export**: Exact hex values are preserved in all export formats

### Color Utilities

Color parsing and conversion handled by [js/color-utils.js](https://github.com/mapdraw/mapdraw/blob/main/js/color-utils.js):

- `parseColor()`: Converts CSS color names or hex values to normalized `#RRGGBB` format
- `normalizeHexColor()`: Handles #RGB, #RGBA, #RRGGBB, #AARRGGBB formats
- `cssToKmlColor()`: Converts CSS hex to KML `AABBGGRR` format (for export)
- `kmlToCssColor()`: Converts KML `AABBGGRR` to CSS `#RRGGBB` format (for import)

---

## Import System

GPX and KML are converted to GeoJSON using the [`toGeoJSON`](https://github.com/mapbox/togeojson) library.

### Import Flow

**Stage 1 — Format Parsing** (per format):

| Input    | Parser               | Additional Steps                                                       |
| :------- | :------------------- | :--------------------------------------------------------------------- |
| .geojson | `JSON.parse()`       | `explodeMultiGeometries()`                                             |
| .gpx     | `toGeoJSON.gpx()`    | `applyGpxColors()` → extract stravaId → `explodeMultiGeometries()`     |
| .kml     | `toGeoJSON.kml()`    | extract stravaId → `applyKmlIconColors()` → `explodeMultiGeometries()` |
| .kmz     | JSZip → extract .kml | Then same as KML                                                       |

**Stage 2 — Shared Pipeline** (`importGeoJsonToMap()`):

All formats funnel into this single function, which:

1. Resolves color (using format-specific logic)
2. Assigns `pathType`
3. Creates Leaflet layers
4. Attaches click handlers
5. Adds layers to `importedItems`

| Format  | Parser                  | Color Source                  | stravaId Source                     |
| :------ | :---------------------- | :---------------------------- | :---------------------------------- |
| GeoJSON | `JSON.parse()`          | `stroke` / `marker-color`     | `properties.stravaId` (passthrough) |
| GPX     | `toGeoJSON.gpx()`       | `<gpx_style:color>` extension | `<extensions>` block                |
| KML     | `toGeoJSON.kml()`       | `<Style>` / `<styleUrl>`      | `<ExtendedData>`                    |
| KMZ     | JSZip → `toGeoJSON.kml` | Same as KML                   | Same as KML                         |

**Entry Points:**

- **GeoJSON**: [`importGeoJsonFile(file)`](https://github.com/mapdraw/mapdraw/search?q=symbol:importGeoJsonFile+path:js/file-handlers.js)
- **GPX**: [`importGpxFile(file)`](https://github.com/mapdraw/mapdraw/search?q=symbol:importGpxFile+path:js/file-handlers.js)
- **KML**: [`importKmlFile(file)`](https://github.com/mapdraw/mapdraw/search?q=symbol:importKmlFile+path:js/file-handlers.js)
- **KMZ**: [`importKmzFile(file)`](https://github.com/mapdraw/mapdraw/search?q=symbol:importKmzFile+path:js/file-handlers.js)

1. **Validation**: Filters for supported geometry types (Point, LineString, Polygon).
2. **Enrichment**: Extracts `stravaId` and `color` from format-specific extensions.
3. **Integration**: Features added to `importedItems`.

### Strava Import

Strava activities are decoded from the API's `summary_polyline` field using the **Google Polyline Algorithm** (Precision 5, same as URL sharing). Activities are added to `stravaActivitiesLayer` with read-only geometry.

---

## Export System

### Export Flow

**Mode: "all"** — `getAllExportableLayers()` collects from:

- `editableLayers` (drawn items)
- `importedItems`
- `stravaActivitiesLayer`
- `currentRoutePath`

**Mode: "single"** — Exports only `globallySelectedItem`.

**Mode: "strava"** — Exports only `stravaActivitiesLayer`.

Format support varies by mode:

- **GeoJSON** (`exportGeoJson()`): Supports all three modes — "all", "single", and "strava".
- **GPX** (`convertLayerToGpx()`): Single-layer only — serializes one layer to a GPX string; the caller in `main.js` handles the download.
- **KML** (`exportKml()`): Always exports all layers — no mode argument.

| Output  | Geometry Mapping                                      | Color Format                                    | Metadata            |
| :------ | :---------------------------------------------------- | :---------------------------------------------- | :------------------ |
| GeoJSON | Point, LineString, Polygon                            | `stroke`, `marker-color`                        | Standard properties |
| GPX     | Point → `<wpt>`, Line → `<trk>`, Polygon → closed trk | tracks: `<gpx_style:color>`; markers: `<color>` | `<extensions>`      |
| KML     | Point, LineString, Polygon                            | `AABBGGRR` in `<Style>`                         | `<ExtendedData>`    |

### GeoJSON Export

[`exportGeoJson`](https://github.com/mapdraw/mapdraw/search?q=symbol:exportGeoJson+path:js/file-handlers.js) exports items based on mode ("all", "single", or "strava"):

- Injects standard GeoJSON styling properties (`stroke`, `marker-color`) for compatibility with external tools (e.g., geojson.io)
- Excludes internal properties: `color`, `totalDistance`, `stroke-width`, `stroke-opacity`, `fill`, `fill-color`, `fill-opacity`

### GPX Export

[`convertLayerToGpx`](https://github.com/mapdraw/mapdraw/search?q=symbol:convertLayerToGpx+path:js/file-handlers.js) converts layers to GPX format:

- Markers become `<wpt>` (waypoints)
- Paths become `<trk>` (tracks)
- Areas (Polygons) become closed `<trk>` tracks (GPX has no native polygon support)
- Tracks/polygons: color in `<gpx_style:color>` (6-character hex, no `#`); markers: color in `<color>` (`#FF` + 6-character hex)
- `stravaId` stored in `<extensions>` block

### KML Export

[`exportKml`](https://github.com/mapdraw/mapdraw/search?q=symbol:exportKml+path:js/file-handlers.js) exports items to KML format:

- **Single KML File**: All features are exported to a single `.kml` file for maximum compatibility
- **Google Earth Compatible**: Works seamlessly with Google Earth Web, Google Earth Desktop, and Google My Maps
- **Color Preservation**: Inline `<Style>` elements with proper KML color format (`AABBGGRR`)
- **Metadata**: Names, descriptions, and stravaId (via `<ExtendedData>`) are preserved

---

## URL Sharing System

Encodes map state into a compressed string parameter (`&data=`).

1. **Polyline Encoding**: Coordinates compressed (Precision 5) via [polyline-encoded](https://www.npmjs.com/package/polyline-encoded) (`L.PolylineUtil`).
2. **Minification**: Property names shortened (`t` for type, `c` for coordinates, `n` for name, `s` for style/color, `e` for elevation, `sid` for stravaId).
3. **Omission**: Default values (e.g., Crimson color) and empty fields are excluded.
4. **Gzip + base64url**: JSON payload is compressed with the native browser `CompressionStream("gzip")` API and encoded as base64url — no external library required.

**Size Limits**: The app warns at 2,000 characters; Chrome supports URLs up to 2MB.

---

## Performance & Optimization

### Elevation Caching

The application implements an **Elevation Cache** (`Map` object in `elevation.js`) to prevent redundant API calls for the same coordinates.

- **Adaptive Sampling**:
  - **Google**: Upsamples low-density paths to 200 points; caps high-density paths at 5,000 points.
  - **GeoAdmin**: Batches large tracks into 3,000-point chunks to satisfy backend limits.

### Geometry Optimization

- **Path Simplification**: During duplication and route saving, paths are optimized using the Douglas-Peucker algorithm (`simplify.js`) with a `0.00015` degree tolerance (~15m).
- **Lazy Rendering**: Elevation profiles are only rendered when the profile panel is toggled visible.

---

## Error Handling & Validation

### Validation Layers

1. **File Type**: Client-side extension filtering (`.gpx`, `.kml`, etc.).
2. **Structure**: Schema validation for GeoJSON (checks for `type` and `features`).
3. **Geometry**: filtering for Point, LineString, and Polygon only.
4. **API States**: Real-time monitoring of Google Maps and Strava API availability.
5. **Coordinate Limits**: Swiss elevation queries are validated against the LV95 bounding box.

### Error UI

All errors are handled via **SweetAlert2** modals, providing user-friendly explanations for common failures (CORS issues, invalid XML, API rate limits).

---

## Dependencies

For a complete list of external libraries and plugins with versions, see [Plugins & Libraries Used](https://github.com/mapdraw/mapdraw#plugins--libraries-used) in the README.

---

## WMS Layers System

Users can import custom Web Map Service layers.

- **z-Index Control**: Managed via a dedicated `wmsPane` (z-index 250), keeping them above base maps but below user content.
- **Persistence**: Reordered layers and visibility states are stored in `localStorage`.

---

## Editing Behavior

### Property vs. Geometry

- **Read-Only Geometry**: Imported files and Strava activities cannot have their points moved directly. This prevents accidental corruption of source data.
- **Editable Properties**: You can change the `name` and `color` of any item (drawn or imported) at any time.

### Duplication Flow

To edit the geometry of an imported item:

1. Go to the **Contents** tab
2. Click the **Duplicate** (copy) icon next to the item
3. A copy is created in the "Drawn Items" group
4. The copy is fully editable (geometry and properties)
5. Optional path simplification is applied during duplication

---

## Known Limitations

- **Multi-Geometries**: Native editing is not supported (automatically exploded into individual Points, LineStrings, and Polygons on import). See [`SUPPORTED_IMPORT_GEOM_TYPES` constant](https://github.com/mapdraw/mapdraw/search?q=SUPPORTED_IMPORT_GEOM_TYPES+path:js/file-handlers.js).
- **GPX Polygon Export**: GPX format has no native polygon support. Areas are exported as closed tracks and will import as LineStrings in other applications.
- **Off-grid Elevation**: The GeoAdmin service is restricted to the Swiss border.

---

## Summary

MapDraw uses **GeoJSON as the internal truth** with robust translators for GPX and KML. It balances high-precision data preservation with web performance through intelligent sampling, caching, and compression.
