// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * Lets a finished path be continued later, and two paths be joined into one.
 * While the path draw tool is active, every existing path's two endpoints
 * are shown as dots. Snapping the first vertex onto one extends that path
 * from there. Snapping any later vertex onto a *different* path's endpoint
 * attaches the new segment to that path too, finishing the shape
 * immediately - if both happen in the same session, the two existing paths
 * become one, with the absorbed path's name/color discarded in favor of the
 * path being extended.
 */

const PATH_EXTEND_SNAP_RADIUS_PX = 20;

function pathExtendIsExtendablePolyline(layer) {
  return layer instanceof L.Polyline && !(layer instanceof L.Polygon) && map.hasLayer(layer);
}

function pathExtendEndpoints(layer) {
  const latlngs = layer.getLatLngs();
  if (latlngs.length < 2) return [];
  return [
    { end: "start", latlng: latlngs[0] },
    { end: "end", latlng: latlngs[latlngs.length - 1] },
  ];
}

// Nearest existing path endpoint to latlng, within PATH_EXTEND_SNAP_RADIUS_PX screen pixels.
function pathExtendFindSnapTarget(latlng) {
  const point = map.latLngToContainerPoint(latlng);
  let closest = null;
  let closestDist = PATH_EXTEND_SNAP_RADIUS_PX;
  editableLayers.eachLayer((layer) => {
    if (!pathExtendIsExtendablePolyline(layer)) return;
    pathExtendEndpoints(layer).forEach(({ end, latlng: endpointLatLng }) => {
      const dist = map.latLngToContainerPoint(endpointLatLng).distanceTo(point);
      if (dist < closestDist) {
        closestDist = dist;
        closest = { layer, end, latlng: endpointLatLng };
      }
    });
  });
  return closest;
}

// While hovering, swap the tooltip for one reflecting the snap that's about
// to happen: starting on an endpoint (no vertex placed yet), or - on any
// later vertex - finishing on a *different* path's endpoint to join them.
const origGetTooltipText = L.Draw.Polyline.prototype._getTooltipText;
L.Draw.Polyline.prototype._getTooltipText = function () {
  if (!this._currentLatLng) return origGetTooltipText.call(this);

  if (this._markers.length === 0) {
    if (pathExtendFindSnapTarget(this._currentLatLng)) {
      return { text: "Click to extend this path" };
    }
  } else {
    const snap = pathExtendFindSnapTarget(this._currentLatLng);
    if (snap && (!pathExtendTarget || snap.layer !== pathExtendTarget.layer)) {
      return {
        text: "Click to connect to this path",
        subtext: this.options.showLength ? this._getMeasurementString() : "",
      };
    }
  }
  return origGetTooltipText.call(this);
};

function initPathExtend() {
  // { layer, end, marker } for every endpoint dot currently shown.
  let endpointMarkers = [];
  // Marker count as of the previous draw:drawvertex event, to tell a newly
  // added vertex apart from deleteLastVertex() shrinking back to 1 marker -
  // that event fires the same "draw:drawvertex" event either way (see
  // _vertexChanged() in leaflet.draw-src.js), so the count alone can't tell
  // them apart without tracking its previous value ourselves.
  let previousMarkerCount = 0;

  function endpointIcon(active) {
    const size = L.Browser.touch ? 20 : 8;
    const classes = ["leaflet-div-icon", active ? "leaflet-editing-icon" : "path-extend-endpoint"];
    if (L.Browser.touch) classes.push("leaflet-touch-icon");
    return L.divIcon({
      className: classes.join(" "),
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function showEndpoints() {
    editableLayers.eachLayer((layer) => {
      if (!pathExtendIsExtendablePolyline(layer)) return;
      pathExtendEndpoints(layer).forEach(({ end, latlng }) => {
        endpointMarkers.push({
          layer,
          end,
          marker: L.marker(latlng, { icon: endpointIcon(false), interactive: false }).addTo(map),
        });
      });
    });
  }

  function clearEndpoints() {
    endpointMarkers.forEach(({ marker }) => map.removeLayer(marker));
    endpointMarkers = [];
  }

  // First vertex of the session snapped onto an existing path's endpoint -
  // start extending it: move the handle and the underlying polyline the
  // user is drawing onto the exact endpoint, so the new path visibly starts
  // from it, and give it the target path's own color instead of the tool's
  // default.
  function startExtending(snap, handler) {
    pathExtendTarget = { layer: snap.layer, end: snap.end };

    const matchedEndpoint = endpointMarkers.find(
      (endpoint) => endpoint.layer === snap.layer && endpoint.end === snap.end,
    );
    if (matchedEndpoint) {
      matchedEndpoint.marker.setIcon(endpointIcon(true));
      // The other end of this same path can't also be extended from this
      // session, so drop it - but other paths' endpoints stay, since
      // finishing on one of those is exactly how connecting two paths works.
      endpointMarkers = endpointMarkers.filter((endpoint) => {
        if (endpoint.layer !== snap.layer || endpoint === matchedEndpoint) return true;
        map.removeLayer(endpoint.marker);
        return false;
      });
    }

    handler._markers[0].setLatLng(snap.latlng);
    handler._poly.setLatLngs([snap.latlng]);
    handler._poly.setStyle({ color: snap.layer.options.color });
    addDistanceLabel(snap.latlng, calculatePathDistance(snap.layer));
  }

  // A later vertex snapped onto a *different* path's endpoint (whether or
  // not this session started with its own start snap) - snap it there and
  // finish the shape immediately, so one click both places the point and
  // completes the connection.
  function finishByConnecting(snap, handler, lastMarkerIndex) {
    pathExtendFinishTarget = { layer: snap.layer, end: snap.end };

    handler._markers[lastMarkerIndex].setLatLng(snap.latlng);
    const latlngs = handler._poly.getLatLngs();
    latlngs[latlngs.length - 1] = snap.latlng;
    handler._poly.setLatLngs(latlngs);

    // _finishShape() disables the handler, which tears down its own
    // _markers/_poly/_mouseMarker and unbinds their map listeners - it must
    // not run synchronously here, since this call stack originated from one
    // of those same listeners (_mouseMarker's mouseup -> _endPoint ->
    // addVertex -> this draw:drawvertex event). Deferring lets that whole
    // chain unwind first, the same way leaflet-draw's own _enableNewMarkers()
    // defers rather than mutating handler state mid-dispatch.
    setTimeout(() => handler._finishShape(), 0);
  }

  function handleDrawVertex(e) {
    const markers = e.layers.getLayers();
    const markerCount = markers.length;
    const isNewVertex = markerCount > previousMarkerCount;
    previousMarkerCount = markerCount;
    if (!isNewVertex) return;

    const latestLatLng = markers[markerCount - 1].getLatLng();
    const handler = drawControl._toolbars[L.DrawToolbar.TYPE]._modes.polyline.handler;

    if (markerCount === 1) {
      // Only the very first vertex can start an extension - finishing
      // doesn't make sense before anything has been drawn yet.
      const snap = pathExtendFindSnapTarget(latestLatLng);
      if (snap) startExtending(snap, handler);
      return;
    }

    const snap = pathExtendFindSnapTarget(latestLatLng);
    if (snap && (!pathExtendTarget || snap.layer !== pathExtendTarget.layer)) {
      finishByConnecting(snap, handler, markerCount - 1);
    }
  }

  map.on(L.Draw.Event.DRAWSTART, (e) => {
    if (e.layerType !== "polyline") return;
    pathExtendTarget = null;
    pathExtendFinishTarget = null;
    previousMarkerCount = 0;
    showEndpoints();
    map.on("draw:drawvertex", handleDrawVertex);
  });

  map.on(L.Draw.Event.DRAWSTOP, () => {
    pathExtendTarget = null;
    pathExtendFinishTarget = null;
    clearEndpoints();
    map.off("draw:drawvertex", handleDrawVertex);
  });

  map.on("draw:created", (e) => {
    if ((!pathExtendTarget && !pathExtendFinishTarget) || e.layerType !== "polyline") return;
    const start = pathExtendTarget;
    const finish = pathExtendFinishTarget;
    pathExtendTarget = null;
    pathExtendFinishTarget = null;

    let drawnPoints = e.layer.getLatLngs();
    if (start) drawnPoints = drawnPoints.slice(1); // drop the point snapped onto start's endpoint
    if (finish) drawnPoints = drawnPoints.slice(0, -1); // drop the point snapped onto finish's endpoint
    if (drawnPoints.length === 0 && !(start && finish)) return; // nothing drawn, and not directly joining two paths either

    // Each existing path contributes its own points oriented purely around
    // its own clicked endpoint, independent of which literal "start"/"end"
    // that happened to be: the path being led INTO ends at its clicked
    // point, the path being led OUT OF begins at its clicked point. The
    // drawn points always run as-drawn in between, since they were drawn
    // walking from the start side to the finish side regardless of orientation.
    const leadIn = !start
      ? []
      : start.end === "end"
        ? start.layer.getLatLngs()
        : [...start.layer.getLatLngs()].reverse();
    const leadOut = !finish
      ? []
      : finish.end === "start"
        ? finish.layer.getLatLngs()
        : [...finish.layer.getLatLngs()].reverse();

    const target = start ? start.layer : finish.layer;
    target.setLatLngs([...leadIn, ...drawnPoints, ...leadOut]);

    if (start && finish) {
      // Also prunes it out of any active rectangle-selection state, not just
      // the layer groups - a plain removeLayer() wouldn't do that.
      deleteLayerImmediately(finish.layer, { skipUiUpdate: true });
    }
    // setLatLngs() swaps in a new latlngs array, but layer.editing (leaflet-draw's
    // per-layer edit handler) cached a reference to the old one at construction time
    // and only ever refreshes it on this event - without firing it, Edit mode would
    // keep building vertex handles from the pre-extension array.
    target.fire("revert-edited", { layer: target });

    if (target.feature && target.feature.properties) {
      target.feature.properties.totalDistance = calculatePathDistance(target);
    }
    selectItem(target);
    updateDrawControlStates();
    updateOverviewList();
  });

  // If the path currently being extended (or the one a finish-snap already
  // landed on) gets deleted through some other UI surface - e.g. the overview
  // panel's own delete button, which isn't blocked while a draw session is
  // active - before the session ends, extending/joining it no longer means
  // anything. Cancel the whole draw outright instead of letting it finish
  // onto a layer that's no longer tracked anywhere, which would silently
  // drop the drawn points and select an orphaned layer.
  editableLayers.on("layerremove", (e) => {
    if (pathExtendTarget?.layer === e.layer || pathExtendFinishTarget?.layer === e.layer) {
      drawControl._toolbars[L.DrawToolbar.TYPE].disable();
      Swal.fire({
        toast: true,
        icon: "warning",
        title: "Drawing Cancelled",
        text: "The path you were extending was deleted.",
        showConfirmButton: false,
        timer: 3000,
      });
    }
  });
}
