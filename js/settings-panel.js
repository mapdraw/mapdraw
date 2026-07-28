// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Settings Panel
// Populates the settings panel: theme, units, layout, line thickness,
// routing/elevation providers, and the about/legal/dev links.

/**
 * Updates currently displayed UI elements that show units (routing panel, info panel,
 * distance/area labels on the map) when the user toggles between metric and imperial units.
 */
function updateAllDynamicUnitDisplays() {
  const selected = getEffectiveSelectedLayer();
  if (selected) {
    showInfoPanel(selected);
  }

  if (window.app && typeof window.app.redisplayCurrentRoute === "function") {
    window.app.redisplayCurrentRoute();
  }

  refreshDistanceLabels();
}

/**
 * Populates the settings panel with all its toggles, selects, and links.
 */
function initSettingsPanel() {
  const settingsPanel = document.getElementById("settings-panel");
  if (!settingsPanel) return;

  initOSM(settingsPanel);

  const themeToggleContainer = L.DomUtil.create("div", "settings-control-item", settingsPanel);
  const themeLabel = L.DomUtil.create("label", "", themeToggleContainer);
  themeLabel.innerText = "Theme";
  const themeSelect = L.DomUtil.create("select", "", themeToggleContainer);
  themeSelect.id = "theme-select";
  const currentTheme = localStorage.getItem("theme") ?? "glass";
  [
    ["glass", "Glass"],
    ["light", "Light"],
    ["dark", "Dark"],
  ].forEach(([value, label]) => {
    const option = L.DomUtil.create("option", "", themeSelect);
    option.value = value;
    option.textContent = label;
    option.selected = value === currentTheme;
  });
  L.DomEvent.on(themeSelect, "change", (e) => {
    document.body.classList.remove("dark-mode", "light-mode", "glass-mode");
    if (e.target.value === "dark") document.body.classList.add("dark-mode");
    else if (e.target.value === "light") document.body.classList.add("light-mode");
    else document.body.classList.add("glass-mode");
    localStorage.setItem("theme", e.target.value);
  });
  L.DomEvent.on(themeToggleContainer, "dblclick mousedown wheel", L.DomEvent.stopPropagation);

  const imperialUnitsContainer = L.DomUtil.create("div", "settings-control-item", settingsPanel);
  const imperialUnitsLabel = L.DomUtil.create("label", "", imperialUnitsContainer);
  imperialUnitsLabel.htmlFor = "imperial-units-toggle";
  imperialUnitsLabel.innerText = "Imperial Units";
  const imperialUnitsCheckbox = L.DomUtil.create("input", "", imperialUnitsContainer);
  imperialUnitsCheckbox.type = "checkbox";
  imperialUnitsCheckbox.id = "imperial-units-toggle";
  imperialUnitsCheckbox.checked = useImperialUnits;

  L.DomEvent.on(imperialUnitsCheckbox, "change", async (e) => {
    useImperialUnits = e.target.checked;
    localStorage.setItem("useImperialUnits", useImperialUnits);

    if (scaleControl) {
      map.removeControl(scaleControl);
    }
    scaleControl = L.control
      .scale({
        position: "bottomleft",
        metric: !useImperialUnits,
        imperial: useImperialUnits,
      })
      .addTo(map);

    window.elevationProfile.updateElevationChartUnits(useImperialUnits);

    updateAllDynamicUnitDisplays();

    Swal.fire({
      toast: true,
      icon: "info",
      title: `Units set to ${useImperialUnits ? "Imperial" : "Metric"}`,
      showConfirmButton: false,
      timer: 1500,
    });
  });

  L.DomEvent.on(imperialUnitsContainer, "dblclick mousedown wheel", L.DomEvent.stopPropagation);

  const distanceLabelsContainer = L.DomUtil.create("div", "settings-control-item", settingsPanel);
  const distanceLabelsLabel = L.DomUtil.create("label", "", distanceLabelsContainer);
  distanceLabelsLabel.htmlFor = "distance-labels-toggle";
  distanceLabelsLabel.innerText = "Distance Labels";
  const distanceLabelsCheckbox = L.DomUtil.create("input", "", distanceLabelsContainer);
  distanceLabelsCheckbox.type = "checkbox";
  distanceLabelsCheckbox.id = "distance-labels-toggle";
  distanceLabelsCheckbox.checked = distanceLabelsEnabled;

  L.DomEvent.on(distanceLabelsCheckbox, "change", (e) => {
    setDistanceLabelsEnabled(e.target.checked);
  });

  L.DomEvent.on(distanceLabelsContainer, "dblclick mousedown wheel", L.DomEvent.stopPropagation);

  const forceDesktopLayoutContainer = L.DomUtil.create(
    "div",
    "settings-control-item",
    settingsPanel,
  );
  const forceDesktopLayoutLabel = L.DomUtil.create("label", "", forceDesktopLayoutContainer);
  forceDesktopLayoutLabel.htmlFor = "force-desktop-toggle";
  forceDesktopLayoutLabel.innerText = "Force Desktop Layout";
  const forceDesktopLayoutCheckbox = L.DomUtil.create("input", "", forceDesktopLayoutContainer);
  forceDesktopLayoutCheckbox.type = "checkbox";
  forceDesktopLayoutCheckbox.id = "force-desktop-toggle";
  forceDesktopLayoutCheckbox.checked = localStorage.getItem("forceDesktopLayout") === "true";

  L.DomEvent.on(forceDesktopLayoutCheckbox, "change", (e) => {
    const forceDesktopLayout = e.target.checked;
    localStorage.setItem("forceDesktopLayout", forceDesktopLayout);

    if (forceDesktopLayout) {
      document.body.classList.add("force-desktop-layout");
    } else {
      document.body.classList.remove("force-desktop-layout");
    }
  });

  const lineThicknessContainer = L.DomUtil.create("div", "settings-control-item", settingsPanel);
  const lineThicknessLabel = L.DomUtil.create("label", "", lineThicknessContainer);
  lineThicknessLabel.htmlFor = "line-thickness-slider";
  lineThicknessLabel.innerText = "Line Thickness";
  const lineThicknessRight = L.DomUtil.create(
    "div",
    "settings-slider-group",
    lineThicknessContainer,
  );
  const lineThicknessValue = L.DomUtil.create("span", "settings-slider-value", lineThicknessRight);
  lineThicknessValue.innerText = lineThickness;
  const lineThicknessSlider = L.DomUtil.create("input", "settings-slider", lineThicknessRight);
  lineThicknessSlider.type = "range";
  lineThicknessSlider.id = "line-thickness-slider";
  lineThicknessSlider.min = 2;
  lineThicknessSlider.max = 20;
  lineThicknessSlider.step = 2;
  lineThicknessSlider.value = lineThickness;
  L.DomEvent.on(lineThicknessSlider, "input", (e) => {
    lineThickness = parseInt(e.target.value);
    lineThicknessValue.innerText = lineThickness;
    STYLE_CONFIG.path.default.weight = lineThickness;
    STYLE_CONFIG.path.highlight.weight = lineThickness;
    localStorage.setItem("lineThickness", lineThickness);
    Object.values(displayLayerGroups).forEach((group) => {
      group.eachLayer((layer) => {
        if (layer instanceof L.Polyline || layer instanceof L.GeoJSON) {
          layer.setStyle({ weight: lineThickness });
        }
      });
    });
    if (selectedPathOutline) {
      selectedPathOutline.setStyle({
        weight: lineThickness + STYLE_CONFIG.path.highlight.outline.weightOffset,
      });
    }
  });
  L.DomEvent.on(lineThicknessContainer, "dblclick mousedown wheel", L.DomEvent.stopPropagation);

  const routingProviderContainer = L.DomUtil.create("div", "settings-control-item", settingsPanel);
  const routingProviderLabel = L.DomUtil.create("label", "", routingProviderContainer);
  routingProviderLabel.htmlFor = "routing-provider-select";
  routingProviderLabel.innerText = "Routing Provider";
  const routingProviderSelect = L.DomUtil.create("select", "", routingProviderContainer);
  routingProviderSelect.id = "routing-provider-select";
  routingProviderSelect.innerHTML = `<option value="mapbox">Mapbox</option><option value="osrm">OSRM (Demo)</option>`;
  routingProviderSelect.value = localStorage.getItem("routingProvider") || "mapbox";
  L.DomEvent.on(routingProviderSelect, "change", (e) => {
    const newProvider = e.target.value;
    localStorage.setItem("routingProvider", newProvider);
    window.app.switchRoutingProvider(newProvider);
    Swal.fire({
      toast: true,
      icon: "info",
      title: `Routing provider set to ${e.target.options[e.target.selectedIndex].text}`,
      showConfirmButton: false,
      timer: 1500,
    });
  });
  L.DomEvent.on(routingProviderContainer, "dblclick mousedown wheel", L.DomEvent.stopPropagation);

  const elevationProviderContainer = L.DomUtil.create(
    "div",
    "settings-control-item",
    settingsPanel,
  );
  const elevationProviderLabel = L.DomUtil.create("label", "", elevationProviderContainer);
  elevationProviderLabel.htmlFor = "elevation-provider-select";
  elevationProviderLabel.innerText = "Elevation Provider";
  const elevationProviderSelect = L.DomUtil.create("select", "", elevationProviderContainer);
  elevationProviderSelect.id = "elevation-provider-select";
  elevationProviderSelect.innerHTML = `<option value="google">Google</option><option value="geoadmin">GeoAdmin (Switzerland)</option>`;
  elevationProviderSelect.value = localStorage.getItem("elevationProvider") || "google";
  L.DomEvent.on(elevationProviderSelect, "change", (e) => {
    const newProvider = e.target.value;
    localStorage.setItem("elevationProvider", newProvider);
    clearElevationCache();
    Swal.fire({
      toast: true,
      icon: "info",
      title: `Elevation provider set to ${e.target.options[e.target.selectedIndex].text}`,
      showConfirmButton: false,
      timer: 1500,
    });
  });
  L.DomEvent.on(elevationProviderContainer, "dblclick mousedown wheel", L.DomEvent.stopPropagation);

  const preferFileElevationContainer = L.DomUtil.create(
    "div",
    "settings-control-item",
    settingsPanel,
  );
  const preferFileElevationLabel = L.DomUtil.create("label", "", preferFileElevationContainer);
  preferFileElevationLabel.htmlFor = "prefer-file-elevation-checkbox";
  preferFileElevationLabel.innerText = "Prefer file elevation data";
  const preferFileElevationCheckbox = L.DomUtil.create("input", "", preferFileElevationContainer);
  preferFileElevationCheckbox.type = "checkbox";
  preferFileElevationCheckbox.id = "prefer-file-elevation-checkbox";
  preferFileElevationCheckbox.checked = localStorage.getItem("preferFileElevation") !== "false"; // Default to true
  L.DomEvent.on(preferFileElevationCheckbox, "change", (e) => {
    const shouldPrefer = e.target.checked;
    localStorage.setItem("preferFileElevation", shouldPrefer.toString());
    clearElevationCache();
    Swal.fire({
      toast: true,
      icon: "info",
      title: shouldPrefer ? "Will prefer file elevation data" : "Will prefer API elevation data",
      showConfirmButton: false,
      timer: 1500,
    });
  });
  L.DomEvent.on(
    preferFileElevationContainer,
    "dblclick mousedown wheel",
    L.DomEvent.stopPropagation,
  );

  const aboutContainer = L.DomUtil.create("div", "settings-control-item", settingsPanel);
  const aboutLabel = L.DomUtil.create("label", "", aboutContainer);
  aboutLabel.innerText = "About";
  aboutLabel.style.color = "var(--text-color)";
  const creditsLink = L.DomUtil.create("a", "", aboutContainer);
  creditsLink.href = "#";
  creditsLink.innerText = "View Credits";
  creditsLink.classList.add("credits-link");

  L.DomEvent.on(creditsLink, "click", (e) => {
    L.DomEvent.stop(e);
    showCreditsPopup();
  });

  const privacyPolicyContainer = L.DomUtil.create("div", "settings-control-item", settingsPanel);
  const privacyPolicyLabel = L.DomUtil.create("label", "", privacyPolicyContainer);
  privacyPolicyLabel.innerText = "Legal";
  privacyPolicyLabel.style.color = "var(--text-color)";
  const privacyPolicyLink = L.DomUtil.create("a", "", privacyPolicyContainer);
  privacyPolicyLink.href = "/privacy.html";
  privacyPolicyLink.target = "_blank";
  privacyPolicyLink.innerText = "View Privacy Policy";
  privacyPolicyLink.style.fontSize = "var(--font-size-14)";
  privacyPolicyLink.style.color = "var(--link-color)";

  const devPanelContainer = L.DomUtil.create("div", "settings-control-item", settingsPanel);
  devPanelContainer.id = "settings-dev-panel";
  const devPanelLabel = L.DomUtil.create("label", "", devPanelContainer);
  devPanelLabel.innerText = "Developer";
  devPanelLabel.style.color = "var(--text-color)";
  const devPanelLink = L.DomUtil.create("a", "", devPanelContainer);
  devPanelLink.href = "#";
  devPanelLink.innerText = "Open Developer Panel";
  devPanelLink.style.fontSize = "var(--font-size-14)";
  devPanelLink.style.color = "var(--link-color)";

  L.DomEvent.on(devPanelLink, "click", (e) => {
    L.DomEvent.stop(e);
    if (typeof window.toggleDevPanel === "function") {
      window.toggleDevPanel();
    }
  });
}
