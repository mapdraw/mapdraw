// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * Leaflet WMS Layer with Gutter Support
 *
 * Extends Leaflet's TileLayer.WMS to add gutter support, preventing icons/symbols
 * from being cut off at tile boundaries. Inspired by OpenLayers' TileWMS gutter feature.
 *
 * The gutter adds extra pixels around each tile request, creating overlapping regions
 * between adjacent tiles. This ensures that symbols spanning tile boundaries aren't clipped.
 *
 * Implementation uses canvas rendering (like OpenLayers) to crop gutter pixels from tiles.
 */

L.TileLayer.WMS.Gutter = L.TileLayer.WMS.extend({
  options: {
    gutter: 0, // Default: no gutter (standard behavior)
  },

  initialize: function (url, options) {
    L.TileLayer.WMS.prototype.initialize.call(this, url, options);
    this._gutter = this.options.gutter || 0;
  },

  getTileUrl: function (coords) {
    if (!this._url) return "";
    var tileBounds = this._tileCoordsToNwSe(coords),
      crs = this._crs,
      nw = crs.project(tileBounds[0]),
      se = crs.project(tileBounds[1]),
      min = nw,
      max = se;

    // If gutter is set, expand the bounds
    if (this._gutter > 0) {
      var tileSize = this.getTileSize();
      var bboxWidth = se.x - nw.x;
      var bboxHeight = se.y - nw.y;

      // Calculate the actual resolution (map units per pixel)
      var resolutionX = bboxWidth / tileSize.x;
      var resolutionY = bboxHeight / tileSize.y;

      // Expand by (resolution * gutter) in each direction
      var gutterX = resolutionX * this._gutter;
      var gutterY = resolutionY * this._gutter;

      min = L.point(nw.x - gutterX, nw.y - gutterY);
      max = L.point(se.x + gutterX, se.y + gutterY);
    }

    // Build BBOX (same logic as Leaflet core)
    var bbox =
      this._wmsVersion >= 1.3 && this._crs === L.CRS.EPSG4326
        ? [min.y, min.x, max.y, max.x].join(",")
        : [min.x, max.y, max.x, min.y].join(",");

    // Build WMS params with gutter-adjusted dimensions
    var params = L.extend({}, this.wmsParams);
    var tileSize = this.getTileSize();
    params.width = tileSize.x + this._gutter * 2;
    params.height = tileSize.y + this._gutter * 2;

    // Get base tile URL
    var url = L.TileLayer.prototype.getTileUrl.call(this, coords);

    // Add WMS params and BBOX
    return (
      url +
      L.Util.getParamString(params, url, this.options.uppercase) +
      (this.options.uppercase ? "&BBOX=" : "&bbox=") +
      bbox
    );
  },

  createTile: function (coords, done) {
    var tileSize = this.getTileSize();

    // If no gutter, use standard img tile
    if (this._gutter === 0) {
      return L.TileLayer.WMS.prototype.createTile.call(this, coords, done);
    }

    // Create canvas for rendering (like OpenLayers does)
    var canvas = L.DomUtil.create("canvas", "leaflet-tile");
    canvas.width = tileSize.x;
    canvas.height = tileSize.y;
    canvas.onselectstart = L.Util.falseFn;
    canvas.onmousemove = L.Util.falseFn;

    // Load the image (with gutter) and crop it to canvas
    var img = new Image();
    img.crossOrigin = this.options.crossOrigin === true ? "" : this.options.crossOrigin;

    var self = this;
    img.onload = function () {
      var ctx = canvas.getContext("2d");

      // Use 9-parameter drawImage to crop gutter pixels (OpenLayers technique)
      // drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
      ctx.drawImage(
        img,
        self._gutter, // source x: skip gutter pixels from left
        self._gutter, // source y: skip gutter pixels from top
        tileSize.x, // source width: use center portion only
        tileSize.y, // source height: use center portion only
        0, // dest x: start at canvas origin
        0, // dest y: start at canvas origin
        tileSize.x, // dest width: fill canvas
        tileSize.y, // dest height: fill canvas
      );

      // Call done callback
      L.Util.requestAnimFrame(function () {
        done(null, canvas);
      });
    };

    img.onerror = function () {
      done(new Error("Failed to load tile"), canvas);
    };

    // Start loading the image
    img.src = this.getTileUrl(coords);

    return canvas;
  },
});

/**
 * Factory function for creating WMS layers with gutter support
 * @param {string} url - WMS service URL
 * @param {Object} options - Layer options (same as L.tileLayer.wms, plus 'gutter')
 * @returns {L.TileLayer.WMS.Gutter} WMS layer with gutter support
 */
L.tileLayer.wms.gutter = function (url, options) {
  return new L.TileLayer.WMS.Gutter(url, options);
};
