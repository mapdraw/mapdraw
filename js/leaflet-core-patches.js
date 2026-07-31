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

// Control.Scale measures maxWidth px starting at the container's left edge
// (x=0). When noWrap's blank margin is at least maxWidth px wide (zoomed
// out enough that the world is narrower than the viewport by at least
// 2*maxWidth), both measurement points fall inside it and clamp to the
// identical longitude, collapsing the measured distance to zero and
// leaving the scale bar blank. Measure the same maxWidth centered on the
// viewport instead - the map's own center is never in the blank margin,
// so neither point clamps. distance() only depends on latitude and the
// longitude delta between the two points, never their absolute position,
// so this is identical to the original wherever it already worked.
L.Control.Scale.prototype._update = function () {
  const map = this._map;
  const size = map.getSize();
  const y = size.y / 2;
  const halfWidth = this.options.maxWidth / 2;
  const maxMeters = map.distance(
    map.containerPointToLatLng([size.x / 2 - halfWidth, y]),
    map.containerPointToLatLng([size.x / 2 + halfWidth, y]),
  );
  this._updateScales(maxMeters);
};

// Canvas's _containsPoint substitutes for SVG's pointer-events: visiblePainted, but
// ray-casts the interior regardless of fill - an unfilled polygon becomes clickable
// everywhere inside it. Skip that for fill: false, keep only the shared stroke test.
const originalPolygonContainsPoint = L.Polygon.prototype._containsPoint;
L.Polygon.prototype._containsPoint = function (p) {
  if (this.options.fill === false) {
    return L.Polyline.prototype._containsPoint.call(this, p, true);
  }
  return originalPolygonContainsPoint.call(this, p);
};
