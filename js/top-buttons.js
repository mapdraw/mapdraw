// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Top Buttons
// Wires up the fullscreen, sidebar toggle, POI finder, and search buttons.

/**
 * Creates the fullscreen, sidebar toggle, POI finder, and search buttons.
 */
function initTopButtons() {
  // Fullscreen button
  const fullscreenBtn = document.getElementById("fullscreen-btn");

  function toggleFullscreen() {
    const btn = document.getElementById("fullscreen-btn");
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      btn.classList.add("fullscreen-active");
    } else {
      document.exitFullscreen();
      btn.classList.remove("fullscreen-active");
    }
  }

  fullscreenBtn.addEventListener("click", (e) => {
    e.preventDefault();
    toggleFullscreen();
  });

  document.addEventListener("fullscreenchange", () => {
    const btn = document.getElementById("fullscreen-btn");
    if (document.fullscreenElement) {
      btn.classList.add("fullscreen-active");
    } else {
      btn.classList.remove("fullscreen-active");
    }
  });

  // Auto-enter fullscreen on first tap when running as installed mobile PWA
  const isInstalledPWA = window.matchMedia("(display-mode: standalone)").matches;
  if (isInstalledPWA && navigator.maxTouchPoints > 0) {
    document.addEventListener(
      "click",
      () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      },
      { once: true },
    );
  }

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    if (e.key.toLowerCase() === "f") {
      e.preventDefault();
      toggleFullscreen();
    }
  });

  // Sidebar toggle button
  const sidebarToggleBtn = document.getElementById("sidebar-toggle-btn");
  sidebarToggleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const panelContainer = document.getElementById("main-right-container");
    panelContainer.classList.toggle("hidden");
    sidebarToggleBtn.classList.toggle("panels-visible");
    sidebarToggleBtn.classList.toggle("panels-hidden");

    if (!panelContainer.classList.contains("hidden") && getEffectiveSelectedLayer()) {
      adjustInfoPanelNameHeight(infoPanelName);
    }
  });

  // POI finder button
  const poiFinderBtn = document.getElementById("poi-finder-btn");
  if (poiFinderBtn) {
    poiFinderBtn.addEventListener("click", (e) => {
      e.preventDefault();
      showPoiFinder();
    });
  }

  // Search button
  const searchBtn = document.getElementById("search-btn");

  const onSearchResult = (locationLatLng, label) => {
    if (temporarySearchMarker) {
      map.removeLayer(temporarySearchMarker);
      temporarySearchMarker = null;
    }

    temporarySearchMarker = L.marker(locationLatLng, {
      icon: createMarkerIcon(COLOR_BLACK, 1),
      interactive: true,
    }).addTo(map);

    const popupContent = document.createElement("div");
    popupContent.style.textAlign = "center";
    popupContent.innerHTML = `<div style="font-weight: bold; margin-bottom: 8px;">${escHtml(label)}</div>`;

    const saveButton = document.createElement("button");
    saveButton.textContent = "Save to Map";
    saveButton.style.cssText =
      "padding: 5px 10px; border: 1px solid #ccc; border-radius: var(--border-radius); cursor: pointer; background-color: #f0f0f0;";
    popupContent.appendChild(saveButton);

    L.DomEvent.on(saveButton, "click", () => {
      const plainLabel = label.replace(/<[^>]*>/g, "").trim();
      createAndSaveMarker(locationLatLng, plainLabel);

      // Clean up the temporary marker and input
      if (temporarySearchMarker) {
        map.removeLayer(temporarySearchMarker);
        temporarySearchMarker = null;
      }
      map.closePopup();
    });

    temporarySearchMarker
      .bindPopup(popupContent, { maxWidth: 150, closeButton: false })
      .openPopup();

    temporarySearchMarker.on("popupclose", () => {
      if (temporarySearchMarker && map.hasLayer(temporarySearchMarker)) {
        map.removeLayer(temporarySearchMarker);
        temporarySearchMarker = null;
      }
    });

    map.flyTo(locationLatLng, map.getZoom() < 16 ? 16 : map.getZoom());
  };

  // Exposed for use in osm.js contributions panel
  window.showSearchMarker = onSearchResult;

  // Attach search modal to search button
  attachSearchModalToInput(searchBtn, "Search Location", onSearchResult);
}
