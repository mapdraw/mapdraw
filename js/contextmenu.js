// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Context Menu Module
// This module handles the right-click context menu on the map,
// providing options to copy coordinates, set routing points, and edit on OpenStreetMap.
function initializeContextMenu(map) {
  const showMapContextMenu = (e) => {
    // latlng stays unwrapped for popup positioning (avoids jumping across world copies).
    // wrappedLatlng normalizes longitude to ±180 for all display and action use.
    let latlng = e.latlng;
    let wrappedLatlng = latlng.wrap();

    const popupContent = document.createElement("div");
    popupContent.style.textAlign = "center";
    popupContent.style.cursor = "move";

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

    const coordRow = document.createElement("div");
    coordRow.style.display = "flex";
    popupContent.appendChild(coordRow);

    const latSpan = document.createElement("span");
    const lngSpan = document.createElement("span");

    latSpan.style.flex = "1";
    latSpan.style.textAlign = "center";
    lngSpan.style.flex = "1";
    lngSpan.style.textAlign = "center";
    coordRow.appendChild(latSpan);
    coordRow.appendChild(lngSpan);

    const updateCoords = () => {
      wrappedLatlng = latlng.wrap();
      latSpan.textContent = wrappedLatlng.lat.toFixed(6);
      lngSpan.textContent = wrappedLatlng.lng.toFixed(6);
    };
    updateCoords();

    const createMenuRow = (items) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "2px";
      row.style.margin = "2px 0";
      items.forEach(({ text, onClick }) => {
        const btn = document.createElement("div");
        btn.textContent = text;
        btn.style.flex = "1";
        btn.style.minWidth = "0";
        btn.style.textAlign = "center";
        btn.style.whiteSpace = "nowrap";
        btn.style.padding = "4px 3px";
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
            const coordString = `${wrappedLatlng.lat.toFixed(6)}, ${wrappedLatlng.lng.toFixed(6)}`;
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
            createAndSaveMarker(wrappedLatlng);
            map.closePopup();
          },
        },
      ]),
    );

    popupContent.appendChild(
      createMenuRow([
        {
          text: "Route Start",
          onClick: () => {
            if (window.app && typeof window.app.updateRoutingPoint === "function") {
              window.app.updateRoutingPoint(wrappedLatlng, "start");
            }
            showRoutingPanel();
          },
        },
        {
          text: "Route End",
          onClick: () => {
            if (window.app && typeof window.app.updateRoutingPoint === "function") {
              window.app.updateRoutingPoint(wrappedLatlng, "end");
            }
            showRoutingPanel();
          },
        },
      ]),
    );

    if (typeof osmIsSignedIn === "function") {
      const osmSignInToast = () => {
        map.closePopup();
        Swal.fire({
          toast: true,
          icon: "info",
          title: "Sign in to OpenStreetMap in Settings to contribute.",
          showConfirmButton: false,
          timer: 3000,
        });
      };
      popupContent.appendChild(
        createMenuRow([
          {
            text: "OSM Note",
            onClick: () => {
              if (!osmIsSignedIn()) {
                osmSignInToast();
                return;
              }
              map.closePopup();
              osmShowNotePicker(wrappedLatlng);
            },
          },
          {
            text: "Add to OSM",
            onClick: () => {
              if (!osmIsSignedIn()) {
                osmSignInToast();
                return;
              }
              map.closePopup();
              osmShowContributePicker(wrappedLatlng);
            },
          },
        ]),
      );
    }

    let debugDot;

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
        debugDot?.setLatLng(latlng);
      };

      onMove(move);
    };

    // Whole-menu drag: 5px threshold distinguishes drag from click; on mouseup after a drag,
    // a capture-phase click listener fires once to swallow the browser-generated click so
    // buttons under the cursor don't trigger. touchstart is not stopped so taps still work —
    // preventDefault is deferred to touchmove once dragging is confirmed.
    L.DomEvent.on(popupContent, "mousedown", (startE) => {
      L.DomEvent.stop(startE);
      startDrag(startE.clientX, startE.clientY, (move) => {
        let dragging = false;
        const onMove = (ev) => {
          if (!dragging) {
            const dx = ev.clientX - startE.clientX;
            const dy = ev.clientY - startE.clientY;
            if (Math.sqrt(dx * dx + dy * dy) >= 5) dragging = true;
          }
          if (dragging) move(ev.clientX, ev.clientY);
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          if (dragging) {
            document.addEventListener(
              "click",
              (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
              },
              { capture: true, once: true },
            );
          }
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    });

    L.DomEvent.on(popupContent, "touchstart", (startE) => {
      const t = startE.touches[0];
      startDrag(t.clientX, t.clientY, (move) => {
        let dragging = false;
        const onMove = (ev) => {
          const touch = ev.touches[0];
          if (!dragging) {
            const dx = touch.clientX - t.clientX;
            const dy = touch.clientY - t.clientY;
            if (Math.sqrt(dx * dx + dy * dy) >= 5) dragging = true;
          }
          if (dragging) {
            ev.preventDefault();
            move(touch.clientX, touch.clientY);
          }
        };
        const onEnd = () => {
          popupContent.removeEventListener("touchmove", onMove);
          popupContent.removeEventListener("touchend", onEnd);
        };
        popupContent.addEventListener("touchmove", onMove, { passive: false });
        popupContent.addEventListener("touchend", onEnd);
      });
    });

    const popup = L.popup({ closeButton: false, className: "context-menu-popup", autoPan: false }) // autoPan: false — otherwise dragging beyond the map edges scrolls the map
      .setLatLng(latlng)
      .setContent(popupContent)
      .openOn(map);

    const popupEl = popup.getElement();
    popupEl.style.overflow = "visible"; // allows side pills to render outside popup bounds

    const tipContainer = popupEl.querySelector(".leaflet-popup-tip-container");
    tipContainer.style.display = "flex";
    tipContainer.style.justifyContent = "center";
    tipContainer.style.overflow = "visible";
    tipContainer.style.height = "auto";
    tipContainer.innerHTML = "";
    const anchorIcon = document.createElement("span");
    anchorIcon.className = "material-symbols";
    anchorIcon.textContent = "add";
    anchorIcon.style.color = "#000000";
    anchorIcon.style.setProperty("font-size", "24px", "important");
    anchorIcon.style.lineHeight = "1";
    anchorIcon.style.marginTop = "2px";
    tipContainer.appendChild(anchorIcon);

    const makeSidePill = (side) => {
      const icon = document.createElement("span");
      icon.className = "material-symbols";
      icon.textContent = "drag_pan";
      icon.style.setProperty("font-size", "var(--icon-size-16)", "important");
      icon.style.color = "#ffffff";

      const pill = document.createElement("div");
      pill.style.backgroundColor = "var(--highlight-color)";
      pill.style.borderRadius = "100px";
      pill.style.padding = "3px 6px";
      pill.style.display = "flex";
      pill.style.alignItems = "center";
      pill.style.justifyContent = "center";
      pill.style.position = "absolute";
      pill.style.bottom = "-16px";
      pill.style[side] = "-14px";
      pill.style.cursor = "move";
      pill.style.userSelect = "none";
      pill.appendChild(icon);
      popupEl.appendChild(pill);

      L.DomEvent.on(pill, "mousedown", (startE) => {
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
        pill,
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
              pill.removeEventListener("touchmove", onMove);
              pill.removeEventListener("touchend", onEnd);
            };
            pill.addEventListener("touchmove", onMove, { passive: false });
            pill.addEventListener("touchend", onEnd);
          });
        },
        { passive: false },
      );
    };

    makeSidePill("left");
    makeSidePill("right");

    // DEBUG: red dot at exact latlng to verify arrow alignment
    // debugDot = L.circleMarker(latlng, {
    //   radius: 4,
    //   color: "red",
    //   fillColor: "red",
    //   fillOpacity: 1,
    //   weight: 0,
    // }).addTo(map);
    // popup.on("remove", () => map.removeLayer(debugDot));
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
      // ".leaflet-overlay-pane",
      // ".leaflet-marker-pane",
    ];

    // Check if the click originated inside any of the specified UI containers.
    const clickedOnUi = e.originalEvent.target.closest(uiSelectors.join(", "));

    if (
      !clickedOnUi &&
      !window.app?.isPenModeActive?.() &&
      !window.app?.isRectangleSelectActive?.()
    ) {
      // Close any existing popups before opening the context menu
      map.closePopup();
      showMapContextMenu(e);
    }
  });
}
