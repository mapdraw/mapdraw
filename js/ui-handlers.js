// Copyright (C) 2025 Aron Sommer. See LICENSE file for full license details.

// UI Handlers Module
// This module handles the user interface elements for the overview list, info panel,
// color picker, and various UI updates throughout the application.

// Persistent state for collapsed categories in the overview list
const collapsedCategories = new Set();

/**
 * Helper function to create a single list item for the overview panel.
 * This encapsulates the logic for creating the item's text, buttons, and event listeners.
 * @param {L.Layer} layer - The layer to create the list item for
 * @returns {HTMLElement} The created list item element
 */
function createOverviewListItem(layer) {
  const layerId = L.Util.stamp(layer);
  let layerName =
    layer.feature?.properties?.name ||
    (layer instanceof L.Marker ? "Marker" : layer instanceof L.Polygon ? "Area" : "Unnamed Path");

  const listItem = document.createElement("div");
  listItem.className = "overview-list-item";
  listItem.setAttribute("data-layer-id", layerId);

  // Visibility toggle button
  const visibilityBtn = document.createElement("span");
  visibilityBtn.className = "overview-visibility-btn";
  visibilityBtn.title = "Toggle visibility";
  const setIcon = (visible) => {
    visibilityBtn.innerHTML = visible
      ? '<span class="material-symbols">visibility</span>'
      : '<span class="material-symbols">visibility_off</span>';
  };
  const isInitiallyVisible = !layer.isManuallyHidden;
  setIcon(isInitiallyVisible);
  visibilityBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const layerToToggle =
      editableLayers.getLayer(layerId) ||
      stravaActivitiesLayer.getLayer(layerId) ||
      importedItems.getLayer(layerId) ||
      (currentRoutePath && L.Util.stamp(currentRoutePath) === layerId ? currentRoutePath : null);
    if (!layerToToggle) return;

    // Toggle the manual hidden state
    layerToToggle.isManuallyHidden = !layerToToggle.isManuallyHidden;

    if (layerToToggle.isManuallyHidden) {
      // Hide the layer and its potential outline
      map.removeLayer(layerToToggle);
      if (layerToToggle === globallySelectedItem) {
        if (selectedPathOutline) map.removeLayer(selectedPathOutline);
        if (selectedMarkerOutline) map.removeLayer(selectedMarkerOutline);
      }
    } else {
      // Show the layer (if its parent group is on the map)
      // Check if any of its parent groups are on the map
      let isParentVisible = false;
      [drawnItems, stravaActivitiesLayer, importedItems].forEach((group) => {
        if (group.hasLayer(layerToToggle) && map.hasLayer(group)) {
          isParentVisible = true;
        } else {
          // Also check inside GeoJSON groups for imported items
          group.eachLayer((child) => {
            if (
              child instanceof L.GeoJSON &&
              child.hasLayer(layerToToggle) &&
              map.hasLayer(group)
            ) {
              isParentVisible = true;
            }
          });
        }
      });

      // Special case for route (it's not in a group)
      // But it's now visually part of "Drawn Items" (layerGroup DrawnItems)
      if (layerToToggle === currentRoutePath) {
        isParentVisible = map.hasLayer(drawnItems);
      }

      if (isParentVisible) {
        map.addLayer(layerToToggle);
        if (layerToToggle === globallySelectedItem) {
          if (selectedPathOutline) selectedPathOutline.addTo(map).bringToBack();
          if (selectedMarkerOutline) selectedMarkerOutline.addTo(map);
        }
      }
    }
    // Icon state reflects ONLY the manual override, not effective visibility
    setIcon(!layerToToggle.isManuallyHidden);
  });

  // Duplicate button
  const duplicateBtn = document.createElement("span");
  if (layer !== currentRoutePath) {
    duplicateBtn.className = "overview-duplicate-btn";
    duplicateBtn.innerHTML = '<span class="material-symbols">content_copy</span>';
    duplicateBtn.title = "Duplicate";
    duplicateBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const layerToDuplicate =
        editableLayers.getLayer(layerId) ||
        stravaActivitiesLayer.getLayer(layerId) ||
        importedItems.getLayer(layerId);
      if (!layerToDuplicate) return;
      let newLayer;
      const newFeature = JSON.parse(JSON.stringify(layerToDuplicate.feature || { properties: {} }));
      newFeature.properties.name =
        (newFeature.properties.name || (layerToDuplicate instanceof L.Marker ? "Marker" : "Path")) +
        " (Copy)";
      const color = newFeature.properties.color || DEFAULT_COLOR;

      // Create the appropriate layer type (marker, polygon, or polyline)
      if (layerToDuplicate instanceof L.Marker) {
        newLayer = L.marker(layerToDuplicate.getLatLng(), {
          icon: createMarkerIcon(color, STYLE_CONFIG.marker.default.opacity),
        });
      } else if (layerToDuplicate instanceof L.Polygon) {
        // Handle polygon (must check before Polyline since Polygon extends Polyline)
        const originalCoords = layerToDuplicate
          .getLatLngs()[0]
          .map((latlng) =>
            latlng.alt !== undefined
              ? [latlng.lng, latlng.lat, latlng.alt]
              : [latlng.lng, latlng.lat],
          );

        let coordsToUse = originalCoords;
        let simplificationHappened = false;

        // Apply simplification if enabled
        if (enablePathSimplification) {
          const simplifiedResult = simplifyPath(
            originalCoords,
            "Polygon",
            pathSimplificationConfig,
          );

          // Check if the polygon was actually simplified
          if (simplifiedResult.simplified) {
            coordsToUse = simplifiedResult.coords;
            simplificationHappened = true;
          }
        }

        // Show a notification if simplification occurred
        if (simplificationHappened) {
          Swal.fire({
            toast: true,
            icon: "info",
            title: "Area Optimized",
            text: "The duplicated area was simplified for better performance.",
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
          });
        }

        newLayer = L.polygon(
          coordsToUse.map((c) => (c.length === 3 ? [c[1], c[0], c[2]] : [c[1], c[0]])),
          { ...STYLE_CONFIG.path.default, color: color },
        );
      } else if (layerToDuplicate instanceof L.Polyline) {
        const originalCoords = layerToDuplicate
          .getLatLngs()
          .map((latlng) =>
            latlng.alt !== undefined
              ? [latlng.lng, latlng.lat, latlng.alt]
              : [latlng.lng, latlng.lat],
          );

        let coordsToUse = originalCoords;
        let simplificationHappened = false;

        if (enablePathSimplification) {
          const simplifiedResult = simplifyPath(
            originalCoords,
            "LineString",
            pathSimplificationConfig,
          );

          // Check if the path was actually simplified
          if (simplifiedResult.simplified) {
            coordsToUse = simplifiedResult.coords;
            simplificationHappened = true;
          }
        }

        // Show a notification if simplification occurred
        if (simplificationHappened) {
          Swal.fire({
            toast: true,
            icon: "info",
            title: "Path Optimized",
            text: "The duplicated path was simplified for better performance.",
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
          });
        }

        newLayer = L.polyline(
          coordsToUse.map((c) => (c.length === 3 ? [c[1], c[0], c[2]] : [c[1], c[0]])),
          { ...STYLE_CONFIG.path.default, color: color },
        );
        newFeature.properties.totalDistance = calculatePathDistance(newLayer);
      }

      if (newLayer) {
        // Keep only essential properties (name, color) - discard all source-specific metadata
        // This removes stravaId, imported file metadata, etc., making duplicates independent drawn paths
        const cleanProperties = {
          name: newFeature.properties.name,
          color: newFeature.properties.color || DEFAULT_COLOR,
        };
        newLayer.feature = { properties: cleanProperties };
        newLayer.pathType = "drawn";
        newLayer.on("click", (ev) => {
          L.DomEvent.stopPropagation(ev);
          selectItem(newLayer);
        });
        drawnItems.addLayer(newLayer);
        editableLayers.addLayer(newLayer);
        updateOverviewList();
        updateDrawControlStates();
        selectItem(newLayer);
      }
    });
  }

  // Delete button
  const deleteBtn = document.createElement("span");
  deleteBtn.className = "overview-delete-btn";
  deleteBtn.innerHTML = '<span class="material-symbols material-symbols-fill">cancel</span>';
  deleteBtn.title = layer === currentRoutePath ? "Clear the current route" : "Delete";
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const layerToDelete =
      editableLayers.getLayer(layerId) ||
      stravaActivitiesLayer.getLayer(layerId) ||
      importedItems.getLayer(layerId) ||
      (currentRoutePath && L.Util.stamp(currentRoutePath) === layerId ? currentRoutePath : null);
    if (layerToDelete) {
      deleteLayerImmediately(layerToDelete);
    }
  });

  // Text span for the name
  const textSpan = document.createElement("span");
  textSpan.className = "overview-item-text";
  textSpan.textContent = layerName;
  textSpan.title = layerName;

  // Slot 1: Visibility
  listItem.appendChild(visibilityBtn);

  // Slot 2: Delete
  listItem.appendChild(deleteBtn);

  // Slot 3: Duplicate (Secondary Action) or Save (for Route)
  if (layer === currentRoutePath) {
    const saveBtn = document.createElement("span");
    saveBtn.className = "overview-save-btn";
    saveBtn.title = "Save route to map";
    saveBtn.innerHTML = '<span class="material-symbols">save</span>';
    saveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (window.app && typeof window.app.saveRoute === "function") {
        window.app.saveRoute();
      }
    });
    listItem.appendChild(saveBtn);
  } else {
    listItem.appendChild(duplicateBtn);
  }

  // Slot 4: Name
  listItem.appendChild(textSpan);

  if (globallySelectedItem && L.Util.stamp(globallySelectedItem) === layerId) {
    listItem.classList.add("selected");
  }

  listItem.addEventListener("click", () => {
    const targetLayer =
      editableLayers.getLayer(layerId) ||
      stravaActivitiesLayer.getLayer(layerId) ||
      importedItems.getLayer(layerId) ||
      (currentRoutePath && L.Util.stamp(currentRoutePath) === layerId ? currentRoutePath : null);
    if (targetLayer) {
      if (targetLayer instanceof L.Polyline || targetLayer instanceof L.Polygon) {
        if (targetLayer.getBounds().isValid()) {
          map.fitBounds(targetLayer.getBounds(), { paddingTopLeft: [50, 50] });
        }
      } else if (targetLayer instanceof L.Marker) {
        const targetZoom = Math.max(map.getZoom(), 16);
        map.flyTo(targetLayer.getLatLng(), targetZoom);
      }
      selectItem(targetLayer);
    }
  });

  return listItem;
}

/**
 * Populates or updates the overview list with all items on the map, grouped by type.
 */
function updateOverviewList() {
  const listContainer = document.getElementById("overview-panel-list");
  if (!listContainer) return;
  const overviewPanel = document.getElementById("overview-panel"); // Get the parent panel

  // 1. Collect all items into a single array
  const allItems = [
    ...editableLayers.getLayers(),
    ...stravaActivitiesLayer.getLayers(),
    ...importedItems.getLayers(),
  ];
  if (currentRoutePath) {
    allItems.unshift(currentRoutePath);
  }

  // Handle the empty state
  if (allItems.length === 0) {
    overviewPanel.classList.add("is-empty"); // Add the class to the panel
    listContainer.innerHTML =
      '<div class="overview-list-item overview-list-empty-message" style="color: grey; cursor: default;">No items on map</div>';
    return;
  }

  // If we get here, the list is not empty, so remove the class and clear the list
  overviewPanel.classList.remove("is-empty");
  listContainer.innerHTML = "";

  // 2. Group all items by their type
  const groupedItems = {};
  const getGroupTitle = (pathType) => {
    switch (pathType) {
      case "route":
      case "drawn":
        return "Drawn Items";
      case "gpx":
      case "kml":
      case "geojson":
      case "kmz":
        return "Imported Files";
      case "strava":
        return "Strava Activities";
      default:
        return "Other";
    }
  };

  // Export for use in other modules (e.g., selectItem)
  window.getGroupTitle = getGroupTitle;

  // Helper to expand a category if it's collapsed, ensuring a layer is visible in the list
  window.expandCategoryForItem = (layer) => {
    const title = getGroupTitle(layer.pathType);
    if (collapsedCategories.has(title)) {
      collapsedCategories.delete(title);
      updateOverviewList();
    }
  };

  allItems.forEach((layer) => {
    const title = getGroupTitle(layer.pathType);
    if (!groupedItems[title]) {
      groupedItems[title] = [];
    }
    groupedItems[title].push(layer);
  });

  // 3. Render the groups in a specific order
  const fragment = document.createDocumentFragment();
  const groupOrder = ["Drawn Items", "Imported Files", "Strava Activities", "Other"];

  // Track which headers we're actually rendering
  const renderedHeaders = [];

  groupOrder.forEach((title) => {
    const itemsInGroup = groupedItems[title];
    if (itemsInGroup && itemsInGroup.length > 0) {
      const isCollapsed = collapsedCategories.has(title);

      // Create the header element
      const header = document.createElement("div");
      header.className = "overview-list-header";
      if (isCollapsed) header.classList.add("collapsed");

      // Determine the corresponding layer group for this category
      let layerGroup = null;
      let layerNameInControl = null;
      if (title === "Drawn Items") {
        layerGroup = drawnItems;
        layerNameInControl = "DrawnItems";
      } else if (title === "Imported Files") {
        layerGroup = importedItems;
        layerNameInControl = "ImportedFiles";
      } else if (title === "Strava Activities") {
        layerGroup = stravaActivitiesLayer;
        layerNameInControl = "StravaActivities";
      }

      const arrow = document.createElement("span");
      arrow.className = "material-symbols";
      arrow.textContent = isCollapsed ? "keyboard_arrow_down" : "keyboard_arrow_up";

      // 1. Visibility Button (Eye)
      const eyeBtnSlot = document.createElement("div");
      eyeBtnSlot.className = "overview-header-visibility-btn";
      if (layerGroup) {
        const eyeBtn = document.createElement("span");
        const isVisible = map.hasLayer(layerGroup);
        eyeBtn.innerHTML = isVisible
          ? '<span class="material-symbols">visibility</span>'
          : '<span class="material-symbols">visibility_off</span>';
        eyeBtn.title = isVisible ? "Hide category" : "Show category";
        eyeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const isRemoving = map.hasLayer(layerGroup);
          if (isRemoving) {
            map.removeLayer(layerGroup);
            if (title === "Drawn Items" && currentRoutePath) {
              map.removeLayer(currentRoutePath);
            }
          } else {
            map.addLayer(layerGroup);
            if (title === "Drawn Items" && currentRoutePath && !currentRoutePath.isManuallyHidden) {
              map.addLayer(currentRoutePath);
            }
          }
          if (typeof window.onOverlayToggle === "function") {
            window.onOverlayToggle({
              type: isRemoving ? "overlayremove" : "overlayadd",
              layer: layerGroup,
            });
          }
          updateOverviewList();
        });
        eyeBtnSlot.appendChild(eyeBtn);
      } else {
        eyeBtnSlot.className = "overview-icon-spacer";
      }
      header.appendChild(eyeBtnSlot);

      // 2. Delete Button (Clear)
      const delBtnSlot = document.createElement("div");
      delBtnSlot.className = "overview-header-delete-btn";
      if (layerGroup) {
        const delBtn = document.createElement("span");
        delBtn.innerHTML = '<span class="material-symbols material-symbols-fill">cancel</span>';
        delBtn.title = `Clear all ${title}`;
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          Swal.fire({
            title: `Clear all items in "${title}"?`,
            text:
              title === "Drawn Items" && currentRoutePath
                ? "This will also clear the current route."
                : "This action cannot be undone.",
            icon: "warning",
            showCancelButton: true,
            confirmButtonColor: "var(--color-red)",
            confirmButtonText: "Yes, clear all",
          }).then((result) => {
            if (result.isConfirmed) {
              if (title === "Drawn Items" && window.app?.clearRouting) window.app.clearRouting();
              layerGroup.clearLayers();
              itemsInGroup.forEach((item) => {
                if (editableLayers.hasLayer(item)) editableLayers.removeLayer(item);
              });
              if (globallySelectedItem && itemsInGroup.includes(globallySelectedItem))
                deselectCurrentItem();
              updateDrawControlStates();
              if (!map.hasLayer(layerGroup)) {
                map.addLayer(layerGroup);
              }

              updateOverviewList();
            }
          });
        });
        delBtnSlot.appendChild(delBtn);
      } else {
        delBtnSlot.className = "overview-icon-spacer";
      }
      header.appendChild(delBtnSlot);

      // 3. Arrow
      const arrowContainer = document.createElement("div");
      arrowContainer.className = "overview-header-arrow";
      arrowContainer.appendChild(arrow);
      header.appendChild(arrowContainer);

      // 4. Title
      const titleSpan = document.createElement("span");
      titleSpan.className = "overview-header-text";
      titleSpan.textContent = `${title} (${itemsInGroup.length})`;
      header.appendChild(titleSpan);

      header.addEventListener("click", () => {
        if (isCollapsed) {
          collapsedCategories.delete(title);
        } else {
          collapsedCategories.add(title);
        }
        updateOverviewList();
      });

      fragment.appendChild(header);
      renderedHeaders.push(header);

      // Create and append the list items for this group if not collapsed
      if (!isCollapsed) {
        itemsInGroup.forEach((layer) => {
          const listItem = createOverviewListItem(layer); // Use the helper function
          fragment.appendChild(listItem);
        });
      }
    }
  });

  // Mark the last header with a special class
  if (renderedHeaders.length > 0) {
    const lastHeader = renderedHeaders[renderedHeaders.length - 1];
    lastHeader.classList.add("last-header");
  }

  listContainer.appendChild(fragment);

  // Sync checkboxes in the custom layers panel with the map's current state
  const checkboxMapping = {
    DrawnItems: drawnItems,
    ImportedFiles: importedItems,
    StravaActivities: stravaActivitiesLayer,
  };

  Object.entries(checkboxMapping).forEach(([name, group]) => {
    const checkbox = document.querySelector(
      `#custom-layers-panel input[data-layer-name="${name}"]`,
    );
    if (checkbox) checkbox.checked = map.hasLayer(group);
  });
}

/**
 * Displays the info panel with details about the selected layer.
 * @param {L.Layer} layer - The selected layer
 */
function showInfoPanel(layer) {
  // Style adjustments for when an item is selected
  infoPanelName.style.display = "block";
  infoPanelDetails.style.color = "var(--color-black)";
  infoPanelDetails.style.fontSize = "var(--font-size-12)"; // Reset font size
  infoPanel.style.justifyContent = "flex-start";
  infoPanelDetails.style.marginTop = "5px";

  // Populating content
  layer.feature = layer.feature || {};
  layer.feature.properties = layer.feature.properties || {};
  let name = layer.feature.properties.name || "";
  let details = "";
  const editHint = document.getElementById("info-panel-edit-hint");
  const stravaLink = document.getElementById("info-panel-strava-link");

  // Clear previous click handler and reset cursor
  infoPanelDetails.onclick = null;
  infoPanelDetails.style.cursor = "default";
  infoPanelDetails.title = "";

  // Hide hint and Strava link by default
  editHint.style.display = "none";
  stravaLink.style.display = "none";

  if (layer instanceof L.Marker) {
    name = name || "Marker";
    const latlng = layer.getLatLng();
    details = `<span>Lat: ${latlng.lat.toFixed(5)}, Lon: ${latlng.lng.toFixed(
      5,
    )}<span class="copy-icon material-symbols">content_copy</span>`;
    infoPanelDetails.innerHTML = details;

    // Add click-to-copy functionality for marker coordinates
    infoPanelDetails.style.cursor = "pointer";
    infoPanelDetails.title = "Click to copy coordinates";

    infoPanelDetails.onclick = (e) => {
      L.DomEvent.stop(e); // Prevent event from bubbling up
      const coordString = `${latlng.lat}, ${latlng.lng}`;
      copyToClipboard(coordString)
        .then(() => {
          Swal.fire({
            toast: true,
            icon: "success",
            title: "Coordinates Copied!",
            html: coordString,
            showConfirmButton: false,
            timer: 2000,
          });
        })
        .catch((err) => {
          console.error("Could not copy text: ", err);
          Swal.fire({
            toast: true,
            icon: "error",
            title: "Failed to Copy",
            showConfirmButton: false,
            timer: 2000,
          });
        });
    };
  } else if (layer instanceof L.Polygon) {
    name = name || "Area";

    const area = calculatePolygonArea(layer);
    const perimeter = calculatePathDistance(layer);

    details = `Area: ${formatArea(area)}<br>Perimeter: ${formatDistance(perimeter)}`;
  } else if (layer instanceof L.Polyline) {
    name = name || "Path";

    // Recalculate distance from geometry to ensure consistency with elevation panel
    const totalDistance = calculatePathDistance(layer);

    // Update the cached property
    if (layer.feature && layer.feature.properties) {
      layer.feature.properties.totalDistance = totalDistance;
    }

    details = `Length: ${formatDistance(totalDistance)}`;
  }

  layer.feature.properties.name = name;
  infoPanelName.value = name;
  infoPanelDetails.innerHTML = details;

  infoPanelStyleRow.style.display = "flex";

  // Determine layer type for display
  let layerTypeName = "Unknown";
  switch (layer.pathType) {
    case "drawn":
      layerTypeName = "Drawn Item";
      break;
    case "gpx":
    case "kml":
    case "geojson":
    case "kmz":
      // Check if this is a Strava activity that was imported
      if (layer.feature?.properties?.stravaId) {
        layerTypeName = "Imported Item (Strava Activity)";
        editHint.innerHTML = "To edit geometry, duplicate activity in <b>Contents</b> tab.";
      } else {
        layerTypeName = "Imported Item";
        editHint.innerHTML = "To edit geometry, duplicate item in <b>Contents</b> tab.";
      }
      editHint.style.display = "block";
      break;
    case "route":
      layerTypeName = "Drawn Item (Route)";
      editHint.innerHTML = "To edit geometry, save route in <b>Routing</b> tab.";
      editHint.style.display = "block";
      break;
    case "strava":
      const activityType = layer.feature.properties.type || "";
      layerTypeName = `Strava Activity ${activityType ? `(${activityType})` : ""}`.trim();

      // Show the editing hint
      editHint.innerHTML = "To edit geometry, duplicate activity in <b>Contents</b> tab.";
      editHint.style.display = "block";
      break;
  }
  infoPanelLayerName.textContent = layerTypeName;

  // Show "View on Strava" link if item has a stravaId (regardless of pathType)
  if (layer.feature.properties.stravaId) {
    const activityUrl = `https://www.strava.com/activities/${layer.feature.properties.stravaId}`;
    stravaLink.href = activityUrl;
    stravaLink.textContent = "View on Strava";
    stravaLink.style.display = "flex";
  }

  // Set the color swatch and update picker state
  const color = layer.feature?.properties?.color || DEFAULT_COLOR;
  infoPanelColorSwatch.style.backgroundColor = color;
  updateColorPickerSelection(color);

  // Hide the main color picker initially
  colorPicker.style.display = "none";
}

/**
 * Resets the info panel to its default state (no item selected).
 */
function resetInfoPanel() {
  if (infoPanel) {
    infoPanelName.style.display = "none";
    infoPanelDetails.textContent = "No item selected";
    infoPanelDetails.style.fontWeight = "normal";
    infoPanelDetails.style.color = "var(--color-grey-dark)";
    infoPanelDetails.style.fontSize = "var(--font-size-14)"; // Larger font for this message
    infoPanel.style.justifyContent = "center";
    infoPanelDetails.style.marginTop = "0";

    // Ensure click handler and styles are reset
    infoPanelDetails.onclick = null;
    infoPanelDetails.style.cursor = "default";
    infoPanelDetails.title = "";

    // Hide the hint and Strava link when resetting
    document.getElementById("info-panel-edit-hint").style.display = "none";
    document.getElementById("info-panel-strava-link").style.display = "none";

    // Hide color picker and the new style row
    infoPanelStyleRow.style.display = "none";
    colorPicker.style.display = "none";
  }
}

/**
 * Updates the name of the selected layer from the info panel input.
 */
function updateLayerName() {
  if (globallySelectedItem && globallySelectedItem.feature.properties) {
    let newName = infoPanelName.value.trim();
    if (!newName) {
      // Default name if input is empty
      newName =
        globallySelectedItem instanceof L.Marker
          ? "Marker"
          : globallySelectedItem instanceof L.Polygon
            ? "Area"
            : "Path";
      infoPanelName.value = newName;
    }
    globallySelectedItem.feature.properties.name = newName;
    updateOverviewList();
  }
}

/**
 * Populates the color picker with swatches from the palette.
 * Adds a 17th swatch that opens the native color picker for custom colors.
 */
function populateColorPicker() {
  // Add palette colors
  COLOR_PALETTE.forEach((color) => {
    const swatch = document.createElement("div");
    swatch.className = "color-swatch";
    swatch.style.backgroundColor = color.hex;
    swatch.dataset.hex = color.hex;
    swatch.title = color.name;

    swatch.addEventListener("click", () => {
      if (!globallySelectedItem) return;
      applyColorToSelectedItem(color.hex);
    });

    colorPicker.appendChild(swatch);
  });

  // Add custom color picker swatch (17th swatch with native color input)
  const customSwatch = document.createElement("div");
  customSwatch.id = "custom-color-swatch";
  customSwatch.className = "color-swatch custom-color-swatch";
  customSwatch.title = "Custom color";
  // Rainbow gradient to indicate custom color picker
  customSwatch.style.background = "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)";
  customSwatch.style.position = "relative";
  customSwatch.style.overflow = "hidden";

  // Native color input - covers entire swatch for iOS Safari compatibility
  // iOS Safari blocks programmatic .click() on hidden/zero-size inputs,
  // so we make the input cover the swatch area but remain visually transparent
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.id = "native-color-input";
  colorInput.style.position = "absolute";
  colorInput.style.top = "0";
  colorInput.style.left = "0";
  colorInput.style.width = "100%";
  colorInput.style.height = "100%";
  colorInput.style.opacity = "0";
  colorInput.style.border = "none";
  colorInput.style.padding = "0";
  colorInput.style.cursor = "pointer";
  colorInput.value = DEFAULT_COLOR;

  // Prevent color picker from opening if nothing is selected
  colorInput.addEventListener("click", (e) => {
    if (!globallySelectedItem) {
      e.preventDefault();
    }
  });

  // When native picker color changes, apply it (don't hide picker while user is selecting)
  colorInput.addEventListener("input", (e) => {
    if (!globallySelectedItem) return;
    const selectedColor = e.target.value.toUpperCase();
    applyColorToSelectedItem(selectedColor, false);
    customSwatch.dataset.hex = selectedColor;
  });

  customSwatch.appendChild(colorInput);
  colorPicker.appendChild(customSwatch);
}

/**
 * Applies a color to the currently selected item.
 * @param {string} hex - The hex color to apply
 * @param {boolean} hidePicker - Whether to hide the color picker after (default true)
 */
function applyColorToSelectedItem(hex, hidePicker = true) {
  if (!globallySelectedItem) return;

  // Store the color on the feature
  globallySelectedItem.feature.properties.color = hex;

  // Update the layer's visual style immediately
  if (globallySelectedItem instanceof L.Polyline || globallySelectedItem instanceof L.Polygon) {
    globallySelectedItem.setStyle({
      ...STYLE_CONFIG.path.highlight,
      color: hex,
    });
    // Update the selection outline's fill color for polygons
    if (selectedPathOutline && globallySelectedItem instanceof L.Polygon) {
      selectedPathOutline.setStyle({ fillColor: hex });
    }
  } else if (globallySelectedItem instanceof L.Marker) {
    globallySelectedItem.setIcon(createMarkerIcon(hex, STYLE_CONFIG.marker.highlight.opacity));
  }

  // Update the selected state in the color picker
  updateColorPickerSelection(hex);

  // Update the mini swatch in the info panel
  infoPanelColorSwatch.style.backgroundColor = hex;
  if (hidePicker) {
    colorPicker.style.display = "none";
  }
}

/**
 * Updates which swatch in the picker has the 'selected' class.
 * If color is not in palette, selects the custom swatch.
 * @param {string} hex - The hex color to select
 */
function updateColorPickerSelection(hex) {
  const swatches = colorPicker.querySelectorAll(".color-swatch");
  const customSwatch = document.getElementById("custom-color-swatch");
  const colorInput = document.getElementById("native-color-input");
  const normalizedHex = hex?.toUpperCase();

  // Always sync the hidden native picker with the current color.
  // This ensures the custom picker starts at the active color.
  if (colorInput && hex) {
    const validHex = parseColor(hex); // HTML color inputs require strict #RRGGBB format
    if (validHex) colorInput.value = validHex;
  }

  let matchedPalette = false;

  swatches.forEach((swatch) => {
    if (swatch.id === "custom-color-swatch") return;

    if (swatch.dataset.hex?.toUpperCase() === normalizedHex) {
      swatch.classList.add("selected");
      matchedPalette = true;
    } else {
      swatch.classList.remove("selected");
    }
  });

  // Handle custom swatch selection
  if (customSwatch) {
    if (!matchedPalette && hex) {
      // Color not in palette - select custom swatch
      customSwatch.dataset.hex = hex;
      customSwatch.title = `Custom: ${hex}`;
      customSwatch.classList.add("selected");
    } else {
      // Color is in palette - deselect custom swatch
      customSwatch.dataset.hex = "";
      customSwatch.title = "Custom color";
      customSwatch.classList.remove("selected");
    }
  }
}

/**
 * Replaces default Leaflet icons with Material Symbols.
 */
function replaceDefaultIconsWithMaterialSymbols() {
  const layersButton = document.getElementById("layers-button");
  if (layersButton) {
    layersButton.querySelector("a").innerHTML = '<span class="material-symbols">layers</span>';
  }

  const locateButton = document.querySelector(".leaflet-control-locate a");
  if (locateButton) {
    locateButton.innerHTML = '<span class="material-symbols">my_location</span>';
  }

  const zoomInButton = document.querySelector(".leaflet-control-zoom-in");
  if (zoomInButton) {
    zoomInButton.innerHTML = '<span class="material-symbols">add</span>';
  }

  const zoomOutButton = document.querySelector(".leaflet-control-zoom-out");
  if (zoomOutButton) {
    zoomOutButton.innerHTML = '<span class="material-symbols">remove</span>';
  }

  const pathButton = document.querySelector(".leaflet-draw-draw-polyline");
  if (pathButton) {
    pathButton.innerHTML = '<span class="material-symbols">diagonal_line</span>';
  }

  const areaButton = document.querySelector(".leaflet-draw-draw-polygon");
  if (areaButton) {
    areaButton.innerHTML = '<span class="material-symbols">hexagon</span>';
  }

  const markerButton = document.querySelector(".leaflet-draw-draw-marker");
  if (markerButton) {
    markerButton.innerHTML = '<span class="material-symbols">location_on</span>';
  }

  const editButton = document.querySelector(".leaflet-draw-edit-edit");
  if (editButton) {
    editButton.innerHTML = '<span class="material-symbols">edit</span>';
  }

  const deleteButton = document.querySelector(".leaflet-draw-edit-remove");
  if (deleteButton) {
    deleteButton.innerHTML = '<span class="material-symbols">delete</span>';
  }

  const importButton = document.getElementById("import-button");
  if (importButton) {
    importButton.querySelector("a").innerHTML = '<span class="material-symbols">folder_open</span>';
  }

  const downloadButton = document.getElementById("download-button");
  if (downloadButton) {
    downloadButton.querySelector("a").innerHTML = '<span class="material-symbols">download</span>';
  }

  const elevationButton = document.getElementById("elevation-button");
  if (elevationButton) {
    elevationButton.querySelector("a").innerHTML =
      '<span class="material-symbols">elevation</span>';
  }
}
