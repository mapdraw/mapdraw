// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// File Controls
// The Import and Download toolbar buttons — both are thin UI wrappers
// around the import/export functions in file-handlers.js.

/**
 * Creates the Import and Download map controls.
 */
function initFileControls() {
  const DownloadControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd: function (map) {
      const container = L.DomUtil.create(
        "div",
        "leaflet-bar leaflet-control leaflet-control-custom",
      );
      container.title = "Download or share";
      container.id = "download-button";
      container.style.position = "relative";
      container.innerHTML =
        '<a href="#" role="button"></a>' +
        '<div class="download-submenu">' +
        '<div class="download-rows">' +
        '<div class="download-row">' +
        '<span class="download-row-label" title="">GeoJSON</span>' +
        '<button id="download-geojson-selected" disabled title="Select an item to download as GeoJSON">Selected</button>' +
        '<button id="download-geojson-all" title="Download everything as GeoJSON">All</button>' +
        "</div>" +
        '<div class="download-row">' +
        '<span class="download-row-label" title="">GPX</span>' +
        '<button id="download-gpx-selected" disabled title="Select an item to download as GPX">Selected</button>' +
        '<button id="download-gpx-all" title="Download everything as GPX">All</button>' +
        "</div>" +
        '<div class="download-row" id="download-strava-row" style="display: none">' +
        '<span class="download-row-label" title="">GPX</span>' +
        '<button id="download-gpx-strava-original" title="Download the original GPX file from Strava">Original Strava</button>' +
        "</div>" +
        '<div class="download-row">' +
        '<span class="download-row-label" title="">KML</span>' +
        '<button id="download-kml-selected" disabled title="Select an item to download as KML">Selected</button>' +
        '<button id="download-kml-all" title="Download everything as KML">All</button>' +
        "</div>" +
        '<div class="download-row">' +
        '<span class="download-row-label" title="">Share Link</span>' +
        '<button id="download-share-selected" disabled title="Select an item to copy a share link for">Selected</button>' +
        '<button id="download-share-all" title="Copy a share link for everything">All</button>' +
        "</div>" +
        "</div>" +
        "</div>";
      const subMenu = container.querySelector(".download-submenu");

      L.DomEvent.on(container, "click", (ev) => {
        L.DomEvent.stop(ev);
        // If the container is disabled, exit the function immediately.
        if (L.DomUtil.hasClass(container, "disabled")) {
          return;
        }
        togglePanelMode(
          "download-menu",
          () => subMenu.style.display === "block",
          () => (subMenu.style.display = "block"),
          () => (subMenu.style.display = "none"),
        );
      });

      // Sync download-button active highlight with submenu visibility
      new MutationObserver(() => {
        container.classList.toggle("active", subMenu.style.display === "block");
      }).observe(subMenu, { attributes: true, attributeFilter: ["style"] });

      // GPX: always the local converter, bundled into one file when there's
      // more than one layer. Fetching the original file(s) from Strava is a
      // separate, explicit action - see the "Original Strava" button below.
      L.DomEvent.on(container.querySelector("#download-gpx-selected"), "click", (e) => {
        L.DomEvent.stop(e);
        exportGpx({ layers: getCurrentSelectionLayers() });
        subMenu.style.display = "none";
      });
      L.DomEvent.on(container.querySelector("#download-gpx-all"), "click", (e) => {
        L.DomEvent.stop(e);
        exportGpx();
        subMenu.style.display = "none";
      });

      // Original Strava: only shown when the whole selection is real Strava
      // activities. A single one downloads immediately, same as before. For
      // multiple, browsers only allow one script-triggered download per
      // genuine click, so instead we list real, individually-clickable
      // links - an actual anchor click bypasses that restriction entirely.
      L.DomEvent.on(container.querySelector("#download-gpx-strava-original"), "click", (e) => {
        L.DomEvent.stop(e);
        const layers = getCurrentSelectionLayers();
        subMenu.style.display = "none";
        if (layers.length === 0) return;

        if (layers.length === 1) {
          const { stravaId, name } = layers[0].feature.properties;
          downloadOriginalStravaGpx(stravaId, name);
          return;
        }

        const links = layers
          .map((layer, i) => {
            const { stravaId, name } = layer.feature.properties;
            const style = i === 0 ? "" : ' style="margin-top: 4px;"';
            return `<li${style}><a href="${stravaGpxExportUrl(stravaId)}" target="_blank" rel="noopener noreferrer">${escapeXml(name)}</a></li>`;
          })
          .join("");
        Swal.fire({
          title: "Download Original Strava GPX Files",
          html: `
            <p style="text-align: left; margin: 0;">Click each link to download its original file from Strava:</p>
            <ul style="margin: 4px 0; padding-left: 20px; text-align: left;">${links}</ul>
          `,
        });
      });

      L.DomEvent.on(container.querySelector("#download-geojson-selected"), "click", (e) => {
        L.DomEvent.stop(e);
        exportGeoJson({ mode: "selection", layers: getCurrentSelectionLayers() });
        subMenu.style.display = "none";
      });
      L.DomEvent.on(container.querySelector("#download-geojson-all"), "click", (e) => {
        L.DomEvent.stop(e);
        exportGeoJson();
        subMenu.style.display = "none";
      });

      L.DomEvent.on(container.querySelector("#download-kml-selected"), "click", (e) => {
        L.DomEvent.stop(e);
        exportKml({ layers: getCurrentSelectionLayers() });
        subMenu.style.display = "none";
      });
      L.DomEvent.on(container.querySelector("#download-kml-all"), "click", (e) => {
        L.DomEvent.stop(e);
        exportKml();
        subMenu.style.display = "none";
      });

      // Share Link: shared copy/toast logic for both scopes - only the layer
      // list (or null for "everything") differs.
      const copyShareLinkForLayers = async (layers) => {
        let shareUrl;
        try {
          shareUrl = await buildShareableUrl(layers);
        } catch {
          Swal.fire({
            toast: true,
            icon: "error",
            title: "Sharing not supported in this browser",
            position: "top",
            showConfirmButton: false,
            timer: 3000,
          });
          return;
        }
        if (!shareUrl) {
          Swal.fire({
            toast: true,
            icon: "info",
            title: "Nothing to share",
            position: "top",
            showConfirmButton: false,
            timer: 2000,
          });
        } else {
          try {
            await copyToClipboard(shareUrl);

            // Warn users about URL length limits
            if (shareUrl.length > 2000) {
              Swal.fire({
                icon: "warning",
                title: "Large Share Link Copied!",
                html: `This link is <strong>${shareUrl.length}</strong> characters and may not work in all browsers or messaging apps.`,
                confirmButtonText: "OK",
              });
            } else {
              Swal.fire({
                toast: true,
                icon: "success",
                title: `Share Link Copied!<br>(${shareUrl.length} characters)`,
                position: "top",
                showConfirmButton: false,
                timer: 2000,
              });
            }
          } catch {
            Swal.fire({
              toast: true,
              icon: "error",
              title: "Failed to Copy",
              position: "top",
              showConfirmButton: false,
              timer: 2000,
            });
          }
        }
        subMenu.style.display = "none";
      };

      L.DomEvent.on(container.querySelector("#download-share-selected"), "click", async (e) => {
        L.DomEvent.stop(e);
        await copyShareLinkForLayers(getCurrentSelectionLayers());
      });
      L.DomEvent.on(container.querySelector("#download-share-all"), "click", async (e) => {
        L.DomEvent.stop(e);
        await copyShareLinkForLayers(null);
      });
      return container;
    },
  });

  const ImportControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd: function (map) {
      const container = L.DomUtil.create(
        "div",
        "leaflet-bar leaflet-control leaflet-control-custom",
      );
      container.id = "import-button";
      container.title = "Import GeoJSON/GPX/KML/KMZ file";
      const link = L.DomUtil.create("a", "", container);
      link.href = "#";
      link.role = "button";
      link.innerHTML = "";
      const input = L.DomUtil.create("input", "hidden", container);
      input.type = "file";
      input.style.display = "none";

      L.DomEvent.on(link, "click", (e) => {
        L.DomEvent.stop(e);
        input.click();
        container.classList.add("active");
        window.addEventListener("focus", () => container.classList.remove("active"), {
          once: true,
        });
      });

      L.DomEvent.on(input, "change", (e) => {
        container.classList.remove("active");
        const file = e.target.files[0];
        if (!file) return;
        const fileNameLower = file.name.toLowerCase();

        if (fileNameLower.endsWith(".geojson") || fileNameLower.endsWith(".json")) {
          importGeoJsonFile(file);
        } else if (fileNameLower.endsWith(".gpx")) {
          importGpxFile(file);
        } else if (fileNameLower.endsWith(".kml")) {
          importKmlFile(file);
        } else if (fileNameLower.endsWith(".kmz")) {
          importKmzFile(file);
        } else {
          Swal.fire({
            title: "Unsupported File Type",
            text: "Please select a GeoJSON, GPX, KML, or KMZ file.",
          });
        }
        e.target.value = "";
      });
      return container;
    },
  });

  new ImportControl().addTo(map);
  downloadControl = new DownloadControl({ position: "topleft" }).addTo(map);

  document.addEventListener(
    "click",
    function (event) {
      const downloadMenu = document.querySelector(".download-submenu");
      const downloadButton = document.getElementById("download-button");

      if (
        downloadMenu &&
        downloadButton &&
        downloadMenu.style.display === "block" &&
        !downloadButton.contains(event.target) &&
        !downloadMenu.contains(event.target)
      ) {
        closePanelMode("download-menu", () => (downloadMenu.style.display = "none"));
      }
    },
    true,
  );
}
