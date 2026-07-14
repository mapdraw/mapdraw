// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * Creates the locate (geolocation) control, including the custom
 * compass-heading marker used in place of Leaflet.Locate's default circle.
 */
function initLocateControl() {
  const CUSTOM_LOCATE_ICON_SIZE = 50;

  // Static location arrow icon (used for testing alignment without rotation)
  const locationArrowIcon = L.divIcon({
    html: `<img src="/img/location-arrow.svg" style="width: ${CUSTOM_LOCATE_ICON_SIZE}px; height: ${CUSTOM_LOCATE_ICON_SIZE}px;">`,
    className: "custom-locate-icon",
    iconSize: [CUSTOM_LOCATE_ICON_SIZE, CUSTOM_LOCATE_ICON_SIZE],
    iconAnchor: [(100 / 230) * CUSTOM_LOCATE_ICON_SIZE, (150 / 245) * CUSTOM_LOCATE_ICON_SIZE],
  });

  // Custom compass marker that extends L.Control.Locate.LocationMarker (normally a circle)
  // Adds compass heading support and uses a custom arrow image (location-arrow.svg)
  // that rotates based on device heading
  const locationCompassArrowIcon = L.Control.Locate.LocationMarker.extend({
    initialize(latlng, heading, options) {
      leaflet.setOptions(this, options);
      this._latlng = latlng;
      this._heading = heading;
      this.createIcon();
    },

    setHeading(heading) {
      this._heading = heading;
      if (this._icon) {
        const imgElement = this._icon.querySelector("img");
        if (imgElement) {
          imgElement.style.transform = `rotate(${this._heading}deg)`;
        }
      }

      const locationMarkerElement = document.querySelector(".leaflet-control-locate-location");
      if (locationMarkerElement) {
        locationMarkerElement.style.display = "none";
      }
    },

    createIcon() {
      const opt = this.options;
      const style = "";

      const icon = this._getIconSVG(opt, style);

      this._locationIcon = leaflet.divIcon({
        className: icon.className,
        html: icon.html,
        iconSize: [icon.w, icon.h],
        iconAnchor: [(100 / 230) * CUSTOM_LOCATE_ICON_SIZE, (150 / 245) * CUSTOM_LOCATE_ICON_SIZE],
      });

      this.setIcon(this._locationIcon);
      this.setHeading(this._heading);
    },

    _getIconSVG(options, style) {
      const size = CUSTOM_LOCATE_ICON_SIZE;
      const imgContent = `<img src="/img/location-arrow.svg" style="width:${size}px; height:${size}px;">`;

      return {
        className: "leaflet-control-locate-heading",
        html: imgContent,
        w: size,
        h: size,
      };
    },
  });

  const locateCircleColor = LOCATE_COLOR;

  locateControl = L.control
    .locate({
      position: "topleft",
      flyTo: true,
      locateOptions: { maxZoom: 19 },
      drawCircle: false,
      showPopup: false,
      showCompass: true,
      compassClass: locationCompassArrowIcon,
      // To test the static arrow without rotation, uncomment the markerClass below
      // and comment out the compassClass line above. This is useful for testing
      // icon alignment and appearance without compass heading.
      //
      // markerClass: L.Marker.extend({
      //   options: {
      //     icon: locationArrowIcon,
      //   },
      // }),
      markerStyle: {
        color: COLOR_WHITE,
        fillColor: locateCircleColor,
        fillOpacity: 1,
        weight: 2,
        opacity: 1,
        radius: 10,
      },
    })
    .addTo(map);

  const locateButtonContainer = locateControl.getContainer();
  map.on("locateactivate", function () {
    L.DomUtil.addClass(locateButtonContainer, "locate-active");
  });
  map.on("locatedeactivate", function () {
    L.DomUtil.removeClass(locateButtonContainer, "locate-active");
  });
}
