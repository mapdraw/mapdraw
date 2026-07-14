// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

function attrLinksHTML(attr) {
  return (attr.parts ?? [attr])
    .map((p) => `<a href="${p.url}" target="_blank" rel="noopener noreferrer">${p.name}</a>`)
    .join(" ");
}

function makeAttrHTML(attr) {
  return `<span style="white-space: nowrap">© ${attrLinksHTML(attr)}</span>`;
}

const basemapAttributions = Object.fromEntries(
  BASEMAP_CONFIG.filter((b) => b.attribution).map((b) => [
    b.key,
    (b.mapAttributions ?? [b.attribution]).map(makeAttrHTML).join(""),
  ]),
);

const overlayAttributions = Object.fromEntries(
  OVERLAY_CONFIG.filter((o) => o.attribution).map((o) => [o.key, makeAttrHTML(o.attribution)]),
);

let currentBasemapKey = BASEMAP_CONFIG[0].key;
const activeOverlayKeys = new Set();

function updateMapAttribution() {
  const parts = [];
  const seenUrls = new Set();

  const base = BASEMAP_CONFIG.find((b) => b.key === currentBasemapKey);
  if (base?.attribution) {
    (base.mapAttributions ?? [base.attribution]).forEach((a) =>
      (a.parts ?? [a]).forEach((p) => seenUrls.add(p.url)),
    );
    parts.push(basemapAttributions[currentBasemapKey]);
  }

  for (const key of activeOverlayKeys) {
    const overlay = OVERLAY_CONFIG.find((o) => o.key === key);
    if (overlay?.attribution && !seenUrls.has(overlay.attribution.url)) {
      seenUrls.add(overlay.attribution.url);
      parts.push(overlayAttributions[key]);
    }
  }

  document.getElementById("map-attribution").innerHTML = parts.join("");
}

function initAttribution() {
  const el = document.createElement("div");
  el.id = "map-attribution";
  document.getElementById("map").appendChild(el);
  L.DomEvent.disableClickPropagation(el);
  L.DomEvent.disableScrollPropagation(el);
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
