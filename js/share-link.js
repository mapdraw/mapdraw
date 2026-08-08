// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * SHARE LINK
 *
 * Encodes/decodes the current map state (view + features) into a compact,
 * gzip-compressed, base64url string embedded in the page URL hash, so a
 * map can be shared via link without any server-side storage.
 */

// Share link data format version (the `v` key in the encoded payload).
const SHARE_LINK_FORMAT_VERSION = 1;

/**
 * Collects all chunks from a ReadableStream into a single Uint8Array.
 *
 * @param {ReadableStream<Uint8Array>} readable
 * @returns {Promise<Uint8Array>}
 */
async function collectStream(readable) {
  const chunks = [];
  const reader = readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Encodes text using gzip compression and base64url encoding.
 * Uses the native browser CompressionStream API — no external library required.
 * Base64url (RFC 4648) replaces + with -, / with _, and strips = padding,
 * making the output safe to use directly in URL hashes without percent-encoding.
 *
 * @param {string} text - UTF-8 text to compress
 * @returns {Promise<string>} base64url-encoded gzip-compressed string
 */
async function gzipEncode(text) {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(new TextEncoder().encode(text));
  writer.close();
  const bytes = await collectStream(stream.readable);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Decodes a gzip+base64url encoded string back to the original text.
 *
 * @param {string} encoded - base64url-encoded gzip-compressed string
 * @returns {Promise<string>} decompressed UTF-8 text
 */
async function gzipDecode(encoded) {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  // Suppress write-side rejections: errors on corrupt input propagate through
  // the readable side and are caught by the outer try/catch in importMapStateFromUrl.
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const result = await collectStream(stream.readable);
  return new TextDecoder().decode(result);
}

/**
 * Builds the compact, Polyline-encoded representation of all map features.
 *
 * Compact schema: { v: 1, f: [...features] }
 * Each feature: { t, c, n?, s?, e?, sid? }
 *   t:   "m"=marker, "p"=polyline, "a"=polygon (area)
 *   c:   [lng, lat] for markers (6 decimals); Polyline-encoded string for paths (precision 5 = ~1.1m)
 *   n:   name (omitted if empty)
 *   s:   color hex without # (omitted if DEFAULT_COLOR; # restored by parseColor() inside importGeoJsonToMap)
 *   e:   elevation — integer for markers, integer array for paths (omitted if absent or all zeros)
 *   sid: Strava activity ID (omitted if not a Strava import)
 *
 * Polyline encoding shrinks coordinate sequences far more than any general compressor can,
 * making it the dominant factor in URL length reduction. Short property names and omitted
 * defaults reduce the remaining JSON overhead before gzip is applied.
 *
 * @param {Array} [layers] - Specific layers to include; defaults to everything
 *   on the map when omitted.
 * @returns {{ v: number, f: Array }|null} Compact object, or null if no exportable layers
 */
function buildCompactObject(layers = null) {
  const allLayers = layers || getAllExportableLayers();
  if (allLayers.length === 0) return null;

  const features = [];

  allLayers.forEach((layer) => {
    try {
      const feature = {
        t: "", // type: m=marker, p=polyline, a=polygon (area)
        c: null, // coordinates (encoded for paths, array for markers)
      };

      // Add name, color, and stravaId only if present
      const name = layer.feature?.properties?.name;
      const color = getLayerColor(layer);
      const stravaId = layer.feature?.properties?.stravaId;
      if (name) feature.n = name;
      // Strip # prefix from hex color for URL efficiency (auto-restored by parseColor() inside importGeoJsonToMap)
      if (color && color !== DEFAULT_COLOR) {
        feature.s = color.startsWith("#") ? color.slice(1) : color;
      }
      if (stravaId) feature.sid = stravaId;

      if (layer instanceof L.Marker) {
        const ll = layer.getLatLng();
        if (ll) {
          feature.t = "m";
          feature.c = [+ll.lng.toFixed(6), +ll.lat.toFixed(6)];
          if (typeof ll.alt === "number" && ll.alt !== 0) {
            feature.e = Math.round(ll.alt);
          }
        }
      } else if (layer instanceof L.Polygon) {
        const latlngs = layer.getLatLngs()[0];
        if (latlngs && latlngs.length > 0) {
          feature.t = "a";
          feature.c = L.PolylineUtil.encode(latlngs, 5);
          // Add elevation if all points have it and there's variation (not all zeros)
          const elevations = latlngs.map((ll) => ll.alt).filter((e) => typeof e === "number");
          const hasVariation = elevations.some((e) => e !== 0);
          if (elevations.length === latlngs.length && hasVariation) {
            feature.e = elevations.map((e) => Math.round(e));
          }
        }
      } else if (layer instanceof L.Polyline) {
        const latlngs = flattenRingPoints(layer.getLatLngs());
        if (latlngs && latlngs.length > 0) {
          feature.t = "p";
          feature.c = L.PolylineUtil.encode(latlngs, 5);
          // Add elevation if all points have it and there's variation (not all zeros)
          const elevations = latlngs.map((ll) => ll.alt).filter((e) => typeof e === "number");
          const hasVariation = elevations.some((e) => e !== 0);
          if (elevations.length === latlngs.length && hasVariation) {
            feature.e = elevations.map((e) => Math.round(e));
          }
        }
      }

      // Only include features with valid type and coordinates
      if (feature.t && feature.c) {
        features.push(feature);
      }
    } catch (error) {
      console.error("Error converting layer for URL sharing:", error, layer);
    }
  });

  if (features.length === 0) return null;
  return { v: SHARE_LINK_FORMAT_VERSION, f: features };
}

/**
 * Encodes the current map state to a gzip-compressed, base64url-encoded string.
 * Builds the compact feature representation via buildCompactObject(), serializes to JSON,
 * then compresses with gzip and encodes as base64url for safe embedding in URL hashes.
 *
 * URL Length: "In general, the web platform does not have limits on the length of URLs
 * (although 2^31 is a common limit). Chrome limits URLs to a maximum length of 2MB for
 * practical reasons and to avoid causing denial-of-service problems in inter-process communication."
 * See: https://chromium.googlesource.com/chromium/src/+/HEAD/docs/security/url_display_guidelines/url_display_guidelines.md#URL-Length
 *
 * @param {Array} [layers] - Specific layers to include; defaults to everything
 *   on the map when omitted.
 * @returns {Promise<string|null>} Encoded map state, or null if no data to share
 */
async function encodeMapStateToUrl(layers = null) {
  const compact = buildCompactObject(layers);
  if (!compact) return null;
  return gzipEncode(JSON.stringify(compact));
}

/**
 * Builds a shareable URL containing the current map view and all features.
 * Combines the map position (#map=zoom/lat/lon) with compressed feature data (&data=...).
 * The data parameter contains all markers, polylines, and polygons encoded using
 * Polyline encoding and gzip+base64url compression.
 *
 * @param {Array} [layers] - Specific layers to include; defaults to everything
 *   on the map when omitted.
 * @returns {Promise<string|null>} Full shareable URL with hash parameters, or null if no features exist
 */
async function buildShareableUrl(layers = null) {
  const mapState = await encodeMapStateToUrl(layers);
  if (!mapState) return null;

  const center = map.getCenter();
  const zoom = map.getZoom();

  const baseUrl = window.location.origin + window.location.pathname;
  const hashParams = `#map=${zoom}/${center.lat.toFixed(6)}/${center.lng.toFixed(6)}&data=${mapState}`;

  return baseUrl + hashParams;
}

/**
 * Imports and decompresses map state from a shareable URL parameter.
 * Decodes the base64url string, decompresses with gzip, decodes Polyline-encoded
 * coordinates, converts to GeoJSON format, and adds all features to the map.
 *
 * Process:
 * 1. Decodes base64url and decompresses with gzip
 * 2. Parses the JSON structure (v=version, f=features array)
 * 3. For each feature, decodes based on type:
 *    - "m" (marker): coordinates used as-is [lng, lat] or [lng, lat, elevation]
 *    - "p" (polyline): Polyline-decoded path (precision 5), elevation applied if present
 *    - "a" (polygon/area): Polyline-decoded path (precision 5), elevation applied if present, ring closed by appending first coordinate
 * 4. Reconstructs full GeoJSON Feature objects with properties and elevation
 * 5. Adds the FeatureCollection to the map
 *
 * @param {string} encoded - base64url-encoded gzip-compressed map state
 * @returns {Promise<boolean>} True if import was successful, false if decompression/parsing failed
 */
async function importMapStateFromUrl(encoded) {
  try {
    const jsonString = await gzipDecode(encoded);
    if (!jsonString) throw new Error("Failed to decompress data");

    const data = JSON.parse(jsonString);
    if (!data.v) throw new Error("Invalid data format: missing version");
    if (data.v !== SHARE_LINK_FORMAT_VERSION) {
      throw new Error(`Unsupported data version: ${data.v}`);
    }
    if (!data.f || !Array.isArray(data.f)) {
      throw new Error("Invalid data format");
    }

    const features = [];

    data.f.forEach((item) => {
      try {
        const feature = {
          type: "Feature",
          properties: {
            name: item.n || "",
            color: item.s || DEFAULT_COLOR,
          },
          geometry: null,
        };

        // Add stravaId if present
        if (item.sid) {
          feature.properties.stravaId = item.sid;
        }

        if (item.t === "m") {
          const coords = [...item.c];
          if (typeof item.e === "number") coords.push(item.e);
          feature.geometry = { type: "Point", coordinates: coords };
        } else if (item.t === "p") {
          const decoded = L.PolylineUtil.decode(item.c, 5);
          feature.geometry = {
            type: "LineString",
            coordinates: decoded.map(([lat, lng], idx) => {
              const coord = [lng, lat];
              if (item.e && typeof item.e[idx] === "number") coord.push(item.e[idx]);
              return coord;
            }),
          };
        } else if (item.t === "a") {
          const decoded = L.PolylineUtil.decode(item.c, 5);
          const ring = decoded.map(([lat, lng], idx) => {
            const coord = [lng, lat];
            if (item.e && typeof item.e[idx] === "number") coord.push(item.e[idx]);
            return coord;
          });
          if (ring.length > 0) ring.push([...ring[0]]);
          feature.geometry = {
            type: "Polygon",
            coordinates: [ring],
          };
        }

        if (feature.geometry) features.push(feature);
      } catch (e) {
        console.warn("Could not decode feature:", e);
      }
    });

    if (features.length === 0) throw new Error("No valid features");

    importGeoJsonToMap({ type: "FeatureCollection", features }, "geojson");
    return true;
  } catch (error) {
    console.error("Error importing map state from URL:", error);
    return false;
  }
}
