// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Leaflet core patches
// Small, targeted fixes for core Leaflet (not leaflet-draw - see
// leaflet-draw-patches.js for those). Applied once at load time since they
// patch shared prototypes, not any particular map instance.

// unproject's latitude formula (atan) asymptotes at +-90 deg for any input -
// no clamp needed. Its longitude formula is a plain linear scale with no
// such limit, so any click, drag, or draw could yield a raw longitude past
// +-180 deg. Clamp it here - the one function every pixel-to-coordinate
// conversion in the app calls - so longitude is as unreachable past +-180
// deg as latitude already is past +-90.
const originalUnproject = L.Projection.SphericalMercator.unproject;
L.Projection.SphericalMercator.unproject = function (point) {
  const latlng = originalUnproject.call(this, point);
  return L.latLng(latlng.lat, Math.max(-180, Math.min(180, latlng.lng)));
};
