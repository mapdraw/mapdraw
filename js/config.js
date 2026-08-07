// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * LAYER DATA MODEL
 *
 * Every item on the map splits its data across two places:
 *
 * layer.feature.properties - portable GeoJSON content only:
 *   - the source's own content (description, stravaId, ...), carried through untouched
 *   - a `name`, guaranteed non-empty at creation time by every site that makes a layer
 *   - the item's color, under its simplestyle-spec key: "stroke" for paths and areas,
 *     "marker-color" for markers. Always read/written via getLayerColor()/setLayerColor(),
 *     which keeps exactly one of the two keys so a re-import can't pick up the wrong one.
 *   The app owns presentation, so an imported file's own style keys are dropped on import
 *   rather than kept as styling that was never applied (see DISCARDED_STYLE_PROPERTIES).
 *   layerToPortableFeature() turns this into the feature the GeoJSON Editor tab shows, a
 *   GeoJSON export writes, and autosave stores - identical per feature and unfiltered
 *   (each consumer covers its own set of layers), so anything put here ends up in the
 *   user's exported file.
 *
 * layer.internal - the app's own state, meaningless outside it:
 *   - pathType: origin/category ("drawn", "route", "strava", or the import's file type).
 *     getGroupTitle() maps it to the overview-list group, the layer group an item belongs to,
 *     and the KML export's folders; it also selects the info panel's item type and edit hint,
 *     the "original Strava GPX" download row, a selected path's z-index handling, and whether
 *     the elevation panel offers file elevation.
 *   - isManuallyHidden: per-item visibility override, flipped by toggleLayerVisibility()
 *   Never write these into feature.properties. Leaflet's toGeoJSON() reads only layer.feature,
 *   so this object stays out of the editor and every export by construction - no filtering
 *   needed anywhere. Autosave persists it in a sibling `internal` key, since that record is
 *   the app's own format rather than a GeoJSON document.
 */

const APP_NAME = "MapDraw.net"; // Used throughout the app as name
const APP_NAME_PWA = "MapDraw"; // Used in the PWA manifest
// prettier-ignore
const APP_TITLE = "MapDraw: Draw on Map, GPS, GPX, KML & GeoJSON Editor"; // Used in the HTML <title> tag
// prettier-ignore
const APP_DESCRIPTION = "Free online GPX, KML, KMZ & GeoJSON viewer & editor. Draw, view & edit GPS tracks with routing, elevation profiles & Strava integration."; // Used in <meta name="description">
const APP_DOMAIN = "www.mapdraw.net"; // Used for Strava setup instructions
const OSM_CREATED_BY = "MapDraw"; // OSM changeset created_by tag

const BREAKPOINT_MOBILE = 768; // Mobile breakpoint; matches style.css's @media (max-width: 768px)

// Overview-list "focus" (click an item to jump the map to it)
const OVERVIEW_FOCUS_MARKER_ZOOM = 15; // Fixed zoom level used when focusing a marker
const OVERVIEW_FOCUS_PATH_MARGIN_RATIO = 0.3; // Empty margin around a focused path, as a fraction of the viewport (0 = none, 1 = whole viewport)
const OVERVIEW_FOCUS_MOBILE_VERTICAL_SHIFT = 0.15; // Fraction of viewport height to shift the focused view up on mobile (negative shifts it down)

// Canonical world extent: the map's maxBounds (restricts panning) and every
// tile layer's bounds option. Needs noWrap alongside it - without noWrap,
// Leaflet wraps a tile's bounds into range before checking them, so bounds
// alone won't reject repeats.
const WORLD_BOUNDS = [
  [-90, -180],
  [90, 180],
];

// A bit wider than WORLD_BOUNDS so panning doesn't snap tight to the edges.
const MAP_MAX_BOUNDS = L.latLngBounds(WORLD_BOUNDS).pad(0.1);

// Core Application Colors
const DEFAULT_COLOR = "#DC143C"; // Crimson
const ROUTE_COLOR = "#FFD700"; // Gold
const STRAVA_COLOR = "#FC5200"; // Official Strava orange

// UI & Routing Colors (Dynamically fetched from CSS variables in style.css)
const rootStyles = getComputedStyle(document.documentElement);
const ROUTING_COLOR_START = rootStyles.getPropertyValue("--routing-color-start").trim();
const ROUTING_COLOR_END = rootStyles.getPropertyValue("--routing-color-end").trim();
const ROUTING_COLOR_VIA = rootStyles.getPropertyValue("--routing-color-via").trim();
const COLOR_BLACK = rootStyles.getPropertyValue("--color-black").trim();
const COLOR_WHITE = rootStyles.getPropertyValue("--color-white").trim();
const LOCATE_COLOR = rootStyles.getPropertyValue("--locate-color").trim();

/**
 * 16 standard CSS colors for the picker palette.
 * Uses official CSS color names with their correct hex values.
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/named-color
 * @see https://www.w3schools.com/tags/ref_colornames.asp
 */
const COLOR_PALETTE = [
  { name: "Crimson", hex: "#DC143C" },
  { name: "Deep Pink", hex: "#FF1493" },
  { name: "Dark Orchid", hex: "#9932CC" },
  { name: "Slate Blue", hex: "#6A5ACD" },
  { name: "Royal Blue", hex: "#4169E1" },
  { name: "Dodger Blue", hex: "#1E90FF" },
  { name: "Dark Turquoise", hex: "#00CED1" },
  { name: "Light Sea Green", hex: "#20B2AA" },
  { name: "Forest Green", hex: "#228B22" },
  { name: "Yellow Green", hex: "#9ACD32" },
  { name: "Gold", hex: "#FFD700" },
  { name: "Dark Orange", hex: "#FF8C00" },
  { name: "Tomato", hex: "#FF6347" },
  { name: "Sienna", hex: "#A0522D" },
  { name: "Dim Gray", hex: "#696969" },
  { name: "Slate Gray", hex: "#708090" },
];

let lineThickness = parseInt(localStorage.getItem("lineThickness")) || 10;

/**
 * Centralized style configuration for paths and markers.
 */
const STYLE_CONFIG = {
  path: {
    default: {
      weight: lineThickness,
      opacity: 0.75,
      fill: false,
    },
    highlight: {
      weight: lineThickness,
      opacity: 1,
      fill: false,
      outline: {
        enabled: true,
        color: COLOR_BLACK,
        weightOffset: 4,
        fillOpacity: 0.15,
      },
    },
  },
  marker: {
    baseSize: 50,
    default: {
      opacity: 0.75,
    },
    highlight: {
      opacity: 1,
      outline: {
        enabled: true,
        color: COLOR_BLACK,
        sizeOffset: 4,
        anchorOffsetY: -4,
      },
    },
  },
};
