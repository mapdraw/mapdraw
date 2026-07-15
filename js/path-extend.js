// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * Lets a finished path be continued later. While the path draw tool is
 * active, every existing path's two endpoints are shown as dots; starting
 * the new path within a few pixels of one snaps onto it, and on finish the
 * new points are spliced onto that path instead of creating a separate item.
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

// While hovering with no vertex placed yet, swap the "Click to start drawing
// path" tooltip for one that reflects the snap that's about to happen.
const origGetTooltipText = L.Draw.Polyline.prototype._getTooltipText;
L.Draw.Polyline.prototype._getTooltipText = function () {
  if (this._markers.length === 0 && this._currentLatLng) {
    if (pathExtendFindSnapTarget(this._currentLatLng)) {
      return { text: "Click to extend this path" };
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

  function handleDrawVertex(e) {
    const markerCount = e.layers.getLayers().length;
    const isNewVertex = markerCount > previousMarkerCount;
    previousMarkerCount = markerCount;
    if (pathExtendTarget || !isNewVertex || markerCount !== 1) return; // only snap on the session's first added vertex

    const snap = pathExtendFindSnapTarget(e.layers.getLayers()[0].getLatLng());
    if (!snap) return;

    pathExtendTarget = { layer: snap.layer, end: snap.end };

    const matchedEndpoint = endpointMarkers.find(
      (endpoint) => endpoint.layer === snap.layer && endpoint.end === snap.end,
    );
    if (matchedEndpoint) {
      matchedEndpoint.marker.setIcon(endpointIcon(true));
      // The other end of this same path can't also be extended from this
      // session, so drop it - but other paths' endpoints stay, in case a
      // future "finish on another path's endpoint to connect them" feature
      // wants them.
      endpointMarkers = endpointMarkers.filter((endpoint) => {
        if (endpoint.layer !== snap.layer || endpoint === matchedEndpoint) return true;
        map.removeLayer(endpoint.marker);
        return false;
      });
    }

    // Move both the handle and the underlying polyline the user is drawing
    // onto the exact endpoint, so the new path visibly starts from it, and
    // give it the target path's own color instead of the tool's default.
    const handler = drawControl._toolbars[L.DrawToolbar.TYPE]._modes.polyline.handler;
    handler._markers[0].setLatLng(snap.latlng);
    handler._poly.setLatLngs([snap.latlng]);
    handler._poly.setStyle({ color: snap.layer.options.color });
  }

  map.on(L.Draw.Event.DRAWSTART, (e) => {
    if (e.layerType !== "polyline") return;
    pathExtendTarget = null;
    previousMarkerCount = 0;
    showEndpoints();
    map.on("draw:drawvertex", handleDrawVertex);
  });

  map.on(L.Draw.Event.DRAWSTOP, () => {
    pathExtendTarget = null;
    clearEndpoints();
    map.off("draw:drawvertex", handleDrawVertex);
  });

  map.on("draw:created", (e) => {
    if (!pathExtendTarget || e.layerType !== "polyline") return;
    const { layer: target, end } = pathExtendTarget;
    pathExtendTarget = null;

    const addedPoints = e.layer.getLatLngs().slice(1); // drop the point snapped onto target's endpoint
    if (addedPoints.length === 0) return;

    const existing = target.getLatLngs();
    target.setLatLngs(
      end === "end" ? [...existing, ...addedPoints] : [...addedPoints.reverse(), ...existing],
    );
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
}
