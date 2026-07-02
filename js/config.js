// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

const APP_NAME = "MapDraw.net"; // Used throughout the app as name
const APP_NAME_PWA = "MapDraw"; // Used in the PWA manifest
// prettier-ignore
const APP_TITLE = "MapDraw: Draw on Map, GPS, GPX, KML & GeoJSON Editor"; // Used in the HTML <title> tag
// prettier-ignore
const APP_DESCRIPTION = "Free online GPX, KML, KMZ & GeoJSON viewer & editor. Draw, view & edit GPS tracks with routing, elevation profiles & Strava integration."; // Used in <meta name="description">
const APP_DOMAIN = "www.mapdraw.net"; // Used for Strava setup instructions
const OSM_CREATED_BY = "MapDraw"; // OSM changeset created_by tag

const BREAKPOINT_MOBILE = 768; // Mobile breakpoint; matches style.css's @media (max-width: 768px)

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

let enablePathSimplification = localStorage.getItem("enablePathSimplification") !== "false";
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

/**
 * Simplification settings for imported paths (GPX, KML, KMZ).
 * Tolerance is in decimal degrees (~0.00005° ≈ 5.5m at equator).
 */
const pathSimplificationConfig = {
  TOLERANCE: 0.00015,
  MIN_POINTS: 100,
};

/**
 * Simplification settings for generated routes from routing engines.
 */
const routeSimplificationConfig = {
  TOLERANCE: 0.00015,
  MIN_POINTS: 100,
};
