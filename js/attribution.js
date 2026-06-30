// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

const basemapAttributions = {
  OpenStreetMap:
    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
  OsmGrayscale:
    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
  CyclOSM:
    '© <a href="https://www.cyclosm.org/" target="_blank" rel="noopener noreferrer">CyclOSM</a>',
  OpenTopoMap:
    '© <a href="https://opentopomap.org/" target="_blank" rel="noopener noreferrer">OpenTopoMap</a>',
  EsriWorldImagery:
    '© <a href="https://www.esri.com" target="_blank" rel="noopener noreferrer">Esri</a>',
  TopPlusOpen:
    '© <a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener noreferrer">dl-de/by-2-0</a>',
  Swisstopo:
    '© <a href="https://www.swisstopo.admin.ch/" target="_blank" rel="noopener noreferrer">swisstopo</a>',
  Empty: "",
};

const overlayAttributions = {
  WaymarkedTrailsHiking:
    '© <a href="https://waymarkedtrails.org" target="_blank" rel="noopener noreferrer">Waymarked Trails</a>',
  WaymarkedTrailsCycling:
    '© <a href="https://waymarkedtrails.org" target="_blank" rel="noopener noreferrer">Waymarked Trails</a>',
};

let currentBasemapKey = "OpenStreetMap";
const activeOverlayKeys = new Set();

function updateMapAttribution() {
  const parts = [];
  const base = basemapAttributions[currentBasemapKey];
  if (base) parts.push(base);
  for (const key of activeOverlayKeys) {
    const attr = overlayAttributions[key];
    if (attr && !parts.includes(attr)) parts.push(attr);
  }
  document.getElementById("map-attribution").innerHTML = parts.join(" ");
}

function initMapAttribution() {
  const el = document.createElement("div");
  el.id = "map-attribution";
  document.getElementById("map").appendChild(el);
  updateMapAttribution();
}

function setBasemapAttribution(name) {
  currentBasemapKey = name;
  updateMapAttribution();
}

function addOverlayAttribution(name) {
  if (overlayAttributions[name]) {
    activeOverlayKeys.add(name);
    updateMapAttribution();
  }
}

function removeOverlayAttribution(name) {
  if (activeOverlayKeys.delete(name)) updateMapAttribution();
}
