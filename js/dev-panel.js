// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Dev Panel
(function () {
  "use strict";

  let panel = null;
  let visible = false;

  // Command definitions - single source of truth
  const commands = {
    features: [
      { id: "drawn", cmd: "drawnItems.getLayers()", exec: () => drawnItems.getLayers() },
      { id: "imported", cmd: "importedItems.getLayers()", exec: () => importedItems.getLayers() },
      {
        id: "strava",
        cmd: "stravaActivitiesLayer.getLayers()",
        exec: () => stravaActivitiesLayer.getLayers(),
      },
      { id: "editable", cmd: "editableLayers.getLayers()", exec: () => editableLayers.getLayers() },
      { id: "all", cmd: "getAllExportableLayers()", exec: () => getAllExportableLayers() },
    ],
    selected: [
      { id: "selected", cmd: "globallySelectedItem", exec: () => globallySelectedItem },
      { id: "route", cmd: "currentRoutePath", exec: () => currentRoutePath },
    ],
    map: [
      { id: "map", cmd: "map", exec: () => map },
      { id: "bounds", cmd: "map.getBounds()", exec: () => map.getBounds() },
      { id: "center", cmd: "map.getCenter()", exec: () => map.getCenter() },
      { id: "zoom", cmd: "map.getZoom()", exec: () => map.getZoom() },
      { id: "panes", cmd: "map._panes", exec: () => map._panes },
      {
        id: "layers",
        cmd: "map.eachLayer()",
        exec: () => {
          const layers = [];
          map.eachLayer((layer) => layers.push(layer));
          return layers;
        },
      },
    ],
    storage: [
      {
        id: "autosave",
        cmd: 'indexedDB("keyval-store").get("mapAutosave")',
        exec: () =>
          new Promise((resolve, reject) => {
            const req = indexedDB.open("keyval-store");
            req.onsuccess = (e) => {
              const db = e.target.result;
              const tx = db.transaction("keyval", "readonly");
              const store = tx.objectStore("keyval");
              store.get("mapAutosave").onsuccess = (e) => resolve(e.target.result);
            };
            req.onerror = () => reject(new Error("Failed to open IndexedDB"));
          }),
      },
    ],
  };

  function init() {
    if (panel) return;

    panel = document.createElement("div");
    panel.id = "dev-panel";
    panel.innerHTML = `
      <div id="dev-header">
        <span>Developer Panel</span>
        <button id="dev-close"><span class="material-symbols">close</span></button>
      </div>
      <div id="dev-content">
        <div id="dev-console-hint">
          Open browser console to see command output
        </div>
        <div class="dev-section">
          <h3>View Features</h3>
          ${commands.features.map((c) => `<button data-action="${c.id}">${c.cmd}</button>`).join("")}
        </div>
        <div class="dev-section">
          <h3>Selected Features</h3>
          ${commands.selected.map((c) => `<button data-action="${c.id}">${c.cmd}</button>`).join("")}
        </div>
        <div class="dev-section">
          <h3>Feature Counts</h3>
          <div id="dev-counts"></div>
        </div>
        <div class="dev-section">
          <h3>Map</h3>
          ${commands.map.map((c) => `<button data-action="${c.id}">${c.cmd}</button>`).join("")}
        </div>
        <div class="dev-section">
          <h3>Storage</h3>
          ${commands.storage.map((c) => `<button data-action="${c.id}">${c.cmd}</button>`).join("")}
        </div>
      </div>
    `;

    const style = document.createElement("style");
    style.textContent = `
      #dev-panel {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 250px;
        max-height: 400px;
        background: var(--background-color);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        z-index: 10000;
        display: none;
        flex-direction: column;
        font-size: var(--font-size-14);
        color: var(--text-color);
      }
      #dev-panel.visible { display: flex; }
      #dev-header {
        padding: 8px 10px;
        background: var(--background2-color);
        border-bottom: 1px solid var(--border-color);
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: move;
        font-weight: bold;
        border-radius: var(--border-radius) var(--border-radius) 0 0;
      }
      #dev-close {
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        color: var(--text-color);
        cursor: pointer;
        padding: 0;
        width: 20px;
        height: 20px;
      }
      #dev-content {
        flex: 1;
        overflow-y: auto;
        padding: 10px;
      }
      #dev-console-hint {
        margin-bottom: 12px;
        font-size: var(--font-size-12);
        font-weight: bold;
        color: var(--text-color);
      }
      .dev-section { margin-bottom: 15px; }
      .dev-section:last-child { margin-bottom: 0; }
      .dev-section h3 {
        margin: 0 0 6px 0;
        font-size: var(--font-size-12);
        color: var(--text-color);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        font-weight: 600;
      }
      .dev-section button {
        display: block;
        width: 100%;
        margin-bottom: 4px;
        padding: 6px 8px;
        background: var(--background-color);
        border: 1px solid var(--border-color);
        color: var(--text-color);
        border-radius: var(--border-radius);
        cursor: pointer;
        font-size: var(--font-size-12);
        text-align: left;
      }
      .dev-section button:active {
        transform: scale(0.98);
      }
      #dev-counts {
        padding: 8px;
        background: var(--background2-color);
        border-radius: var(--border-radius);
        font-size: var(--font-size-12);
        line-height: 1.6;
      }
      #dev-counts div {
        display: flex;
        justify-content: space-between;
      }
      body.glass-mode #dev-panel {
        background: var(--glass-bg);
        backdrop-filter: var(--glass-blur);
        -webkit-backdrop-filter: var(--glass-blur);
      }
      body.glass-mode #dev-header {
        background: var(--glass-btn-bg);
      }
      body.glass-mode .dev-section button {
        background: var(--glass-btn-bg);
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(panel);

    // Dragging
    const header = panel.querySelector("#dev-header");
    let dragging = false,
      x,
      y,
      startX,
      startY;

    const onMouseDown = (e) => {
      if (e.target.tagName === "BUTTON") return;
      dragging = true;
      startX = e.clientX - panel.offsetLeft;
      startY = e.clientY - panel.offsetTop;
    };

    const onMouseMove = (e) => {
      if (!dragging) return;
      e.preventDefault();
      x = e.clientX - startX;
      y = e.clientY - startY;
      panel.style.left = x + "px";
      panel.style.top = y + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    };

    const onMouseUp = () => {
      dragging = false;
    };

    header.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    // Buttons
    panel.querySelector("#dev-close").onclick = hide;
    panel.querySelector("#dev-content").onclick = (e) => {
      const btn = e.target.closest("button");
      if (btn && btn.dataset.action) handleAction(btn.dataset.action);
    };
  }

  function toggle() {
    visible ? hide() : show();
  }

  function centerPanel() {
    if (!panel) return;
    // Need to measure after panel is visible
    requestAnimationFrame(() => {
      const panelWidth = panel.offsetWidth;
      const left = (window.innerWidth - panelWidth) / 2;
      panel.style.left = Math.max(10, left) + "px";
      panel.style.top = "10px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    });
  }

  function show() {
    init();
    panel.classList.add("visible");
    visible = true;
    centerPanel();
    updateCounts();
  }

  function hide() {
    if (panel) {
      panel.classList.remove("visible");
      centerPanel();
    }
    visible = false;
  }

  function handleAction(actionId) {
    console.clear();

    // Find command in all groups
    const allCommands = [
      ...commands.features,
      ...commands.selected,
      ...commands.map,
      ...commands.storage,
    ];
    const command = allCommands.find((c) => c.id === actionId);

    if (!command) return;

    try {
      console.log(`%c${command.cmd}`, "font-size: 16px; font-weight: bold;");
      const result = command.exec();
      if (result instanceof Promise) {
        result.then((value) => console.log(value)).catch((e) => console.log("Error:", e.message));
      } else {
        console.log(result);
      }
    } catch (e) {
      console.log("Error:", e.message);
    }

    updateCounts();
  }

  function updateCounts() {
    if (!panel || !visible) return;
    const div = panel.querySelector("#dev-counts");
    if (!div) return;

    const counts = [
      { label: "drawn", get: () => drawnItems.getLayers().length },
      { label: "imported", get: () => importedItems.getLayers().length },
      { label: "strava", get: () => stravaActivitiesLayer.getLayers().length },
      { label: "editable", get: () => editableLayers.getLayers().length },
      { label: "exportable", get: () => getAllExportableLayers().length },
    ];

    let html = "";
    counts.forEach(({ label, get }) => {
      try {
        html += `<div><span>${label}:</span> <b>${get()}</b></div>`;
      } catch {}
    });

    div.innerHTML = html || "No data";
  }

  window.toggleDevPanel = toggle;
})();
