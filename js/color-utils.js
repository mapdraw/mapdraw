// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * CSS COLOR UTILITIES
 *
 * Provides color parsing and normalization for import/export.
 * Supports all 148 CSS color name keywords and hex values.
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/named-color
 * @see https://www.w3schools.com/tags/ref_colornames.asp
 */

/**
 * All 148 CSS Color Level 4 named color keywords mapped to their hex values.
 * Sorted alphabetically. Names are lowercase for case-insensitive lookup.
 * @see https://drafts.csswg.org/css-color-4/#named-colors
 */
const CSS_COLOR_NAMES = {
  aliceblue: "#F0F8FF",
  antiquewhite: "#FAEBD7",
  aqua: "#00FFFF",
  aquamarine: "#7FFFD4",
  azure: "#F0FFFF",
  beige: "#F5F5DC",
  bisque: "#FFE4C4",
  black: "#000000",
  blanchedalmond: "#FFEBCD",
  blue: "#0000FF",
  blueviolet: "#8A2BE2",
  brown: "#A52A2A",
  burlywood: "#DEB887",
  cadetblue: "#5F9EA0",
  chartreuse: "#7FFF00",
  chocolate: "#D2691E",
  coral: "#FF7F50",
  cornflowerblue: "#6495ED",
  cornsilk: "#FFF8DC",
  crimson: "#DC143C",
  cyan: "#00FFFF",
  darkblue: "#00008B",
  darkcyan: "#008B8B",
  darkgoldenrod: "#B8860B",
  darkgray: "#A9A9A9",
  darkgreen: "#006400",
  darkgrey: "#A9A9A9",
  darkkhaki: "#BDB76B",
  darkmagenta: "#8B008B",
  darkolivegreen: "#556B2F",
  darkorange: "#FF8C00",
  darkorchid: "#9932CC",
  darkred: "#8B0000",
  darksalmon: "#E9967A",
  darkseagreen: "#8FBC8F",
  darkslateblue: "#483D8B",
  darkslategray: "#2F4F4F",
  darkslategrey: "#2F4F4F",
  darkturquoise: "#00CED1",
  darkviolet: "#9400D3",
  deeppink: "#FF1493",
  deepskyblue: "#00BFFF",
  dimgray: "#696969",
  dimgrey: "#696969",
  dodgerblue: "#1E90FF",
  firebrick: "#B22222",
  floralwhite: "#FFFAF0",
  forestgreen: "#228B22",
  fuchsia: "#FF00FF",
  gainsboro: "#DCDCDC",
  ghostwhite: "#F8F8FF",
  gold: "#FFD700",
  goldenrod: "#DAA520",
  gray: "#808080",
  green: "#008000",
  greenyellow: "#ADFF2F",
  grey: "#808080",
  honeydew: "#F0FFF0",
  hotpink: "#FF69B4",
  indianred: "#CD5C5C",
  indigo: "#4B0082",
  ivory: "#FFFFF0",
  khaki: "#F0E68C",
  lavender: "#E6E6FA",
  lavenderblush: "#FFF0F5",
  lawngreen: "#7CFC00",
  lemonchiffon: "#FFFACD",
  lightblue: "#ADD8E6",
  lightcoral: "#F08080",
  lightcyan: "#E0FFFF",
  lightgoldenrodyellow: "#FAFAD2",
  lightgray: "#D3D3D3",
  lightgreen: "#90EE90",
  lightgrey: "#D3D3D3",
  lightpink: "#FFB6C1",
  lightsalmon: "#FFA07A",
  lightseagreen: "#20B2AA",
  lightskyblue: "#87CEFA",
  lightslategray: "#778899",
  lightslategrey: "#778899",
  lightsteelblue: "#B0C4DE",
  lightyellow: "#FFFFE0",
  lime: "#00FF00",
  limegreen: "#32CD32",
  linen: "#FAF0E6",
  magenta: "#FF00FF",
  maroon: "#800000",
  mediumaquamarine: "#66CDAA",
  mediumblue: "#0000CD",
  mediumorchid: "#BA55D3",
  mediumpurple: "#9370DB",
  mediumseagreen: "#3CB371",
  mediumslateblue: "#7B68EE",
  mediumspringgreen: "#00FA9A",
  mediumturquoise: "#48D1CC",
  mediumvioletred: "#C71585",
  midnightblue: "#191970",
  mintcream: "#F5FFFA",
  mistyrose: "#FFE4E1",
  moccasin: "#FFE4B5",
  navajowhite: "#FFDEAD",
  navy: "#000080",
  oldlace: "#FDF5E6",
  olive: "#808000",
  olivedrab: "#6B8E23",
  orange: "#FFA500",
  orangered: "#FF4500",
  orchid: "#DA70D6",
  palegoldenrod: "#EEE8AA",
  palegreen: "#98FB98",
  paleturquoise: "#AFEEEE",
  palevioletred: "#DB7093",
  papayawhip: "#FFEFD5",
  peachpuff: "#FFDAB9",
  peru: "#CD853F",
  pink: "#FFC0CB",
  plum: "#DDA0DD",
  powderblue: "#B0E0E6",
  purple: "#800080",
  rebeccapurple: "#663399",
  red: "#FF0000",
  rosybrown: "#BC8F8F",
  royalblue: "#4169E1",
  saddlebrown: "#8B4513",
  salmon: "#FA8072",
  sandybrown: "#F4A460",
  seagreen: "#2E8B57",
  seashell: "#FFF5EE",
  sienna: "#A0522D",
  silver: "#C0C0C0",
  skyblue: "#87CEEB",
  slateblue: "#6A5ACD",
  slategray: "#708090",
  slategrey: "#708090",
  snow: "#FFFAFA",
  springgreen: "#00FF7F",
  steelblue: "#4682B4",
  tan: "#D2B48C",
  teal: "#008080",
  thistle: "#D8BFD8",
  tomato: "#FF6347",
  turquoise: "#40E0D0",
  violet: "#EE82EE",
  wheat: "#F5DEB3",
  white: "#FFFFFF",
  whitesmoke: "#F5F5F5",
  yellow: "#FFFF00",
  yellowgreen: "#9ACD32",
};

/**
 * Normalizes a hex color string to #RRGGBB format.
 * Handles various input formats:
 * - #RGB -> #RRGGBB
 * - #RRGGBB -> #RRGGBB
 * - #AARRGGBB -> #RRGGBB (strips alpha prefix, GPX/Android style)
 * - RRGGBB -> #RRGGBB
 *
 * @param {string} raw - Raw color string
 * @returns {string|null} Normalized hex color or null if invalid
 */
function normalizeHexColor(raw) {
  if (typeof raw !== "string" || !raw) return null;
  let color = raw.trim().toLowerCase();

  // Remove # prefix if present
  if (color.startsWith("#")) {
    color = color.substring(1);
  }

  // Handle #RGB format -> expand to RRGGBB
  if (color.length === 3) {
    color = color
      .split("")
      .map((c) => c + c)
      .join("");
  }

  // Handle #RGBA format -> take RGB portion, expand to RRGGBB (discard alpha)
  if (color.length === 4) {
    color = color
      .substring(0, 3)
      .split("")
      .map((c) => c + c)
      .join("");
  }

  // Handle #AARRGGBB format (GPX/Android style) -> strip alpha prefix
  // Note: 8-digit hex is assumed to be #AARRGGBB (alpha first), not CSS #RRGGBBAA.
  // This matches KML/GPX ecosystem conventions which predate the CSS standard.
  if (color.length === 8) {
    color = color.substring(2);
  }

  // Validate final format
  if (color.length !== 6 || !/^[0-9a-f]{6}$/.test(color)) {
    return null;
  }

  return "#" + color.toUpperCase();
}

/**
 * Parses any color input (hex or CSS name) to normalized #RRGGBB format.
 *
 * @param {string} input - Color name or hex value
 * @returns {string|null} Normalized hex color or null if invalid
 */
function parseColor(input) {
  if (typeof input !== "string" || !input) return null;
  const str = input.trim().toLowerCase();

  // Check if it's a hex color
  if (str.startsWith("#") || /^[0-9a-f]{3,8}$/i.test(str)) {
    return normalizeHexColor(str);
  }

  // Look up CSS color name
  const hex = CSS_COLOR_NAMES[str];
  return hex || null;
}

/**
 * Reads a layer's color from its GeoJSON properties.
 * Color lives under the simplestyle-spec key matching the geometry:
 * "marker-color" for markers, "stroke" for paths and polygons.
 *
 * @param {L.Layer} layer - The Leaflet layer
 * @returns {string} Hex color, or DEFAULT_COLOR if unset
 */
function getLayerColor(layer) {
  const props = layer.feature?.properties || {};
  return (layer instanceof L.Marker ? props["marker-color"] : props.stroke) || DEFAULT_COLOR;
}

/**
 * Writes a layer's color into its GeoJSON properties under the simplestyle-spec
 * key matching the geometry. Only touches data - callers still apply the visual
 * style themselves via setStyle()/setIcon().
 *
 * @param {L.Layer} layer - The Leaflet layer
 * @param {string} hex - Hex color to store
 */
function setLayerColor(layer, hex) {
  layer.feature = layer.feature || {};
  const props = (layer.feature.properties = layer.feature.properties || {});
  // The other geometry's key must go: it would be exported as styling that was
  // never applied, and parseColorFromGeoJsonStyle() would still read it as a
  // fallback on re-import.
  if (layer instanceof L.Marker) {
    delete props.stroke;
    props["marker-color"] = hex;
  } else {
    delete props["marker-color"];
    props.stroke = hex;
  }
}

/**
 * Converts a CSS hex color (#RRGGBB) to KML AABBGGRR format.
 * KML uses reverse byte order with alpha prefix.
 * Falls back to DEFAULT_COLOR if input is invalid.
 *
 * @param {string} cssColor - CSS color string (e.g., "#FF0000")
 * @returns {string} KML color string (e.g., "FF0000FF")
 */
function cssToKmlColor(cssColor) {
  const normalized = normalizeHexColor(cssColor) || normalizeHexColor(DEFAULT_COLOR);
  const rr = normalized.substring(1, 3);
  const gg = normalized.substring(3, 5);
  const bb = normalized.substring(5, 7);
  return `FF${bb}${gg}${rr}`;
}

/**
 * Converts a KML color (AABBGGRR format) to CSS hex color (#RRGGBB).
 * KML uses reverse byte order: Alpha, Blue, Green, Red.
 *
 * Used for importing KML files with inline IconStyle colors (e.g., our own exports).
 * This is the inverse of cssToKmlColor().
 *
 * @param {string} kmlColor - KML color string (e.g., "FF0000FF" for red)
 * @returns {string|null} CSS color string (e.g., "#FF0000") or null if invalid
 */
function kmlToCssColor(kmlColor) {
  if (typeof kmlColor !== "string" || !kmlColor) return null;
  let color = kmlColor.trim().toLowerCase();

  // Remove # prefix if present
  if (color.startsWith("#")) {
    color = color.substring(1);
  }

  // KML colors must be 8 characters: AABBGGRR
  if (color.length !== 8 || !/^[0-9a-f]{8}$/.test(color)) {
    return null;
  }

  // Extract components: AABBGGRR
  const aa = color.substring(0, 2); // Alpha (ignored)
  const bb = color.substring(2, 4); // Blue
  const gg = color.substring(4, 6); // Green
  const rr = color.substring(6, 8); // Red

  // Return in CSS format: #RRGGBB
  return `#${rr}${gg}${bb}`.toUpperCase();
}
