// Copyright (C) 2025 Aron Sommer. See LICENSE file for full license details.

// Context Menu Module
// This module handles the right-click context menu on the map,
// providing options to copy coordinates, set routing points, and edit on OpenStreetMap.
function initializeContextMenu(map) {
  const showMapContextMenu = (e) => {
    let latlng = e.latlng;

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

    const dragHandle = document.createElement("div");
    dragHandle.style.display = "grid";
    dragHandle.style.gridTemplateColumns = "1fr auto 1fr";
    dragHandle.style.alignItems = "center";
    dragHandle.style.cursor = "move";
    dragHandle.style.userSelect = "none";
    popupContent.appendChild(dragHandle);

    const latSpan = document.createElement("span");
    const lngSpan = document.createElement("span");
    const dragIcon = document.createElement("span");
    dragIcon.className = "material-symbols";
    dragIcon.textContent = "drag_indicator";
    dragIcon.style.fontSize = "16px";
    dragIcon.style.color = "var(--text-color)";

    latSpan.style.textAlign = "center";
    lngSpan.style.textAlign = "center";
    dragHandle.appendChild(latSpan);
    dragHandle.appendChild(dragIcon);
    dragHandle.appendChild(lngSpan);

    const updateCoords = () => {
      latSpan.textContent = latlng.lat.toFixed(5);
      lngSpan.textContent = latlng.lng.toFixed(5);
    };
    updateCoords();

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
            const coordString = `${latlng.lat}, ${latlng.lng}`;
            copyToClipboard(coordString)
              .then(() => {
                map.closePopup();
                Swal.fire({
                  toast: true,
                  icon: "success",
                  title: "Coordinates Copied!",
                  html: coordString,
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

    const clientToContainerPoint = (clientX, clientY) => {
      const rect = map.getContainer().getBoundingClientRect();
      return L.point(clientX - rect.left, clientY - rect.top);
    };

    const startDrag = (startClientX, startClientY, onMove) => {
      const grabPx = clientToContainerPoint(startClientX, startClientY);
      const tipPx = map.latLngToContainerPoint(latlng);
      const offset = grabPx.subtract(tipPx);

      const move = (clientX, clientY) => {
        const cursorPx = clientToContainerPoint(clientX, clientY);
        latlng = map.containerPointToLatLng(cursorPx.subtract(offset));
        popup.setLatLng(latlng);
        updateCoords();
      };

      onMove(move);
    };

    L.DomEvent.on(dragHandle, "mousedown", (startE) => {
      L.DomEvent.stop(startE);
      startDrag(startE.clientX, startE.clientY, (move) => {
        const onMove = (ev) => move(ev.clientX, ev.clientY);
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    });

    L.DomEvent.on(
      dragHandle,
      "touchstart",
      (startE) => {
        L.DomEvent.stop(startE);
        const t = startE.touches[0];
        startDrag(t.clientX, t.clientY, (move) => {
          const onMove = (ev) => {
            ev.preventDefault();
            move(ev.touches[0].clientX, ev.touches[0].clientY);
          };
          const onEnd = () => {
            dragHandle.removeEventListener("touchmove", onMove);
            dragHandle.removeEventListener("touchend", onEnd);
          };
          dragHandle.addEventListener("touchmove", onMove, { passive: false });
          dragHandle.addEventListener("touchend", onEnd);
        });
      },
      { passive: false },
    );

    const popup = L.popup({ closeButton: false, className: "context-menu-popup" })
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
