<div align="center">
<img src="img/icon-1024x1024.png" height="100"/>

# MapDraw

</div>

MapDraw is a simple, powerful web-based editor for creating, viewing, and managing geographic data like paths, areas, and markers. Built with Leaflet.js, it supports interactive drawing, file import/export (GeoJSON, GPX, KML, KMZ), routing, elevation profiles, custom styling, Strava activity integration, and OpenStreetMap contributions.

---

## Features

- **Local-First:** Your files are processed entirely on your local machine and are never uploaded to a server. Optional features like routing and elevation profiles send only the necessary coordinates to external APIs to function.
- **Draw & Edit:** Easily draw paths, areas, and markers directly on top of a map, and edit them.
- **File Support:** Import GeoJSON, GPX, KML, and KMZ files. Export to GeoJSON, GPX, and KML formats.
- **Full Color Support:** Supports all 148 CSS color names and custom hex values. Colors are preserved across imports and exports.
- **Organic Maps Compatible:** Import GeoJSON and GPX exports from Organic Maps.
- **Google Earth & My Maps Compatible:** KML exports work seamlessly with Google Earth Web, Google Earth Desktop, and Google My Maps.
- **Shareable Links:** Generate shareable URLs containing your map view and all features, making it easy to share your maps with others.
- **Routing:** Generate routes for driving, biking, or walking. You can then save the generated route as an editable path.
- **Elevation Profiles:** Instantly visualize the elevation profile for any path.
- **Strava Integration:** Connect your Strava account to view your activities on the map, download their original high-resolution GPX tracks, or duplicate them for editing.
- **OpenStreetMap Contributions:** Sign in with your OpenStreetMap account to leave notes or add missing places directly to the map.
- **Custom WMS & XYZ Layers:** Import map layers from any WMS-compatible service or XYZ tile URL. Browse available layers, add them to your map as overlays, and reorder them with drag-and-drop. Your layers are saved locally and persist between sessions.
- **POI Finder:** Search for points of interest (parks, restaurants, viewpoints, etc.) in the current map view using OpenStreetMap data, and save them directly to your map.
- **Path & Area Simplification:** While editing a path or area, use a slider to reduce its point count for smoother performance and easier editing.
- **Autosave:** Your work is automatically saved locally in your browser every few seconds and restored when you return, so you never lose your progress.
- **GeoJSON Editor:** View and edit all map features as raw GeoJSON in a built-in code editor powered by CodeMirror, with syntax highlighting, line numbers, code folding, and live inline error detection. Apply changes directly back to the map.

---

## Privacy

MapDraw is built as a local-first application. All processing of your imported geographic data files (GeoJSON, GPX, KML, KMZ) happens **entirely in your web browser**. Your files are never uploaded to or stored on any server.

The application sends data to external services only for specific features, and if configured, collects anonymous analytics data. All communication is limited to the minimum data necessary:

- **Initial Map Centering:** Your approximate location is determined using the Google Geolocation API to center the map on your region on first load.
- **Routing:** When you request a route, the coordinates of your start, end, and via points are sent to the selected routing provider.
- **Elevation Profiles:** When elevation data is already present in your file, it is used directly. Otherwise, path coordinates are sent to your chosen elevation provider (Google Maps Elevation API or GeoAdmin API for paths in Switzerland).
- **Search:** Text queries are sent to OpenStreetMap's Nominatim geocoding service to find and display locations on the map.
- **POI Finder:** Search queries and map bounds are sent to OpenStreetMap's Overpass API to find points of interest in the current map view.
- **Strava Integration:** Communicates directly with the Strava API after user authorization.
- **OpenStreetMap Contributions:** Communicates directly with the OpenStreetMap API after user authorization to submit notes and map contributions.
- **Analytics:** If Google Analytics is configured, anonymous usage data is sent to Google to help understand how the application is used.

---

## Local Development Setup

This project is self-contained and does not require a package manager (`npm`).

1.  **Clone the Repository**

    ```bash
    git clone [https://github.com/mapdraw/mapdraw](https://github.com/mapdraw/mapdraw)
    ```

2.  **Provide API Keys**
    See the **"Configuring API Keys"** section below for detailed instructions.

3.  **Run the Application**
    Local development requires running the project from a local web server. Opening `index.html` directly from your filesystem will not work correctly.

4.  **Code Formatting**
    The project uses the Prettier CLI (rather than the VS Code extension) to ensure consistent formatting across all environments. It is configured with a 100-character line width in [.prettierrc](.prettierrc).
    - **Via CLI**: Format a specific file with `npx prettier --write "path/to/file"` (requires Node.js).
    - **Via VS Code**: Run the "Format with Prettier CLI" task (Terminal > Run Task...).
    - **Pro Tip**: Check the comments in [.vscode/tasks.json](.vscode/tasks.json) for instructions on how to bind this task to the standard Shift+Alt+F shortcut.

---

## Production Deployment

Deployment to GitHub Pages is handled automatically by the GitHub Action located in `.github/workflows/deploy.yml`. The action runs automatically on every push to the `main` branch.

**In addition to deploying the site, the workflow also performs critical performance optimizations. It bundles all JavaScript files located between the `<!-- START-BUNDLE -->` and `<!-- END-BUNDLE -->` comments in `index.html` into a single script, minifies it to reduce its size, and updates `index.html` to load the final optimized file (`app.min.js`).**

> The workflow also replaces the branding placeholders in `index.html` and `manifest.json` with the values from `js/config.js`. **You do not need to edit these files manually.**

---

## Configuring API Keys

To enable features that rely on external services, you must provide your own API keys.

### A. For Local Development

1.  Make a copy of the template file `js/secrets.js.example`.
2.  Rename the copy to **`js/secrets.js`**.
3.  Open the new `js/secrets.js` and fill in your actual API keys using the following `camelCase` variable names:
    - `googleApiKey`
    - `mapboxAccessToken`
    - `osmClientId`
    - `stravaClientId` (Optional)
    - `stravaClientSecret` (Optional)

> The `secrets.js` file is listed in `.gitignore` and will not be committed to the repository, keeping your keys safe.

### B. For Production Deployment

1.  In your GitHub repository, go to **Settings > Secrets and variables > Actions**.
2.  Click **New repository secret** for each key listed below, ensuring the names match the `SNAKE_CASE` format exactly:
    - `GOOGLE_API_KEY`
    - `MAPBOX_ACCESS_TOKEN`
    - `OSM_CLIENT_ID`
    - `STRAVA_CLIENT_ID` (Optional)
    - `STRAVA_CLIENT_SECRET` (Optional)
    - `GA_MEASUREMENT_ID` (Optional — Google Analytics)

### Important API Notes

> **Google API Note:** Your `GOOGLE_API_KEY` must have the following APIs enabled in your Google Cloud Platform project:
>
> - **Geolocation API** (for automatic map centering based on user location)
> - **Maps Elevation API** (for elevation profiles)
> - **Maps JavaScript API** (required dependency for the Maps Elevation API)

> **OpenStreetMap API Note:** When registering your OAuth 2 application at openstreetmap.org (for testing: master.apis.dev.openstreetmap.org), make sure to set the redirect URI to `https://YOUR_DOMAIN/osm-callback.html`, uncheck **Confidential application**, and enable the following permissions:
>
> - Read user preferences (`read_prefs`)
> - Modify the map (`write_api`)
> - Modify notes (`write_notes`)

> **GeoAdmin API Note:** The GeoAdmin API is free and does not require an API key. It only works for paths within Switzerland.

> **Strava API Note:** If you leave the `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` fields empty or do not provide them as secrets, the application will instead prompt end-users to provide their own personal API keys to use the integration.

---

## Plugins & Libraries Used

This project utilizes several open-source libraries, which are included in the repository.

- **codemirror-6.65.7**
  - Download URL: <https://registry.npmjs.org/codemirror/-/codemirror-6.65.7.tgz>
- **d3-7.9.0**
  - Download URL: <https://d3js.org/d3.v7.min.js>
- **flag-icons-7.5.0**
  - Download URL: <https://github.com/lipis/flag-icons/archive/refs/tags/v7.5.0.zip>
- **idb-keyval-6.2.2**
  - Download URL: <https://registry.npmjs.org/idb-keyval/-/idb-keyval-6.2.2.tgz>
- **jszip-3.10.1**
  - Download URL: <https://registry.npmjs.org/jszip/-/jszip-3.10.1.tgz>
- **leaflet-1.9.4**
  - Download URL: <https://github.com/Leaflet/Leaflet/releases/download/v1.9.4/leaflet.zip>
- **leaflet-draw-1.0.4**
  - Download URL: <https://registry.npmjs.org/leaflet-draw/-/leaflet-draw-1.0.4.tgz>
- **leaflet-geosearch-4.2.2**
  - Download URL: <https://registry.npmjs.org/leaflet-geosearch/-/leaflet-geosearch-4.2.2.tgz>
- **leaflet-locatecontrol-0.85.1**
  - Download URL: <https://registry.npmjs.org/leaflet.locatecontrol/-/leaflet.locatecontrol-0.85.1.tgz>
- **leaflet-markercluster-1.5.3**
  - Download URL: <https://registry.npmjs.org/leaflet.markercluster/-/leaflet.markercluster-1.5.3.tgz>
- **leaflet-routing-machine-3.2.12**
  - Download URL: <https://registry.npmjs.org/leaflet-routing-machine/-/leaflet-routing-machine-3.2.12.tgz>
- **polyline-encoded-0.0.9**
  - Download URL: <https://registry.npmjs.org/polyline-encoded/-/polyline-encoded-0.0.9.tgz>
- **proj4-2.20.2**
  - Download URL: <https://registry.npmjs.org/proj4/-/proj4-2.20.2.tgz>
- **simplify-js-1.2.4**
  - Download URL: <https://registry.npmjs.org/simplify-js/-/simplify-js-1.2.4.tgz>
- **sortablejs-1.15.6**
  - Download URL: <https://registry.npmjs.org/sortablejs/-/sortablejs-1.15.6.tgz>
- **sweetalert2-11.26.17**
  - Download URL: <https://registry.npmjs.org/sweetalert2/-/sweetalert2-11.26.17.tgz>
- **togeojson-0.16.2**
  - Download URL: <https://github.com/mapbox/togeojson/archive/refs/tags/0.16.2.zip>

---

## License

Copyright (C) 2026 Aron Sommer.

This project is licensed under the GNU Affero General Public License v3.0. See the [LICENSE](LICENSE) file for full details.
