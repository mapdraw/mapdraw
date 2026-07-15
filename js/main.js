// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Apply saved theme on load — glass is default for new users
(function () {
  const theme = localStorage.getItem("theme") ?? "glass";
  if (theme === "dark") document.body.classList.add("dark-mode");
  else if (theme === "light") document.body.classList.add("light-mode");
  else document.body.classList.add("glass-mode");
})();

// Apply saved layout preference on load
(function () {
  const forceDesktopLayout = localStorage.getItem("forceDesktopLayout") === "true";
  if (forceDesktopLayout) {
    document.body.classList.add("force-desktop-layout");
  }
})();

// Dynamic input type tracking (mouse vs touch) for hybrid devices
(function () {
  let lastInputType = "touch";
  document.body.classList.add("using-touch");

  function updateInputType(event) {
    const currentInputType = event.pointerType;

    if (currentInputType === lastInputType) {
      return;
    }

    if (currentInputType === "mouse") {
      document.body.classList.remove("using-touch");
    } else {
      document.body.classList.add("using-touch");
    }

    lastInputType = currentInputType;
  }

  window.addEventListener("pointermove", updateInputType, { passive: true });
  window.addEventListener("pointerdown", updateInputType, { passive: true });
})();

// Global variables
let map,
  drawnItems,
  importedItems,
  stravaActivitiesLayer,
  editableLayers,
  selectedElevationPath = null,
  globallySelectedItem = null,
  selectedPathOutline = null,
  selectedMarkerOutline = null,
  infoPanel,
  infoPanelName,
  infoPanelDetails,
  infoPanelStyleRow,
  infoPanelColorSwatch,
  infoPanelLayerName,
  colorPicker,
  isDeleteMode = false,
  elevationToggleControl,
  downloadControl,
  isElevationProfileVisible = false,
  drawControl,
  isEditMode = false,
  pathExtendTarget = null,
  refreshDistanceLabels,
  editControlContainer,
  deleteControlContainer,
  locateControl,
  currentRoutePath = null,
  saveRouteBtn,
  temporarySearchMarker = null,
  useImperialUnits = false,
  scaleControl;

/**
 * Initializes the app and all its components (map, layers, controls, event handlers).
 */
async function initApp() {
  // Verify that all required API keys from secrets.js are available
  if (
    typeof googleApiKey === "undefined" ||
    typeof mapboxAccessToken === "undefined" ||
    typeof osmClientId === "undefined"
  ) {
    Swal.fire({
      title: "Configuration Error",
      html: `The <strong>secrets.js</strong> file is missing or misconfigured.<br><br>Please ensure the file exists in the 'js/' folder and contains all required API keys.`,
      allowOutsideClick: false,
    });
  }

  const creditsLink = document.getElementById("credits-link");
  if (creditsLink) creditsLink.prepend(APP_NAME + " ");

  useImperialUnits = localStorage.getItem("useImperialUnits") === "true";

  initInfoPanel();
  initTabNavigation();

  const baseMaps = await initMapView();
  initLayerControlPanel(baseMaps);
  initLocateControl();

  // Re-created in settings-panel.js's imperial-units toggle handler, so
  // this initial creation stays inline here rather than in its own file.
  scaleControl = L.control
    .scale({
      position: "bottomleft",
      metric: !useImperialUnits,
      imperial: useImperialUnits,
    })
    .addTo(map);

  L.control.zoom({ position: "topleft" }).addTo(map);
  window.app.initRectangleSelect(map);

  initTopRightButtons();
  initDeleteKeyShortcut();

  window.elevationProfile.createElevationChart("elevation-div", useImperialUnits);

  // Hide elevation panel on load to prevent blocking map interactions on mobile
  document.getElementById("elevation-div").style.visibility = "hidden";

  initDrawTools();
  initPathExtend();
  initFileControls();
  initElevationToggle();
  initClickToDeselect();
  updateOverviewList();

  initRouting();
  initStrava();
  initContextMenu(map);
  initSettingsPanel();

  initCreditsTrigger();
  initPwaInstall();
  initBottomSheet();

  const uiContainers = [
    document.getElementById("main-right-container"),
    document.getElementById("top-right-container"),
    document.getElementById("custom-layers-panel"),
    document.getElementById("elevation-div"),
    document.getElementById("bottom-left-credits"),
    // Also include the container for all of Leaflet's default controls
    ...document.querySelectorAll(".leaflet-control-container"),
  ];

  uiContainers.forEach((container) => {
    if (container) {
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
    }
  });

  setTimeout(updateDrawControlStates, 0);
  setTimeout(replaceDefaultIconsWithMaterialSymbols, 0);
  resetInfoPanel();

  // Preload the credits popup's content so it appears instantly when needed later
  window.addEventListener("load", prefetchCreditsHtml, { once: true });
}

document.addEventListener("DOMContentLoaded", initApp);
