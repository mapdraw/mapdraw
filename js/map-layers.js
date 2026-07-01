// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

const BASEMAP_CONFIG = [
  {
    key: "OpenStreetMap",
    label: "OpenStreetMap",
    icon: '<span class="material-symbols layer-icon">globe</span>',
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    tileOptions: { maxZoom: 19 },
    attribution: { name: "OpenStreetMap", url: "https://www.openstreetmap.org/copyright" },
  },
  {
    key: "OsmGrayscale",
    label: "OpenStreetMap Gray",
    icon: '<span class="material-symbols layer-icon">globe</span>',
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    tileOptions: { maxZoom: 19, className: "grayscale-tiles" },
    attribution: { name: "OpenStreetMap", url: "https://www.openstreetmap.org/copyright" },
  },
  {
    key: "CyclOSM",
    label: "CyclOSM",
    icon: '<span class="material-symbols layer-icon">globe</span>',
    url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    tileOptions: { maxZoom: 19 },
    attribution: { name: "CyclOSM", url: "https://www.cyclosm.org/" },
    mapAttributions: [
      { name: "OpenStreetMap", url: "https://www.openstreetmap.org/copyright" },
      { name: "CyclOSM", url: "https://www.cyclosm.org/" },
    ],
  },
  {
    key: "OpenTopoMap",
    label: "OpenTopoMap",
    icon: '<span class="material-symbols layer-icon">globe</span>',
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    tileOptions: { maxZoom: 17 },
    attribution: { name: "OpenTopoMap", url: "https://opentopomap.org/" },
    mapAttributions: [
      { name: "OpenStreetMap", url: "https://www.openstreetmap.org/copyright" },
      { name: "OpenTopoMap", url: "https://opentopomap.org/" },
    ],
  },
  {
    key: "EsriWorldImagery",
    label: "Esri World Imagery",
    icon: '<span class="material-symbols layer-icon">globe</span>',
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    tileOptions: { maxZoom: 19 },
    attribution: { name: "Esri", url: "https://www.esri.com" },
  },
  {
    key: "TopPlusOpen",
    label: "TopPlusOpen",
    icon: '<span class="fi fi-de fis"></span>',
    url: "https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web/default/WEBMERCATOR/{z}/{y}/{x}.png",
    tileOptions: { maxZoom: 18 },
    attribution: {
      name: "BKG",
      url: "https://www.bkg.bund.de/",
      parts: [
        { name: "BKG", url: "https://www.bkg.bund.de/" },
        { name: "dl-de/by-2-0", url: "https://www.govdata.de/dl-de/by-2-0" },
      ],
    },
  },
  {
    key: "Swisstopo",
    label: "Swisstopo",
    icon: '<span class="fi fi-ch fis"></span>',
    wms: true,
    url: "https://wms.geo.admin.ch/",
    tileOptions: { layers: "ch.swisstopo.pixelkarte-farbe", format: "image/jpeg", maxZoom: 18 },
    attribution: { name: "swisstopo", url: "https://www.swisstopo.admin.ch/" },
  },
  {
    key: "Empty",
    label: "No Base Map",
    icon: '<span class="material-symbols layer-icon">cancel</span>',
    attribution: null,
  },
];

const OVERLAY_CONFIG = [
  {
    key: "WaymarkedTrailsHiking",
    label: "Waymarked Trails Hiking",
    creditLabel: "Waymarked Trails",
    icon: '<span class="material-symbols layer-icon">directions_walk</span>',
    attribution: { name: "Waymarked Trails", url: "https://waymarkedtrails.org" },
  },
  {
    key: "WaymarkedTrailsCycling",
    label: "Waymarked Trails Cycling",
    icon: '<span class="material-symbols layer-icon">directions_bike</span>',
    attribution: { name: "Waymarked Trails", url: "https://waymarkedtrails.org" },
  },
];
