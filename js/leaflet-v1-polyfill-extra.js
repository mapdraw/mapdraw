// Extra patches for Leaflet 2 not covered by leaflet-v1-polyfill.js.
// Loaded after leaflet-global.js, leaflet-v1-polyfill.js, and applyAllPolyfills(), but before plugins.

// --- Fractional map-pane offsets ---
// Leaflet 2 drives Draggable from pointer events; v1 used mouse events for mouse
// input. Chrome reports fractional clientX/clientY on PointerEvent but integral
// values on MouseEvent, so a mouse drag now leaves the map pane on a fractional
// CSS pixel, and every tile edge with it, which Chromium paints as hairline
// seams. Draggable is the only path that leaves the pane fractional once
// movement stops, so round here. Rounding runs after `predrag` because Map.Drag
// rewrites _newPos in that handler. Mirrors _updatePosition as of
// 2.0.0-alpha.1 - recheck the upstream body when upgrading Leaflet.
// Reported upstream: https://github.com/Leaflet/Leaflet/issues/9731
L.Draggable.prototype._updatePosition = function () {
  var e = { originalEvent: this._lastEvent };
  this.fire("predrag", e);
  this._newPos = this._newPos.round();
  L.DomUtil.setPosition(this._element, this._newPos);
  this.fire("drag", e);
};

// --- L.Mixin.Events ---
// The official polyfill binds each method to Evented.prototype, so when plugins
// copy them via `includes: L.Mixin.Events` and Object.assign, `this` inside the
// method points to the prototype instead of the instance. Override with unbound
// methods so `this` resolves correctly at call time.
var _eventedMethods = {};
Object.getOwnPropertyNames(L.Evented.prototype).forEach(function (name) {
  if (name !== "constructor") {
    _eventedMethods[name] = L.Evented.prototype[name];
  }
});
L.Mixin = { Events: _eventedMethods };
L.Events = _eventedMethods;

// --- L.Class.addInitHook ---
// applyClassPolyfill patches Class.extend but omits `proto._initHooks = []`.
// Leaflet 2's addInitHook then uses ??= which reads _initHooks from the prototype
// chain instead of creating an own array. This causes related classes (Polyline,
// Polygon, Rectangle) to all push into a single shared array on Polyline.prototype.
// Consequence: every shape runs all three edit-mode init hooks and the last one
// (Edit.Rectangle) wins, so polylines and polygons get the wrong editor, wrong
// vertex handles, and setBounds errors. Fix by always creating an own _initHooks
// array on the target class before pushing. Mirrors addInitHook as of
// 2.0.0-alpha.1 apart from that guard - recheck the upstream body when
// upgrading Leaflet.
L.Class.addInitHook = function (fn) {
  var args = Array.prototype.slice.call(arguments, 1);
  var init =
    typeof fn === "function"
      ? fn
      : function () {
          this[fn].apply(this, args);
        };
  if (!Object.prototype.hasOwnProperty.call(this.prototype, "_initHooks")) {
    this.prototype._initHooks = [];
  }
  this.prototype._initHooks.push(init);
  return this;
};

// --- L.Polygon.prototype.setBounds ---
// Side-effect of the init hook pollution above: before the addInitHook fix,
// polygons and polylines received Edit.Rectangle as their editor. Edit.Rectangle
// calls this._shape.setBounds() during vertex drag. L.Polygon has no setBounds
// in Leaflet 2 (only L.Rectangle does). Keep this shim as a safety net in case
// any other code path reaches setBounds on a plain Polygon.
if (!L.Polygon.prototype.setBounds) {
  L.Polygon.prototype.setBounds = function (latLngBounds) {
    var sw = latLngBounds.getSouthWest();
    var ne = latLngBounds.getNorthEast();
    return this.setLatLngs([[sw, { lat: sw.lat, lng: ne.lng }, ne, { lat: ne.lat, lng: sw.lng }]]);
  };
}

// --- LayerGroup.prototype.invoke guard ---
// In Leaflet 2, _layers is initialised in initialize(), not on the prototype.
// Old plugins that override initialize without calling super (e.g. MarkerCluster)
// never set _layers, so invoke()'s Object.values(this._layers) throws. Guard
// against that by defaulting _layers to {} on first invoke call.
var _origInvoke = L.LayerGroup.prototype.invoke;
L.LayerGroup.prototype.invoke = function () {
  if (!this._layers) {
    this._layers = {};
  }
  return _origInvoke.apply(this, arguments);
};
