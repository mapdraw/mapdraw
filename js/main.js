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
  editControlContainer,
  deleteControlContainer,
  locateControl,
  currentRoutePath = null,
  saveRouteBtn,
  temporarySearchMarker = null,
  useImperialUnits = false,
  scaleControl;

/**
 * Adjusts the height of the info panel's name textarea to fit its content,
 * up to a maximum of approximately three lines.
 * @param {HTMLTextAreaElement} textarea - The textarea element to resize
 */
function adjustInfoPanelNameHeight(textarea) {
  const heightLimit = 75;

  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, heightLimit)}px`;
  textarea.style.overflowY = textarea.scrollHeight > heightLimit ? "auto" : "hidden";
  textarea.scrollTop = 0;
}

/**
 * Updates currently displayed UI elements that show units (routing panel, info panel)
 * when the user toggles between metric and imperial units.
 */
function updateAllDynamicUnitDisplays() {
  const selected = getEffectiveSelectedLayer();
  if (selected) {
    showInfoPanel(selected);
  }

  if (window.app && typeof window.app.redisplayCurrentRoute === "function") {
    window.app.redisplayCurrentRoute();
  }
}

/**
 * Fetches the credits content from an HTML file and displays it in a SweetAlert modal.
 * @param {boolean} [isWelcome=false] - If true, shows as a first-visit welcome popup with
 *   a "Let's Go!" button. If false, shows as the standard credits popup with a "Close" button.
 */
async function showCreditsPopup(isWelcome = false) {
  try {
    const response = await fetch("/credits.html");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const creditsHtmlContent = await response.text();

    const swalContent = document.createElement("div");
    swalContent.innerHTML = creditsHtmlContent;

    const appNameEl = swalContent.querySelector("#credits-app-name");
    if (isWelcome) {
      appNameEl.innerHTML = `Welcome to ${APP_NAME}`;
    } else {
      appNameEl.textContent = APP_NAME;
    }

    const populateAttributionList = (placeholder, config) => {
      if (!placeholder) return;
      const seen = new Set();
      const frag = document.createDocumentFragment();
      config.forEach((item) => {
        if (!item.attribution || seen.has(item.attribution.url)) return;
        seen.add(item.attribution.url);
        const li = document.createElement("li");
        const label = item.creditLabel || item.label;
        li.innerHTML = `${label}: &copy; ${attrLinksHTML(item.attribution)}`;
        frag.appendChild(li);
      });
      placeholder.replaceWith(frag);
    };

    populateAttributionList(
      swalContent.querySelector("#basemap-credits-placeholder"),
      BASEMAP_CONFIG,
    );
    populateAttributionList(
      swalContent.querySelector("#overlay-credits-placeholder"),
      OVERLAY_CONFIG,
    );

    return Swal.fire({
      html: swalContent,
      confirmButtonText: isWelcome ? "Let's Go!" : "Close",
    });
  } catch (error) {
    console.error("Could not load credits.html:", error);
    return Swal.fire({
      title: "Error",
      text: "Could not load the credits information.",
    });
  }
}

function closePanelMode(id, hide) {
  hide();
  window.app.deactivateMode(id, "panels");
}

/**
 * The hide callback also serves as mode-manager's onCancel, so a panel
 * closes the same way whether the user re-clicks its own button or
 * another panel takes over.
 */
function togglePanelMode(id, isVisible, show, hide) {
  if (isVisible()) {
    closePanelMode(id, hide);
  } else {
    window.app.activateMode(id, { group: "panels", onCancel: hide });
    show();
  }
}

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

  infoPanel = document.getElementById("info-panel");
  infoPanelName = document.getElementById("info-panel-name");
  infoPanelDetails = document.getElementById("info-panel-details");
  infoPanelStyleRow = document.getElementById("info-panel-style-row");
  infoPanelColorSwatch = document.getElementById("info-panel-color-swatch");
  infoPanelLayerName = document.getElementById("info-panel-layer-name");
  colorPicker = document.getElementById("color-picker");

  infoPanelName.addEventListener("blur", () => {
    updateLayerName();
    adjustInfoPanelNameHeight(infoPanelName);
  });
  infoPanelName.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      updateLayerName();
      infoPanelName.blur();
      e.preventDefault();
    }
  });

  infoPanelName.addEventListener("input", () => adjustInfoPanelNameHeight(infoPanelName));

  infoPanelColorSwatch.addEventListener("click", () => {
    const isPickerVisible =
      colorPicker.style.display === "grid" || colorPicker.style.display === "block";
    colorPicker.style.display = isPickerVisible ? "none" : "grid";
  });

  populateColorPicker();

  const tabButtons = document.querySelectorAll(".tab-button");
  const tabPanels = document.querySelectorAll(".tab-panel");
  const routingInfoIcon = document.getElementById("routing-info-icon");

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      tabButtons.forEach((btn) => btn.classList.remove("active"));
      tabPanels.forEach((panel) => panel.classList.remove("active"));

      button.classList.add("active");

      const targetPanelId = button.getAttribute("data-target");
      const targetPanel = document.getElementById(targetPanelId);
      if (targetPanel) {
        targetPanel.classList.add("active");
      }

      if (targetPanelId === "overview-panel") {
        const selectedForOverview = getEffectiveSelectedLayer();
        if (selectedForOverview) {
          if (window.expandCategoryForItem) {
            window.expandCategoryForItem(selectedForOverview);
          }
          const layerId = L.Util.stamp(selectedForOverview);
          const listItem = document.querySelector(
            `#overview-panel-list .overview-list-item[data-layer-id='${layerId}']`,
          );
          if (listItem) {
            listItem.scrollIntoView({ behavior: "auto", block: "nearest" });
          }
        }
      }

      if (document.getElementById("tab-btn-routing").classList.contains("active")) {
        routingInfoIcon.classList.remove("disabled");
      } else {
        routingInfoIcon.classList.add("disabled");
      }
    });
  });

  if (routingInfoIcon) {
    if (!document.getElementById("tab-btn-routing").classList.contains("active")) {
      routingInfoIcon.classList.add("disabled");
    }

    L.DomEvent.on(routingInfoIcon, "click", (e) => {
      const routingTabButton = document.getElementById("tab-btn-routing");

      if (routingTabButton.classList.contains("active")) {
        L.DomEvent.stop(e);
        Swal.fire({
          title: "Routing Help",
          html: `
<p style="text-align: left; margin: 0 0 18px 0">
  <strong>Managing Waypoints:</strong> The <strong>Start</strong>, <strong>Via</strong>, and
  <strong>End</strong> markers can be managed with your mouse or finger.
</p>
<p style="text-align: left"><strong>To Move:</strong> Drag the marker to a new position.</p>
<p style="text-align: left; margin: 0 0 18px 0">
  <strong>To Remove:</strong> Long-press or right-click the marker.
</p>
<p style="text-align: left">
  <strong>Adding Extra Via Points: </strong>You can add extra stops by <strong>long-pressing or right-clicking</strong> anywhere on the route line.
</p>
<p style="text-align: left; margin: 18px 0 0 0">
  <strong>Draw Mode:</strong> Use the <span class="material-symbols" style="font-size: 1em; vertical-align: middle">draw</span> button to trace a route step by step. First click sets the start, second sets the end, and each click after that extends the route. <strong>To finish, click the last marker, press Escape, or click the button again.</strong>
</p>
`,
          confirmButtonText: "Got it!",
        });
      }
    });
  }

  const baseMaps = await initMapView();

  initLayerControlPanel(baseMaps);

  initLocateControl();

  // The scale bar is re-created on the imperial-units toggle (see settings
  // panel below), so its setup stays inline here rather than in its own
  // file, to keep both creation sites next to each other for now.
  scaleControl = L.control
    .scale({
      position: "bottomleft",
      metric: !useImperialUnits,
      imperial: useImperialUnits,
    })
    .addTo(map);

  L.control.zoom({ position: "topleft" }).addTo(map);

  window.app.initRectangleSelect(map);

  initTopButtons();
  initDeleteKeyShortcut();

  window.elevationProfile.createElevationChart("elevation-div", useImperialUnits);

  // Hide elevation panel on load to prevent blocking map interactions on mobile
  document.getElementById("elevation-div").style.visibility = "hidden";

  initDrawTools();
  initFileControls();
  initElevationToggle();
  initClickToDeselect();
  updateOverviewList();

  initRouting();
  initStrava();
  initContextMenu(map);
  initSettingsPanel();

  map.getContainer().addEventListener("click", (e) => {
    const creditsTrigger = e.target.closest(".js-show-credits");

    if (creditsTrigger) {
      e.preventDefault();
      e.stopPropagation();
      showCreditsPopup();
    }
  });

  const infoPanelObserver = new MutationObserver(() => {
    if (infoPanelName) {
      adjustInfoPanelNameHeight(infoPanelName);
    }
  });

  infoPanelObserver.observe(infoPanel, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  document.addEventListener("penModeExited", () => adjustInfoPanelNameHeight(infoPanelName));

  let deferredPrompt;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;

    const installLink = document.getElementById("install-pwa-link");
    if (installLink) {
      installLink.style.display = "inline";

      installLink.addEventListener("click", (clickEvent) => {
        clickEvent.preventDefault();
        installLink.style.display = "none";

        if (deferredPrompt) {
          deferredPrompt.prompt();

          deferredPrompt.userChoice.then(({ outcome }) => {
            console.log(`User response to the install prompt: ${outcome}`);
          });

          deferredPrompt = null;
        }
      });
    }
  });

  window.addEventListener("appinstalled", () => {
    const installLink = document.getElementById("install-pwa-link");
    if (installLink) {
      installLink.style.display = "none";
    }
    deferredPrompt = null;
    console.log("PWA was installed");
  });
  const sheetHandle = document.getElementById("sheet-handle");
  if (sheetHandle) {
    const panelContainer = document.getElementById("main-right-container");
    const toggleButton = document.getElementById("sidebar-toggle-btn");

    const openSheet = () => {
      panelContainer.classList.remove("hidden");
      if (toggleButton) {
        toggleButton.classList.add("panels-visible");
        toggleButton.classList.remove("panels-hidden");
      }
    };

    const closeSheet = () => {
      panelContainer.classList.add("hidden");
      if (toggleButton) {
        toggleButton.classList.remove("panels-visible");
        toggleButton.classList.add("panels-hidden");
      }
    };

    sheetHandle.addEventListener("click", () => {
      if (panelContainer.classList.contains("hidden")) {
        openSheet();
      } else {
        closeSheet();
      }
    });

    let touchStartY = 0;
    const swipeThreshold = 50;

    sheetHandle.addEventListener(
      "touchstart",
      (e) => {
        touchStartY = e.changedTouches[0].clientY;
      },
      { passive: true },
    );

    sheetHandle.addEventListener("touchend", (e) => {
      const touchEndY = e.changedTouches[0].clientY;
      const deltaY = touchEndY - touchStartY;

      if (deltaY > swipeThreshold) {
        closeSheet();
      }

      if (deltaY < -swipeThreshold) {
        openSheet();
      }
    });
  }
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

  window.addEventListener(
    "load",
    () => {
      const creditsIcon = new Image();
      creditsIcon.src = "/img/icon-1024x1024.png";

      const stravaButton = new Image();
      stravaButton.src = "/img/btn_strava_connect_with_orange.svg";
    },
    { once: true },
  );
}

document.addEventListener("DOMContentLoaded", initApp);

// console.log("User Agent:", navigator.userAgent);
// console.log("Leaflet Version:", L.version);
