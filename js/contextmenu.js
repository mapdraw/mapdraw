// Copyright (C) 2025 Aron Sommer. See LICENSE file for full license details.

// Context Menu Module
// This module handles the right-click context menu on the map,
// providing options to copy coordinates, set routing points, and edit on OpenStreetMap.
function initializeContextMenu(map) {
  /**
   * Creates and displays the map's context menu in a popup.
   * @param {L.LeafletEvent} e - The map event object
   */
  const showMapContextMenu = (e) => {
    const latlng = e.latlng;
    const displayedCoordString = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
    const fullCoordString = `${latlng.lat}, ${latlng.lng}`;

    const popupContent = document.createElement("div");
    popupContent.style.textAlign = "center";
    popupContent.style.cursor = "default";

    const showRoutingPanel = () => {
      document.getElementById("main-right-container").classList.remove("hidden");
      const toggleButton = document.getElementById("sidebar-toggle-btn");
      if (toggleButton) {
        toggleButton.classList.add("panels-visible");
        toggleButton.classList.remove("panels-hidden");
      }
      document.getElementById("tab-btn-routing").click();
      map.closePopup();
    };

    const coordsDiv = document.createElement("div");
    coordsDiv.innerHTML = `<span>${displayedCoordString}</span>`;
    popupContent.appendChild(coordsDiv);

    const createBtn = (text, onClick) => {
      const btn = document.createElement("div");
      btn.textContent = text;
      btn.style.cursor = "pointer";
      btn.style.textAlign = "center";
      btn.style.whiteSpace = "nowrap";
      btn.style.padding = "4px 6px";
      btn.style.border = "1px solid var(--border-color)";
      btn.style.borderRadius = "var(--border-radius)";
      btn.style.userSelect = "none";
      btn.style.margin = "2px 0";
      btn.addEventListener("click", onClick);
      return btn;
    };

    const createMenuRow = (items) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "2px";
      row.style.margin = "2px 0";
      items.forEach(({ text, onClick }) => {
        const btn = document.createElement("div");
        btn.textContent = text;
        btn.style.cursor = "pointer";
        btn.style.flex = "1";
        btn.style.textAlign = "center";
        btn.style.whiteSpace = "nowrap";
        btn.style.padding = "4px 6px";
        btn.style.border = "1px solid var(--border-color)";
        btn.style.borderRadius = "var(--border-radius)";
        btn.style.userSelect = "none";
        btn.addEventListener("click", onClick);
        row.appendChild(btn);
      });
      return row;
    };

    popupContent.appendChild(
      createMenuRow([
        {
          text: "Copy Coords",
          onClick: () => {
            copyToClipboard(fullCoordString)
              .then(() => {
                map.closePopup();
                Swal.fire({
                  toast: true,
                  icon: "success",
                  title: "Coordinates Copied!",
                  html: fullCoordString,
                  showConfirmButton: false,
                  timer: 1500,
                });
              })
              .catch((err) => {
                console.error("Could not copy text: ", err);
                map.closePopup();
                Swal.fire({
                  toast: true,
                  icon: "error",
                  title: "Failed to Copy",
                  showConfirmButton: false,
                  timer: 2000,
                });
              });
          },
        },
        {
          text: "Place Marker",
          onClick: () => {
            createAndSaveMarker(latlng);
            map.closePopup();
          },
        },
      ]),
    );

    popupContent.appendChild(
      createMenuRow([
        {
          text: "Route from",
          onClick: () => {
            if (window.app && typeof window.app.updateRoutingPoint === "function") {
              window.app.updateRoutingPoint(latlng, "start");
            }
            showRoutingPanel();
          },
        },
        {
          text: "Route to",
          onClick: () => {
            if (window.app && typeof window.app.updateRoutingPoint === "function") {
              window.app.updateRoutingPoint(latlng, "end");
            }
            showRoutingPanel();
          },
        },
      ]),
    );

    popupContent.appendChild(
      createBtn("Edit on OpenStreetMap", () => {
        const zoom = map.getZoom();
        const url = `${OSM_BASE}/edit?editor=id#map=${zoom}/${latlng.lat}/${latlng.lng}`;
        window.open(url, "_blank");
        map.closePopup();
      }),
    );

    if (typeof osmShowNotePicker === "function" && osmIsSignedIn()) {
      popupContent.appendChild(
        createBtn("Add Note on OpenStreetMap", () => {
          map.closePopup();
          osmShowNotePicker(latlng);
        }),
      );
    }

    if (typeof osmIsSignedIn === "function" && osmIsSignedIn()) {
      popupContent.appendChild(
        createBtn("Add to OpenStreetMap", () => {
          map.closePopup();
          osmShowContributePicker(latlng);
        }),
      );
    }

    L.popup({ closeButton: false, className: "context-menu-popup" })
      .setLatLng(latlng)
      .setContent(popupContent)
      .openOn(map);
  };

  // This single event listener handles both desktop right-click and mobile long-press
  map.on("contextmenu", (e) => {
    // A list of UI container selectors where the context menu should NOT appear.
    const uiSelectors = [
      "#top-right-container",
      "#main-right-container",
      "#custom-layers-panel",
      "#elevation-div",
      ".leaflet-control-container",
      ".leaflet-popup-pane",
      //   ".leaflet-overlay-pane",
      //   ".leaflet-marker-pane",
    ];

    // Check if the click originated inside any of the specified UI containers.
    const clickedOnUi = e.originalEvent.target.closest(uiSelectors.join(", "));

    if (!clickedOnUi && !window.app?.isPenModeActive?.()) {
      // Close any existing popups before opening the context menu
      map.closePopup();
      showMapContextMenu(e);
    }
  });
}
