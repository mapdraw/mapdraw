// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Mode Manager
// Tracks, per independent group, which single exclusive thing is currently
// active - a map-interaction mode (draw/edit/delete tool, rectangle-select,
// pen mode, route-point picking) in the "tools" group (the default), or an
// overlay panel (layers/downloads/elevation) in the "panels" group. Within
// a group, activating one cancels whichever other one in that same group
// was active, and Escape cancels whichever is active in every group. Each
// caller registers its own cancel callback - this module has no knowledge
// of what any mode/panel actually does.
//
// A mode may also register a canSelect(layer) predicate, letting selectItem()
// (map-interactions.js) defer to whichever mode is active instead of every
// caller re-checking each exclusive mode by name.

(function () {
  const groups = new Map();
  const alwaysBlockSelection = () => false;

  function getGroup(name) {
    let g = groups.get(name);
    if (!g) {
      g = { activeId: null, activeOnCancel: null, activeCanSelect: null };
      groups.set(name, g);
    }
    return g;
  }

  function activateMode(id, { onCancel, group = "tools", canSelect = alwaysBlockSelection }) {
    const g = getGroup(group);
    if (g.activeId && g.activeId !== id) g.activeOnCancel();
    g.activeId = id;
    g.activeOnCancel = onCancel;
    g.activeCanSelect = canSelect;
  }

  function deactivateMode(id, group = "tools") {
    const g = getGroup(group);
    if (g.activeId !== id) return;
    g.activeId = null;
    g.activeOnCancel = null;
    g.activeCanSelect = null;
  }

  function cancelActiveMode(group = "tools") {
    const g = getGroup(group);
    if (!g.activeId) return;
    const onCancel = g.activeOnCancel;
    g.activeId = null;
    g.activeOnCancel = null;
    g.activeCanSelect = null;
    onCancel();
  }

  function isAnyModeActive(group = "tools") {
    return getGroup(group).activeId !== null;
  }

  function canSelectLayer(layer, group = "tools") {
    const g = getGroup(group);
    return g.activeId === null || g.activeCanSelect(layer);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // Swal-based fields (search, POI finder, route points) already close on
    // Escape themselves; plain fields (info panel name, Data-tab editor) don't,
    // so only exempt Swal dialogs instead of blocking every input.
    if (e.target.closest(".swal2-popup")) return;
    cancelActiveMode("tools");
    cancelActiveMode("panels");
  });

  window.app = window.app || {};
  window.app.activateMode = activateMode;
  window.app.deactivateMode = deactivateMode;
  window.app.cancelActiveMode = cancelActiveMode;
  window.app.isAnyModeActive = isAnyModeActive;
  window.app.canSelectLayer = canSelectLayer;
})();
