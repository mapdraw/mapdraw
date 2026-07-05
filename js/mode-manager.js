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

(function () {
  const groups = new Map();

  function getGroup(name) {
    let g = groups.get(name);
    if (!g) {
      g = { activeId: null, activeOnCancel: null };
      groups.set(name, g);
    }
    return g;
  }

  function activateMode(id, { onCancel, group = "tools" }) {
    const g = getGroup(group);
    if (g.activeId && g.activeId !== id) g.activeOnCancel();
    g.activeId = id;
    g.activeOnCancel = onCancel;
  }

  function deactivateMode(id, group = "tools") {
    const g = getGroup(group);
    if (g.activeId !== id) return;
    g.activeId = null;
    g.activeOnCancel = null;
  }

  function cancelActiveMode(group = "tools") {
    const g = getGroup(group);
    if (!g.activeId) return;
    const onCancel = g.activeOnCancel;
    g.activeId = null;
    g.activeOnCancel = null;
    onCancel();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (e.target.matches("input, textarea")) return;
    cancelActiveMode("tools");
    cancelActiveMode("panels");
  });

  window.app = window.app || {};
  window.app.activateMode = activateMode;
  window.app.deactivateMode = deactivateMode;
  window.app.cancelActiveMode = cancelActiveMode;
})();
