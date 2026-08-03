// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// UI Handlers Module
// This module handles the user interface elements for the overview list, info panel,
// color picker, and various UI updates throughout the application.

// Which category (DrawnItems/ImportedFiles/StravaActivities/Other) is currently shown in
// the overview list. The pinned area above the list (see createOverviewControlsRow()) is
// never virtualized: one persistent shared controls row (eye/delete/duplicate, acting on
// whatever category is active) plus one small "pill" button per category, cached forever in
// overviewPillNodesByKey (at most 4) rather than evicted on scroll.
let activeCategory = null;
// Last category actually rendered - callers set activeCategory before calling
// updateOverviewList(), so it can't be compared against itself to detect a switch.
let overviewRenderedCategory = null;
let overviewControlsRow = null;
const overviewPillNodesByKey = new Map();

// The item list is virtualized: however many items exist, only the ones scrolled into view
// (+ a small buffer) are ever real DOM elements - see updateOverviewList(),
// renderOverviewWindow() and scrollOverviewToLayer() below.
const OVERVIEW_ROW_HEIGHT = parseInt(
  getComputedStyle(document.documentElement).getPropertyValue("--overview-row-height"),
  10,
);
// Extra rows rendered above/below the visible viewport, so a small scroll doesn't pop new
// rows in right at the edge.
const OVERVIEW_SCROLL_BUFFER_PX = OVERVIEW_ROW_HEIGHT * 8;
// Matches the icon buttons' own width (style.css --overview-icon-width) - read once here
// instead of duplicating the value, so the two never drift apart.
const OVERVIEW_ICON_WIDTH = getComputedStyle(document.documentElement)
  .getPropertyValue("--overview-icon-width")
  .trim();

// Currently-rendered row elements, keyed by layerId - only ever holds what's within the
// current scroll window (+ buffer), not the whole active category.
const overviewNodesByKey = new Map();
// The active category's items, in display order - what the list would contain if nothing
// were virtualized. Rebuilt by updateOverviewList() on structural changes (items
// added/removed, active category switched) - NOT on scroll.
let overviewActiveItems = [];
// layerId -> index into overviewActiveItems, so scrolling to a layer (possibly currently
// off-screen, with no DOM row to look up) can compute where to go.
let overviewLayerIndex = new Map();
let overviewTopSpacer = null;
let overviewBottomSpacer = null;
let overviewScrollListenerAttached = false;
let overviewRenderScheduled = false;

// Suspend/resume leaflet-draw editing around a layer's removal/re-add, so its edit
// highlight and vertex handles survive - restricted to editableLayers members only.
// Single-item edit mode - only itemBeingEdited ever gets vertex handles, so re-enabling
// must stay limited to it too, or hide/show during an edit session hands handles to every layer.
function setLayerEditingEnabled(layer, enabled) {
  if (!layer || !layer.editing || !editableLayers.hasLayer(layer)) return;
  if (enabled) {
    if (isEditMode && layer === itemBeingEdited) layer.editing.enable();
  } else {
    layer.editing.disable();
  }
}

// Same as above, applied to a whole group (category eye button, Layers panel checkbox).
function setGroupEditingEnabled(layerGroup, enabled) {
  layerGroup.eachLayer((layer) => setLayerEditingEnabled(layer, enabled));
}

/**
 * Toggles a layer's manual visibility flag and shows/hides it on the map accordingly,
 * respecting whether its parent category group is currently visible.
 * @param {L.Layer} layerToToggle - The layer to toggle
 */
function toggleLayerVisibility(layerToToggle) {
  if (!layerToToggle) return;

  // Toggle the manual hidden state
  layerToToggle.isManuallyHidden = !layerToToggle.isManuallyHidden;

  if (layerToToggle.isManuallyHidden) {
    setLayerEditingEnabled(layerToToggle, false);

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
    Object.values(displayLayerGroups).forEach((group) => {
      if (group.hasLayer(layerToToggle) && map.hasLayer(group)) {
        isParentVisible = true;
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

      setLayerEditingEnabled(layerToToggle, true);
    }
  }
}

/**
 * Duplicates a layer (marker, polygon, or polyline) as an independent drawn item,
 * selects the new copy, and returns it.
 * @param {L.Layer} layerToDuplicate - The layer to duplicate
 * @param {{skipUiUpdate?: boolean}} [options] - Pass skipUiUpdate when duplicating
 *   many layers in a row, so the caller can select/refresh once at the end
 *   instead of doing it per layer.
 * @returns {L.Layer|undefined} The newly created layer, or undefined if it couldn't be duplicated
 */
function duplicateLayer(layerToDuplicate, { skipUiUpdate = false } = {}) {
  if (!layerToDuplicate) return undefined;

  let newLayer;
  const newFeature = JSON.parse(JSON.stringify(layerToDuplicate.feature || { properties: {} }));
  newFeature.properties.name =
    (newFeature.properties.name || getDefaultLayerName(layerToDuplicate)) + " (Copy)";
  const color = newFeature.properties.color || DEFAULT_COLOR;

  // Create the appropriate layer type (marker, polygon, or polyline)
  if (layerToDuplicate instanceof L.Marker) {
    newLayer = L.marker(layerToDuplicate.getLatLng(), {
      icon: createMarkerIcon(color, STYLE_CONFIG.marker.default.opacity),
    });
  } else if (layerToDuplicate instanceof L.Polygon) {
    // Handle polygon (must check before Polyline since Polygon extends Polyline)
    const originalCoords = flattenRingPoints(layerToDuplicate.getLatLngs()).map(latLngToCoord);

    newLayer = L.polygon(originalCoords.map(coordToLatLng), {
      ...STYLE_CONFIG.path.default,
      color: color,
    });
  } else if (layerToDuplicate instanceof L.Polyline) {
    const originalCoords = flattenRingPoints(layerToDuplicate.getLatLngs()).map(latLngToCoord);

    newLayer = L.polyline(originalCoords.map(coordToLatLng), {
      ...STYLE_CONFIG.path.default,
      color: color,
    });
    newFeature.properties.totalDistance = calculatePathDistance(newLayer);
  }

  if (newLayer) {
    // Keep only essential properties (name, color) and force pathType to "drawn" -
    // discard all source-specific metadata. This removes stravaId, imported file
    // metadata, etc., making duplicates independent drawn paths.
    const cleanProperties = {
      name: newFeature.properties.name,
      color: newFeature.properties.color || DEFAULT_COLOR,
      pathType: "drawn",
    };
    newLayer.feature = { properties: cleanProperties };
    newLayer.on("click", (ev) => {
      L.DomEvent.stopPropagation(ev);
      selectItem(newLayer);
    });
    drawnItems.addLayer(newLayer);
    editableLayers.addLayer(newLayer);
    if (!skipUiUpdate) {
      updateOverviewList();
      selectItem(newLayer);
    }
  }
  return newLayer;
}

/**
 * Finds the live layer behind an overview-list row's cached layer id, checking every group
 * a row's layer could currently live in (including the live route, which lives in drawnItems
 * but - unlike every other drawn item - is never added to editableLayers, so it needs this
 * explicit fallback instead of being found via the groups above).
 * @param {number} layerId - The Leaflet stamp id encoded in the row's data-layer-id
 * @returns {L.Layer|null}
 */
function resolveOverviewLayerById(layerId) {
  return (
    editableLayers.getLayer(layerId) ||
    stravaActivitiesLayer.getLayer(layerId) ||
    importedItems.getLayer(layerId) ||
    (currentRoutePath && L.Util.stamp(currentRoutePath) === layerId ? currentRoutePath : null)
  );
}

/**
 * Material-symbols icon name for a visibility toggle. Callers decide what "hidden" means for
 * their case - an item's own isManuallyHidden below, a category's map.hasLayer() in
 * patchOverviewControlsRow().
 */
function getVisibilityIconName(isHidden) {
  return isHidden ? "visibility_off" : "visibility";
}

const DUPLICATE_ICON_HTML = '<span class="material-symbols">add_to_photos</span>';
const DELETE_ICON_HTML = '<span class="material-symbols material-symbols-fill">cancel</span>';

/**
 * Helper function to create a single list item for the overview panel.
 * This encapsulates the logic for creating the item's text, buttons, and event listeners.
 * The row is cached and reused across renders for as long as its layer stays within the
 * scrolled-into-view window (see renderOverviewWindow()) - state that can change
 * afterwards (name, visibility, selection) is synced separately by
 * patchOverviewListItem().
 * @param {L.Layer} layer - The layer to create the list item for
 * @returns {HTMLElement} The created list item element
 */
function createOverviewListItem(layer) {
  const layerId = L.Util.stamp(layer);

  const listItem = document.createElement("div");
  listItem.className = "overview-list-item";
  listItem.setAttribute("data-layer-id", layerId);

  // Visibility toggle button
  const visibilityBtn = document.createElement("span");
  visibilityBtn.className = "overview-visibility-btn";
  visibilityBtn.title = "Toggle visibility";
  const visibilityIcon = document.createElement("span");
  visibilityIcon.className = "material-symbols";
  visibilityBtn.appendChild(visibilityIcon);
  visibilityBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const layerToToggle = resolveOverviewLayerById(layerId);
    if (!layerToToggle) return;

    toggleLayerVisibility(layerToToggle);
    // Icon state reflects ONLY the manual override, not effective visibility
    visibilityIcon.textContent = getVisibilityIconName(layerToToggle.isManuallyHidden);
  });

  // Duplicate button
  const duplicateBtn = document.createElement("span");
  if (layer !== currentRoutePath) {
    duplicateBtn.className = "overview-duplicate-btn";
    duplicateBtn.innerHTML = DUPLICATE_ICON_HTML;
    duplicateBtn.title = "Duplicate";
    duplicateBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      duplicateLayer(resolveOverviewLayerById(layerId));
    });
  }

  // Delete button
  const deleteBtn = document.createElement("span");
  deleteBtn.className = "overview-delete-btn";
  deleteBtn.innerHTML = DELETE_ICON_HTML;
  deleteBtn.title = layer === currentRoutePath ? "Clear the current route" : "Delete";
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const layerToDelete = resolveOverviewLayerById(layerId);
    if (layerToDelete) {
      deleteLayerImmediately(layerToDelete);
    }
  });

  // Text span for the name
  const textSpan = document.createElement("span");
  textSpan.className = "overview-item-text";

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

  listItem.addEventListener("click", () => {
    const targetLayer = resolveOverviewLayerById(layerId);
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

  listItem._visibilityIcon = visibilityIcon;
  listItem._textSpan = textSpan;
  patchOverviewListItem(listItem, layer);
  return listItem;
}

/**
 * Syncs a cached overview-list row's mutable state (name, visibility icon, selection
 * highlight, rectangle-select highlight) with the current layer, without touching its
 * buttons/listeners. Needed because a row now persists across multiple renders while its
 * layer stays scrolled into view, instead of being thrown away and rebuilt every single
 * time.
 * @param {HTMLElement} listItem - A row previously created by createOverviewListItem()
 * @param {L.Layer} layer - The layer it represents
 */
function patchOverviewListItem(listItem, layer) {
  const layerName = layer.feature?.properties?.name || getDefaultLayerName(layer);
  if (listItem._textSpan.textContent !== layerName) {
    listItem._textSpan.textContent = layerName;
    listItem._textSpan.title = layerName;
  }
  listItem._visibilityIcon.textContent = getVisibilityIconName(layer.isManuallyHidden);
  listItem.classList.toggle("selected", globallySelectedItem === layer);
  // Derived live from the rectangle-select tool's own selection state (rather than a
  // one-time DOM query pass over whatever happens to be mounted right now), so a row gets
  // the correct highlight the instant it's created/patched - including rows that weren't
  // mounted yet at the moment of a bulk Select All/Invert and only get created later, as
  // they scroll into view or their category becomes active.
  listItem.classList.toggle("rectangle-selected", !!window.app?.isRectangleSelected?.(layer));
}

/**
 * Creates the single shared controls row pinned above the virtualized item list: eye/delete/
 * duplicate buttons for whichever category is active, a collapse arrow for the list itself,
 * and the per-category "pill" buttons with their item counts below them - all in one CSS
 * grid (icons fixed at columns 1-3, row 1, except the collapse arrow which shares column 1
 * one row down; pills/counts added later by getOrCreatePill()/renderCategoryPills(), which
 * also rebuilds grid-template-columns for whichever categories are non-empty). Built once
 * and reused forever - the click handlers below read
 * _activeKey/_activeLabel/_activeLayerGroup/_activeItemsInGroup live (refreshed by
 * patchOverviewControlsRow()) since one row now has to act on whatever category is active.
 * @returns {HTMLElement}
 */
function createOverviewControlsRow() {
  const row = document.createElement("div");
  row.className = "overview-controls-row";

  // 1. Visibility Button (Eye)
  // Icon sits directly in the flex slot (no wrapper span) - matches the per-item buttons'
  // DOM shape (createOverviewListItem()). A wrapper span here previously added an inline
  // "strut" that inflated the slot ~2px taller than the icon and threw off centering
  // against the pills.
  const eyeBtnSlot = document.createElement("div");
  eyeBtnSlot.className = "overview-controls-visibility-btn";
  const eyeIcon = document.createElement("span");
  eyeIcon.className = "material-symbols";
  eyeBtnSlot.appendChild(eyeIcon);
  eyeBtnSlot.addEventListener("click", (e) => {
    e.stopPropagation();
    const layerGroup = row._activeLayerGroup;
    if (!layerGroup) return;
    const key = row._activeKey;
    const isRemoving = map.hasLayer(layerGroup);
    if (isRemoving) {
      if (key === "DrawnItems") setGroupEditingEnabled(layerGroup, false);
      map.removeLayer(layerGroup);
      if (key === "DrawnItems" && currentRoutePath) {
        map.removeLayer(currentRoutePath);
      }
    } else {
      map.addLayer(layerGroup);
      if (key === "DrawnItems") setGroupEditingEnabled(layerGroup, true);
      if (key === "DrawnItems" && currentRoutePath && !currentRoutePath.isManuallyHidden) {
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
  row._eyeBtn = eyeBtnSlot;
  row._eyeIcon = eyeIcon;
  row.appendChild(eyeBtnSlot);

  // 2. Delete Button (Clear all)
  const delBtnSlot = document.createElement("div");
  delBtnSlot.className = "overview-controls-delete-btn";
  delBtnSlot.innerHTML = DELETE_ICON_HTML;
  delBtnSlot.addEventListener("click", (e) => {
    e.stopPropagation();
    const layerGroup = row._activeLayerGroup;
    if (!layerGroup) return;
    const key = row._activeKey;
    const label = row._activeLabel;
    // Snapshot now - row._activeItemsInGroup can be reassigned to another category
    // while the dialog below is open (row is cached/reused across renders).
    const itemsInGroup = row._activeItemsInGroup;
    Swal.fire({
      title: `Clear all items in "${label}"?`,
      text:
        key === "DrawnItems" && currentRoutePath
          ? "This will also clear the current route."
          : "This action cannot be undone.",
      icon: "warning",
      showCancelButton: true,
      customClass: { confirmButton: "swal-confirm-danger" },
      confirmButtonText: "Yes, clear all",
    }).then((result) => {
      if (result.isConfirmed) {
        if (key === "DrawnItems" && window.app?.clearRouting) {
          window.app.clearRouting();
        }
        // Same per-layer path used by the individual delete button and
        // rect-select's bulk delete - keeps rectangle-selection state,
        // deselection, and group/editableLayers cleanup all in sync.
        itemsInGroup.forEach((item) => deleteLayerImmediately(item, { skipUiUpdate: true }));
        updateDrawControlStates();
        if (!map.hasLayer(layerGroup)) {
          map.addLayer(layerGroup);
        }
        updateOverviewList();
      }
    });
  });
  row._delBtn = delBtnSlot;
  row.appendChild(delBtnSlot);

  // 3. Duplicate Button (Duplicate all)
  const dupBtnSlot = document.createElement("div");
  dupBtnSlot.className = "overview-controls-duplicate-btn";
  dupBtnSlot.innerHTML = DUPLICATE_ICON_HTML;
  dupBtnSlot.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!row._activeLayerGroup) return;
    // Same per-layer path used by the individual duplicate button and
    // rect-select's bulk duplicate - including the live route, which
    // duplicateLayer() already handles like any other layer (an
    // independent copy saved to Drawn Items, route keeps running).
    row._activeItemsInGroup.forEach((item) => {
      duplicateLayer(item, { skipUiUpdate: true });
    });
    updateOverviewList();
    updateDrawControlStates();
  });
  row._dupBtn = dupBtnSlot;
  row.appendChild(dupBtnSlot);

  // 4. Collapse/Expand Arrow (desktop only, see the max-width: 768px media query) - hides
  // #overview-panel-list to free up map space. Icon is swapped purely by CSS (::before,
  // keyed off #overview-panel.collapsed), mirroring #directions-panel-header-arrow.
  const collapseBtnSlot = document.createElement("div");
  collapseBtnSlot.className = "overview-controls-collapse-btn";
  collapseBtnSlot.title = "Collapse item list";
  collapseBtnSlot.innerHTML = '<span class="material-symbols"></span>';
  collapseBtnSlot.addEventListener("click", (e) => {
    e.stopPropagation();
    const collapsed = document.getElementById("overview-panel").classList.toggle("collapsed");
    collapseBtnSlot.title = collapsed ? "Expand item list" : "Collapse item list";
    if (!collapsed) {
      // No real height to render against while collapsed (tab-navigation.js does the same).
      renderOverviewWindow();
      const selected = getEffectiveSelectedLayer();
      if (selected) scrollOverviewToLayer(selected);
    }
  });
  row.appendChild(collapseBtnSlot);

  // Category pills and their counts are added later, directly into this grid, by
  // getOrCreatePill()/renderCategoryPills().
  return row;
}

/**
 * Syncs the shared controls row's active-category state (which items its bulk buttons act
 * on, visibility icon, dialog/title copy) with whichever category is currently active.
 * Toggles "no-group" when the active category has no real layer group (the "Other"
 * category), so CSS can hide/disable the eye/delete/duplicate buttons.
 * @param {HTMLElement} row - The row previously created by createOverviewControlsRow()
 * @param {string} key - The active category's stable key (e.g. "DrawnItems")
 * @param {string} label - The active category's display label (e.g. "Drawn Items")
 * @param {L.LayerGroup|null} layerGroup - The active category's group, or null for "Other"
 * @param {L.Layer[]} itemsInGroup - The active category's current items, in display order
 */
function patchOverviewControlsRow(row, key, label, layerGroup, itemsInGroup) {
  row._activeKey = key;
  row._activeLabel = label;
  row._activeLayerGroup = layerGroup;
  row._activeItemsInGroup = itemsInGroup;
  row.classList.toggle("no-group", !layerGroup);
  row._delBtn.title = `Clear all ${label}`;
  row._dupBtn.title = `Duplicate all ${label}`;
  if (layerGroup) {
    const isVisible = map.hasLayer(layerGroup);
    row._eyeIcon.textContent = getVisibilityIconName(!isVisible);
    row._eyeBtn.title = isVisible ? "Hide category" : "Show category";
  }
}

/**
 * Gets or creates a category "pill" button (switches the active category on click) and its
 * count element - both grid items in the shared controls row (pill on row 1, count on row
 * 2). renderCategoryPills() assigns their shared grid-column on every call, since which
 * categories are visible can change. Cached forever per group key (at most 4: DrawnItems/
 * ImportedFiles/StravaActivities/Other) in overviewPillNodesByKey.
 * @param {string} key - Stable group key (e.g. "DrawnItems")
 * @param {string} label - Short display label (e.g. "Drawn")
 * @returns {{pill: HTMLElement, countEl: HTMLElement}}
 */
function getOrCreatePill(key, label) {
  let entry = overviewPillNodesByKey.get(key);
  if (entry) return entry;

  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "overview-category-pill";
  pill.textContent = label;
  pill.addEventListener("click", () => {
    // Reads activeCategory live rather than a captured isActive, since this pill (and its
    // listener) is cached and reused across many renders where that could change.
    if (activeCategory === key) return;
    activeCategory = key;
    updateOverviewList();
    // Same re-reveal behavior as switching tabs (tab-navigation.js) - no-ops if the
    // selection isn't in this category, since scrollOverviewToLayer() has no index for it.
    const selected = getEffectiveSelectedLayer();
    if (selected) scrollOverviewToLayer(selected);
  });

  const countEl = document.createElement("span");
  countEl.className = "overview-category-pill-count";

  entry = { pill, countEl };
  overviewPillNodesByKey.set(key, entry);
  return entry;
}

/**
 * Renders the category pills and their counts as grid items in the shared controls row - one
 * column per non-empty group (fixed OVERVIEW_GROUP_ORDER), detaching pairs whose group just
 * emptied while keeping them cached. Rebuilds grid-template-columns to match the currently-
 * visible categories: icons keep columns 1-3, then a 2px gap before the first category and
 * 3px before each one after, with a max-content column per category shared by its pill and
 * count - centering a count under its pill for free, no JS measurement needed. max-content,
 * not auto: auto tracks absorb leftover row space (CSS grid's "maximize tracks" step), which
 * spreads pills out instead of packing them left at their natural width.
 * @param {Record<string, L.Layer[]>} groupedItems
 */
function renderCategoryPills(groupedItems) {
  const columns = [OVERVIEW_ICON_WIDTH, OVERVIEW_ICON_WIDTH, OVERVIEW_ICON_WIDTH];
  let visibleIndex = 0;

  OVERVIEW_GROUP_ORDER.forEach((key) => {
    const itemsInGroup = groupedItems[key];
    const cachedEntry = overviewPillNodesByKey.get(key);

    if (!itemsInGroup || itemsInGroup.length === 0) {
      if (cachedEntry) {
        cachedEntry.pill.remove();
        cachedEntry.countEl.remove();
      }
      return;
    }

    const { pill, countEl } = getOrCreatePill(key, OVERVIEW_PILL_LABELS[key]);
    pill.classList.toggle("active", key === activeCategory);
    countEl.textContent = itemsInGroup.length;

    const column = `${5 + visibleIndex * 2}`;
    pill.style.gridColumn = column;
    countEl.style.gridColumn = column;
    overviewControlsRow.appendChild(pill);
    overviewControlsRow.appendChild(countEl);

    columns.push(visibleIndex === 0 ? "2px" : "3px", "max-content");
    visibleIndex++;
  });

  overviewControlsRow.style.gridTemplateColumns = columns.join(" ");
}

/**
 * Makes sure the pinned controls container has its shared controls row (eye/delete/duplicate +
 * category pills) - created once and reused, mirroring ensureOverviewListStructure()'s
 * spacers. Recreates it if the empty-state branch in updateOverviewList() wiped the
 * container's content since the last render.
 * @param {HTMLElement} controlsContainer
 */
function ensureOverviewControlsRow(controlsContainer) {
  if (!overviewControlsRow || !controlsContainer.contains(overviewControlsRow)) {
    overviewControlsRow = createOverviewControlsRow();
    controlsContainer.appendChild(overviewControlsRow);
  }
}

/**
 * Makes sure the overview list container has its virtualization spacers (a top and bottom
 * one - normal-flow elements sized to represent the rows scrolled past above/below the
 * rendered window, so the container's scrollbar behaves as if every row were really
 * there) and its scroll/resize listeners - both set up lazily, once. Recreates the
 * spacers if the empty-state branch in updateOverviewList() wiped the container's content
 * since the last render.
 * @param {HTMLElement} listContainer
 */
function ensureOverviewListStructure(listContainer) {
  if (!overviewTopSpacer || !listContainer.contains(overviewTopSpacer)) {
    listContainer.innerHTML = "";
    overviewTopSpacer = document.createElement("div");
    overviewTopSpacer.className = "overview-list-spacer";
    overviewBottomSpacer = document.createElement("div");
    overviewBottomSpacer.className = "overview-list-spacer";
    listContainer.appendChild(overviewTopSpacer);
    listContainer.appendChild(overviewBottomSpacer);
    overviewNodesByKey.clear();
  }

  if (!overviewScrollListenerAttached) {
    const scheduleRender = () => {
      if (overviewRenderScheduled) return;
      overviewRenderScheduled = true;
      requestAnimationFrame(() => {
        overviewRenderScheduled = false;
        renderOverviewWindow();
      });
    };
    listContainer.addEventListener("scroll", scheduleRender, { passive: true });
    // Catches the panel's own size changing (e.g. window resize) even without a scroll -
    // otherwise newly-revealed space at the bottom would stay unrendered until the next
    // scroll event. Shares scroll's rAF throttle (scheduleRender) rather than calling
    // renderOverviewWindow() directly, so a resize that also shifts scrollTop (browsers
    // fire a native scroll event when content shrinks and the old position no longer fits)
    // can't trigger two renders back-to-back for one visual change.
    new ResizeObserver(scheduleRender).observe(listContainer);
    overviewScrollListenerAttached = true;
  }
}

/**
 * Renders whichever slice of overviewActiveItems currently falls within the container's
 * visible scroll range (+ a small buffer) as real DOM elements, reusing/patching ones
 * that are already there and removing ones that scrolled out - so the DOM only ever holds
 * a screenful of rows, however many items the active category logically has. Rendered rows
 * stay in normal document flow between the top/bottom spacers (reordered via insertBefore
 * when their position actually changes), rather than being pulled out with absolute
 * positioning. Called after every structural change (via updateOverviewList()), on every
 * scroll/resize, and directly wherever else the visible window can go stale without one of
 * those - a new/changed selection (selectItem() in map-interactions.js), the panel tab just
 * becoming visible (tab-navigation.js), or scrollOverviewToLayer() below.
 */
function renderOverviewWindow() {
  const listContainer = document.getElementById("overview-panel-list");
  if (!listContainer || !overviewTopSpacer || !overviewBottomSpacer) return;

  const total = overviewActiveItems.length;
  if (total === 0) return;
  const rowH = OVERVIEW_ROW_HEIGHT;
  const scrollTop = listContainer.scrollTop;
  const viewHeight = listContainer.clientHeight;

  const endIndex = Math.min(
    total - 1,
    Math.ceil((scrollTop + viewHeight + OVERVIEW_SCROLL_BUFFER_PX) / rowH),
  );
  // Clamped against endIndex, not just 0: scrollTop can be stale relative to a just-shrunk
  // total (e.g. switching to a smaller active category while scrolled deep in a larger one),
  // in which case an unclamped startIndex could exceed endIndex and skip the render loop
  // entirely, leaving overviewTopSpacer sized to a huge, stale height.
  const startIndex = Math.min(
    Math.max(0, Math.floor((scrollTop - OVERVIEW_SCROLL_BUFFER_PX) / rowH)),
    endIndex,
  );

  overviewTopSpacer.style.height = `${startIndex * rowH}px`;
  overviewBottomSpacer.style.height = `${(total - endIndex - 1) * rowH}px`;

  // Stamped once per index and reused below in the patch loop, rather than re-stamping the
  // same layers a second time there.
  const rowKeys = [];
  for (let i = startIndex; i <= endIndex; i++) {
    rowKeys.push(L.Util.stamp(overviewActiveItems[i]));
  }
  const seenKeys = new Set(rowKeys);

  // Evict rows that fell outside the new window (or are no longer part of the active
  // category at all - deleted items, or the active category was switched) BEFORE
  // reconciling DOM order below. Otherwise a node about to be evicted here (e.g. the old
  // startIndex, on a single-row scroll forward) would still be sitting where `cursor`
  // starts, and since it never matches any node in the loop below, every remaining node
  // would get insertBefore'd one-by-one even though their relative order among themselves
  // never actually changed - O(window size) DOM moves for what only needs 2 (drop the
  // evicted node, append the new one).
  overviewNodesByKey.forEach((node, key) => {
    if (!seenKeys.has(key)) {
      node.remove();
      overviewNodesByKey.delete(key);
    }
  });

  let cursor = overviewTopSpacer.nextSibling;

  for (let i = startIndex; i <= endIndex; i++) {
    const layer = overviewActiveItems[i];
    const nodeKey = rowKeys[i - startIndex];
    let node = overviewNodesByKey.get(nodeKey);

    if (!node) {
      node = createOverviewListItem(layer);
      overviewNodesByKey.set(nodeKey, node);
    } else {
      patchOverviewListItem(node, layer);
    }

    // DOM order no longer matches display order once virtualized (the spacers are always
    // the true first/last children), so "last item in the whole list" (for the CSS rule
    // that used to key off :last-child) has to be tracked explicitly.
    node.classList.toggle("overview-last-in-list", i === total - 1);

    if (node === cursor) {
      cursor = cursor.nextSibling;
    } else {
      listContainer.insertBefore(node, cursor);
    }
  }
}

/**
 * Scrolls the overview list so the given layer's row is visible - only moving the scroll
 * position if it isn't already (mirroring scrollIntoView({block: "nearest"})). Only forces
 * an immediate render if scrollTop actually changed: every caller already runs this right
 * after some other render (updateOverviewList()/renderOverviewWindow()) that used the same
 * scrollTop, so if this row's target position was already inside the viewport, that prior
 * render is guaranteed to have already covered it (its window is always >= the viewport,
 * padded by OVERVIEW_SCROLL_BUFFER_PX) - re-rendering again here would be redundant.
 * @param {L.Layer} layer
 */
function scrollOverviewToLayer(layer) {
  const listContainer = document.getElementById("overview-panel-list");
  // No real viewport to align against while hidden (e.g. collapsed) - scrollTop math against
  // a clientHeight of 0 would misplace the row instead of bringing it into view.
  if (!listContainer || !listContainer.clientHeight) return;
  const layerId = L.Util.stamp(layer);
  const index = overviewLayerIndex.get(layerId);
  if (index === undefined) return;

  const rowTop = index * OVERVIEW_ROW_HEIGHT;
  const rowBottom = rowTop + OVERVIEW_ROW_HEIGHT;
  const viewTop = listContainer.scrollTop;
  const viewBottom = viewTop + listContainer.clientHeight;

  let scrolled = false;
  if (rowTop < viewTop) {
    listContainer.scrollTop = rowTop;
    scrolled = true;
  } else if (rowBottom > viewBottom) {
    listContainer.scrollTop = rowBottom - listContainer.clientHeight;
    scrolled = true;
  }

  if (scrolled) renderOverviewWindow();
}

// Stable grouping keys and their fixed display order, decoupled from the display label so
// renaming a label can never silently break the ordering/lookup logic that compares
// against it. Used by updateOverviewList() below.
const OVERVIEW_GROUP_ORDER = ["DrawnItems", "ImportedFiles", "StravaActivities", "Other"];
const OVERVIEW_GROUP_LABELS = {
  DrawnItems: "Drawn Items",
  ImportedFiles: "Imported Files",
  StravaActivities: "Strava Activities",
  Other: "Other",
};
// Short labels for the compact category pills (see getOrCreatePill()) - distinct from
// OVERVIEW_GROUP_LABELS above, which stays full-length for dialog copy (delete/duplicate
// confirmation titles) where there's room for it.
const OVERVIEW_PILL_LABELS = {
  DrawnItems: "Drawn",
  ImportedFiles: "Imported",
  StravaActivities: "Strava",
  Other: "Other",
};

// Maps a layer's pathType to its overview-list group key.
function getGroupTitle(pathType) {
  switch (pathType) {
    case "route":
    case "drawn":
      return "DrawnItems";
    case "gpx":
    case "kml":
    case "geojson":
    case "kmz":
      return "ImportedFiles";
    case "strava":
      return "StravaActivities";
    default:
      return "Other";
  }
}

// Switches the active category to the one containing layer, if it isn't already,
// ensuring the layer is visible in the list.
// @returns {boolean} Whether it changed category (and already re-rendered).
function activateCategoryForItem(layer) {
  const key = getGroupTitle(layer.feature?.properties?.pathType);
  if (activeCategory === key) return false;
  activeCategory = key;
  updateOverviewList();
  return true;
}

/**
 * Populates or updates the overview panel with all items on the map, grouped by type. Also
 * keeps the GeoJSON Editor tab (data-editor.js) live, since any caller of this is implicitly
 * reporting that the map's data changed.
 *
 * The shared controls row and category pills are pinned outside the item list (see
 * renderCategoryPills()/patchOverviewControlsRow()); exactly one category is "active"
 * (activeCategory) at a time, and the item list below only shows that category's items. The
 * item list itself is virtualized (see renderOverviewWindow()): this function only rebuilds
 * overviewActiveItems, the ordered description of what the list WOULD contain if nothing
 * were virtualized - actually creating/patching item DOM is delegated to
 * renderOverviewWindow(), which only ever touches the currently-visible slice, so a call
 * here stays cheap regardless of how many items are on the map.
 */
function updateOverviewList() {
  const listContainer = document.getElementById("overview-panel-list");
  const controlsContainer = document.getElementById("overview-panel-controls");
  if (!listContainer || !controlsContainer) return;
  scheduleDataEditorRefresh();
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
    // The collapse arrow is wiped below with the rest of the controls row - a leftover
    // .collapsed would hide the "No items on map" message with no button left to undo it.
    overviewPanel.classList.remove("collapsed");
    activeCategory = null;
    overviewRenderedCategory = null;
    overviewActiveItems = [];
    overviewLayerIndex = new Map();
    overviewNodesByKey.clear();
    overviewTopSpacer = null;
    overviewBottomSpacer = null;
    // The controls row and pills stay cached (overviewPillNodesByKey) for reuse - only
    // detached from the DOM for now, along with the now-stale controlsRow reference
    // (ensureOverviewControlsRow() rebuilds it next time).
    overviewControlsRow = null;
    controlsContainer.innerHTML = "";
    listContainer.innerHTML =
      '<div class="overview-list-item overview-list-empty-message" style="color: grey; cursor: default;">No items on map</div>';
    return;
  }

  // If we get here, the list is not empty, so remove the class
  overviewPanel.classList.remove("is-empty");

  // 2. Group all items by their type
  const groupedItems = {};
  // Stays function-local, unlike its siblings OVERVIEW_GROUP_ORDER/_LABELS/_PILL_LABELS
  // above - drawnItems/importedItems/stravaActivitiesLayer aren't assigned until main.js
  // runs (after this script loads), so hoisting this out would throw a TDZ ReferenceError at
  // load time instead of waiting until this function actually runs.
  const GROUP_LAYERS = {
    DrawnItems: drawnItems,
    ImportedFiles: importedItems,
    StravaActivities: stravaActivitiesLayer,
  };

  allItems.forEach((layer) => {
    const key = getGroupTitle(layer.feature?.properties?.pathType);
    if (!groupedItems[key]) {
      groupedItems[key] = [];
    }
    groupedItems[key].push(layer);
  });

  // 3. Resolve the effective active category - defaults to the first non-empty group (in
  // fixed order) on first load, and falls back the same way if the previously-active
  // category just ran out of items (e.g. its last item was deleted). Guaranteed non-empty:
  // the allItems.length === 0 check above already ruled out every group being empty.
  const nonEmptyKeys = OVERVIEW_GROUP_ORDER.filter((key) => groupedItems[key]?.length);
  if (!activeCategory || !nonEmptyKeys.includes(activeCategory)) {
    activeCategory = nonEmptyKeys[0];
  }
  // Stale scrollTop from the previous category would otherwise clamp into the
  // middle/bottom of the new one instead of showing it from the top.
  if (activeCategory !== overviewRenderedCategory) {
    listContainer.scrollTop = 0;
  }
  overviewRenderedCategory = activeCategory;

  ensureOverviewControlsRow(controlsContainer);
  patchOverviewControlsRow(
    overviewControlsRow,
    activeCategory,
    OVERVIEW_GROUP_LABELS[activeCategory],
    GROUP_LAYERS[activeCategory] || null,
    groupedItems[activeCategory],
  );
  renderCategoryPills(groupedItems);

  // 4. Build the active category's items - used for scroll-height/index math;
  // renderOverviewWindow() decides which of them actually become DOM.
  overviewActiveItems = groupedItems[activeCategory];
  overviewLayerIndex = new Map();
  overviewActiveItems.forEach((layer, i) => {
    overviewLayerIndex.set(L.Util.stamp(layer), i);
  });

  ensureOverviewListStructure(listContainer);
  renderOverviewWindow();

  // Sync checkboxes in the custom layers panel with the map's current state
  Object.entries(GROUP_LAYERS).forEach(([name, group]) => {
    const checkbox = document.querySelector(
      `#custom-layers-panel input[data-layer-name="${name}"]`,
    );
    if (checkbox) checkbox.checked = map.hasLayer(group);
  });
}

/**
 * Shows the info panel's edit hint as a clickable pill that performs the given action.
 */
function setEditHint(icon, text, onClick) {
  const editHint = document.getElementById("info-panel-edit-hint");
  editHint.innerHTML = `${text}<span class="material-symbols">${icon}</span>`;
  editHint.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };
  editHint.style.display = "block";
}

/**
 * Displays the info panel with details about the selected layer.
 * @param {L.Layer} layer - The selected layer
 */
function showInfoPanel(layer) {
  // Don't clobber the simplification slider shown here during Edit mode.
  if (isEditMode) return;

  // Style adjustments for when an item is selected
  infoPanel.classList.remove("no-selection");
  infoPanelName.style.display = "block";
  infoPanelDetails.style.fontSize = "var(--font-size-12)"; // Reset font size
  infoPanel.style.justifyContent = "flex-start";
  infoPanelDetails.style.marginTop = "5px";

  // Populating content
  layer.feature = layer.feature || {};
  layer.feature.properties = layer.feature.properties || {};
  let name = layer.feature.properties.name || getDefaultLayerName(layer);
  let details = "";
  const editHint = document.getElementById("info-panel-edit-hint");
  const stravaLink = document.getElementById("info-panel-strava-link");

  // Clear previous click handler and reset cursor
  infoPanelDetails.onclick = null;
  infoPanelDetails.style.cursor = "default";
  infoPanelDetails.title = "";

  // Hide hint and Strava link by default
  editHint.style.display = "none";
  editHint.onclick = null;
  stravaLink.style.display = "none";

  if (layer instanceof L.Marker) {
    const latlng = layer.getLatLng();
    details = `<span>Lat: ${latlng.lat.toFixed(6)}, Lon: ${latlng.lng.toFixed(
      6,
    )}<span class="copy-icon material-symbols">content_copy</span>`;
    infoPanelDetails.innerHTML = details;

    // Add click-to-copy functionality for marker coordinates
    infoPanelDetails.style.cursor = "pointer";
    infoPanelDetails.title = "Click to copy coordinates";

    infoPanelDetails.onclick = (e) => {
      L.DomEvent.stop(e); // Prevent event from bubbling up
      const coordString = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
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
    const perimeter = calculatePathDistance(layer);
    // A self-crossing ring makes the shoelace-based area figure meaningless
    // (its lobes wind in opposite directions and partially cancel out instead
    // of adding) - show that plainly instead of a silently wrong number.
    const areaLine = isSelfIntersectingRing(layer.getLatLngs()[0])
      ? "Self-intersecting shape"
      : `Area: ${formatArea(calculatePolygonArea(layer))}`;
    const pointCount = flattenRingPoints(layer.getLatLngs()).length;

    details = `${areaLine}<br>Perimeter: ${formatDistance(perimeter)}<br>Points: ${pointCount}`;
  } else if (layer instanceof L.Polyline) {
    // Recalculate distance from geometry to ensure consistency with elevation panel
    const totalDistance = calculatePathDistance(layer);
    const pointCount = layer.getLatLngs().length;

    // Update the cached property
    if (layer.feature && layer.feature.properties) {
      layer.feature.properties.totalDistance = totalDistance;
    }

    details = `Length: ${formatDistance(totalDistance)}<br>Points: ${pointCount}`;
  }

  infoPanelName.value = name;
  infoPanelDetails.innerHTML = details;

  infoPanelStyleRow.style.display = "flex";

  // Determine layer type for display
  let layerTypeName = "Unknown";
  switch (layer.feature?.properties?.pathType) {
    case "drawn":
      layerTypeName = "Drawn Item";
      break;
    case "gpx":
    case "kml":
    case "geojson":
    case "kmz":
      // Check if this is a Strava activity that was imported
      layerTypeName = layer.feature?.properties?.stravaId
        ? "Imported Item (Strava Activity)"
        : "Imported Item";
      setEditHint("add_to_photos", "Duplicate to edit", () => duplicateLayer(layer));
      break;
    case "route":
      layerTypeName = "Drawn Item (Route)";
      setEditHint("save", "Save to edit", () => window.app.saveRoute());
      break;
    case "strava":
      const activityType = layer.feature.properties.type || "";
      layerTypeName = `Strava Activity ${activityType ? `(${activityType})` : ""}`.trim();
      setEditHint("add_to_photos", "Duplicate to edit", () => duplicateLayer(layer));
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
  infoPanelColorSwatch.innerHTML = ""; // clear any leftover "mixed colors" indicator
  updateColorPickerSelection(color);

  // Hide the main color picker initially
  colorPicker.style.display = "none";
}

/**
 * Applies the shared "no single item selected" visual state to the info panel's
 * details text: centered placeholder styling with no click handler, and the
 * edit-hint/Strava-link hidden. Shared by resetInfoPanel() (nothing selected)
 * and showMultiSelectInfoPanel() (multiple items selected via rectangle-select).
 * @param {string} text - The message to show in place of an item name
 */
function resetInfoPanelDetailsStyle(text) {
  infoPanelName.style.display = "none";
  infoPanelDetails.textContent = text;
  infoPanelDetails.style.fontWeight = "normal";
  infoPanelDetails.style.fontSize = "var(--font-size-14)"; // Larger font for this message
  infoPanel.style.justifyContent = "center";
  infoPanelDetails.style.marginTop = "0";

  // Ensure click handler and styles are reset
  infoPanelDetails.onclick = null;
  infoPanelDetails.style.cursor = "default";
  infoPanelDetails.title = "";

  // Hide the hint and Strava link
  const editHint = document.getElementById("info-panel-edit-hint");
  editHint.style.display = "none";
  editHint.onclick = null;
  document.getElementById("info-panel-strava-link").style.display = "none";
}

/**
 * Resets the info panel to its default state (no item selected).
 */
function resetInfoPanel() {
  if (infoPanel) {
    infoPanel.classList.add("no-selection");
    resetInfoPanelDetailsStyle("No item selected");

    // Hide color picker and the new style row
    infoPanelStyleRow.style.display = "none";
    colorPicker.style.display = "none";
  }
}

/**
 * Displays the info panel's multi-selection state, used when the rectangle-select
 * tool has more than one item selected: shows a count instead of name/details,
 * but (unlike resetInfoPanel) keeps the style row visible so the color swatch
 * can be used to bulk-apply a color to every selected item.
 * @param {number} count - Number of currently selected items
 * @param {string} [commonColor] - The shared color if every selected item
 *   already has the same one; omit/undefined if the selection is mixed.
 */
function showMultiSelectInfoPanel(count, commonColor) {
  if (!infoPanel) return;
  // Don't clobber the simplification slider shown here during Edit mode.
  if (isEditMode) return;
  infoPanel.classList.remove("no-selection");
  resetInfoPanelDetailsStyle(`${count} items selected`);

  // The swatch shows the shared color if every selected item already has the
  // same one (self-explanatory, same as single-select), or a "mixed colors"
  // question mark otherwise - labeled here so the "?" doesn't read as an
  // unknown/error state instead of "click to set a color for everyone".
  infoPanelLayerName.textContent = commonColor ? "" : "Mixed colors";
  infoPanelStyleRow.style.display = "flex";
  colorPicker.style.display = "none";
  infoPanelColorSwatch.style.backgroundColor = commonColor || "var(--background2-color)";
  infoPanelColorSwatch.innerHTML = commonColor
    ? ""
    : '<span class="material-symbols">question_mark</span>';
  updateColorPickerSelection(commonColor);
}

/**
 * Updates the name of the selected layer from the info panel input.
 * Falls back to the rectangle-select tool's single selected layer, since the
 * info panel shows the same editable name field for that case too.
 */
function updateLayerName() {
  const target = getEffectiveSelectedLayer();
  if (target && target.feature.properties) {
    let newName = infoPanelName.value.trim();
    if (!newName) {
      // Default name if input is empty
      newName = getDefaultLayerName(target);
      infoPanelName.value = newName;
    }
    target.feature.properties.name = newName;
    updateOverviewList();
  }
}

/**
 * Whether there's something for the color picker to act on: either a normal
 * single selection, or an active rectangle-select selection (single or bulk).
 * @returns {boolean}
 */
function hasActiveColorTarget() {
  return getCurrentSelectionLayers().length > 0;
}

/**
 * Populates the color picker: close button, palette swatches, custom color swatch.
 */
function populateColorPicker() {
  colorPickerCloseBtn = document.createElement("span");
  colorPickerCloseBtn.id = "color-picker-close-btn";
  colorPickerCloseBtn.className = "material-symbols";
  colorPickerCloseBtn.textContent = "close";
  colorPickerCloseBtn.addEventListener("click", () => {
    colorPicker.style.display = "none";
  });
  colorPicker.appendChild(colorPickerCloseBtn);

  // Add palette colors
  COLOR_PALETTE.forEach((color) => {
    const swatch = document.createElement("div");
    swatch.className = "color-swatch";
    swatch.style.backgroundColor = color.hex;
    swatch.dataset.hex = color.hex;
    swatch.title = color.name;

    swatch.addEventListener("click", () => {
      if (!hasActiveColorTarget()) return;
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
    if (!hasActiveColorTarget()) {
      e.preventDefault();
    }
  });

  // When native picker color changes, apply it (don't hide picker while user is selecting)
  colorInput.addEventListener("input", (e) => {
    if (!hasActiveColorTarget()) return;
    const selectedColor = e.target.value.toUpperCase();
    applyColorToSelectedItem(selectedColor, false);
    customSwatch.dataset.hex = selectedColor;
  });

  customSwatch.appendChild(colorInput);
  colorPicker.appendChild(customSwatch);
}

/**
 * Moves the close button to the end of row 1 (values must match the CSS).
 */
function repositionColorPickerCloseButton() {
  const swatchSize = 24;
  const gap = 5;
  const padding = 5;
  const contentWidth = colorPicker.clientWidth - 2 * padding;
  const columns = Math.max(1, Math.floor((contentWidth + gap) / (swatchSize + gap)));

  const swatches = Array.from(colorPicker.children).filter((el) => el !== colorPickerCloseBtn);
  colorPicker.insertBefore(colorPickerCloseBtn, swatches[columns - 1] ?? null);
}

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
 * Grabs the info panel's DOM elements into their globals, wires up the name
 * textarea and color swatch, and keeps the textarea height in sync via a
 * mutation observer (for programmatic content changes) and the pen-mode-exit
 * event (for the draw-mode name field).
 */
function initInfoPanel() {
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
  new ResizeObserver(repositionColorPickerCloseButton).observe(colorPicker);

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
}

/**
 * Applies a color to whatever is currently selected: an active rectangle-select
 * selection (single or multiple layers) takes priority, otherwise falls back
 * to the normal single-item selection.
 * @param {string} hex - The hex color to apply
 * @param {boolean} hidePicker - Whether to hide the color picker after (default true)
 */
function applyColorToSelectedItem(hex, hidePicker = true) {
  // Rectangle-select selection (single or multiple) takes priority: apply to
  // every selected layer's data only. Selected layers render in the tool's
  // blue selection highlight regardless of their own color, so - same as a
  // single item's real color only reappearing once it's deselected - the new
  // color becomes visible once each layer is deselected, not immediately.
  const rectSelectionCount = window.app?.getRectangleSelectionCount?.() ?? 0;
  if (rectSelectionCount > 0) {
    window.app.applyBulkColor(hex);
    updateColorPickerSelection(hex);
    infoPanelColorSwatch.style.backgroundColor = hex;
    infoPanelColorSwatch.innerHTML = ""; // every selected item now shares this color
    // Only the multi-select state's "Mixed colors" label needs clearing - a
    // single rect-selected item's layer-name text (e.g. "Drawn Item") is
    // unrelated and must stay as-is.
    if (rectSelectionCount > 1) {
      infoPanelLayerName.textContent = "";
    }
    if (hidePicker) colorPicker.style.display = "none";
    scheduleDataEditorRefresh();
    return;
  }

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
  scheduleDataEditorRefresh();
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
