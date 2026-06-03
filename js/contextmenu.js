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

    const divider = document.createElement("hr");
    divider.style.margin = "4px 0";
    divider.style.border = "none";
    divider.style.borderTop = "1px solid var(--divider-color)";
    popupContent.appendChild(divider);

    const createMenuItem = (text, onClick) => {
      const div = document.createElement("div");
      div.textContent = text;
      div.style.cursor = "pointer";
      div.style.padding = "4px 0";
      div.addEventListener("click", onClick);
      return div;
    };

    popupContent.appendChild(
      createMenuItem("Copy Coordinates", () => {
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
      }),
    );

    popupContent.appendChild(
      createMenuItem("Place Marker", () => {
        createAndSaveMarker(latlng);
        map.closePopup();
      }),
    );

    popupContent.appendChild(
      createMenuItem("Route from here", () => {
        if (window.app && typeof window.app.updateRoutingPoint === "function") {
          window.app.updateRoutingPoint(latlng, "start");
        }
        showRoutingPanel();
      }),
    );

    popupContent.appendChild(
      createMenuItem("Route to here", () => {
        if (window.app && typeof window.app.updateRoutingPoint === "function") {
          window.app.updateRoutingPoint(latlng, "end");
        }
        showRoutingPanel();
      }),
    );

    popupContent.appendChild(
      createMenuItem("Edit on OpenStreetMap", () => {
        const zoom = map.getZoom();
        const url = `https://www.openstreetmap.org/edit?editor=id#map=${zoom}/${latlng.lat}/${latlng.lng}`;
        window.open(url, "_blank");
        map.closePopup();
      }),
    );

    if (typeof osmIsSignedIn === "function" && osmIsSignedIn()) {
      popupContent.appendChild(
        createMenuItem("Add to OpenStreetMap", async () => {
          map.closePopup();
          try {
            const nodeId = await osmSubmitNode(latlng, { amenity: "bench" });
            Swal.fire({
              toast: true,
              icon: "success",
              title: "Submitted to OSM",
              html: `Node <a href="https://master.apis.dev.openstreetmap.org/node/${nodeId}" target="_blank">#${nodeId}</a> created`,
              showConfirmButton: false,
              timer: 4000,
            });
          } catch (error) {
            Swal.fire({ title: "Submission Failed", html: error.message });
          }
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
