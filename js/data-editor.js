// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * GEOJSON EDITOR
 *
 * Desktop-only tab that shows all current map features as editable GeoJSON.
 * Auto-refreshes when the map changes. Supports applying edited JSON back to the map.
 *
 * - pathType is serialized into each feature so drawn vs. imported items survive a round-trip.
 * - Apply validates JSON, GeoJSON structure, and geometry before clearing the map.
 * - isDirty blocks auto-refresh while the user has unsaved edits in the editor.
 */

const CM_THEME_LIGHT = "eclipse";
const CM_THEME_DARK = "dracula";

let isDirty = false;
let cmEditor = null;

function buildDataEditorGeoJSON() {
  const allLayers = [...editableLayers.getLayers(), ...importedItems.getLayers()];
  const features = [];

  allLayers.forEach((layer) => {
    try {
      const geojson = layer.toGeoJSON();
      if (!geojson || !geojson.geometry || !geojson.geometry.type) return;

      applyFullPrecisionCoordinates(layer, geojson);

      geojson.properties = { ...geojson.properties, pathType: layer.pathType || "drawn" };

      features.push({
        type: "Feature",
        properties: geojson.properties,
        geometry: geojson.geometry,
      });
    } catch (e) {
      console.error("GeoJSON editor: error serializing layer", e);
    }
  });

  return { type: "FeatureCollection", features };
}

function refreshDataEditor() {
  if (isDirty || !cmEditor) return;
  const newJson = JSON.stringify(buildDataEditorGeoJSON(), null, 2);
  if (newJson === cmEditor.getValue()) return;
  const error = document.getElementById("data-editor-error");
  cmEditor.setValue(newJson);
  error.textContent = "";
  error.style.display = "none";
}

function applyDataEditor() {
  if (!cmEditor) return;
  const error = document.getElementById("data-editor-error");

  const raw = cmEditor.getValue().trim();
  let parsed;
  if (!raw) {
    parsed = { type: "FeatureCollection", features: [] };
  } else {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      error.textContent = "Invalid JSON: " + e.message;
      error.style.display = "block";
      return;
    }
  }

  if (parsed.type === "Feature") {
    parsed = { type: "FeatureCollection", features: [parsed] };
  } else if (parsed.type !== "FeatureCollection") {
    error.textContent = "Must be a GeoJSON FeatureCollection or Feature.";
    error.style.display = "block";
    return;
  }

  if (parsed.features?.length > 0) {
    try {
      if (L.geoJSON(parsed).getLayers().length === 0) {
        error.textContent = "No valid features found — check geometry types and coordinates.";
        error.style.display = "block";
        return;
      }
    } catch (e) {
      error.textContent = "Invalid geometry: " + e.message;
      error.style.display = "block";
      return;
    }
  }

  error.textContent = "";
  error.style.display = "none";

  deselectCurrentItem();
  window.app?.clearRouting?.({ skipUiUpdate: true });
  drawnItems.clearLayers();
  editableLayers.clearLayers();
  importedItems.clearLayers();

  const drawnFeatures = [];
  const importedFeatures = [];

  (parsed.features ?? []).forEach((f) => {
    const pt = f.properties?.pathType;
    if (pt === "drawn" || pt === "route") {
      drawnFeatures.push(f);
    } else {
      importedFeatures.push(f);
    }
  });

  if (importedFeatures.length > 0) {
    importGeoJsonToMap({ type: "FeatureCollection", features: importedFeatures }, "geojson");
  }

  if (drawnFeatures.length > 0) {
    const layerGroup = importGeoJsonToMap(
      { type: "FeatureCollection", features: drawnFeatures },
      "geojson",
    );
    layerGroup.eachLayer((layer) => {
      importedItems.removeLayer(layer);
      drawnItems.addLayer(layer);
      editableLayers.addLayer(layer);
      layer.pathType = layer.feature?.properties?.pathType || "drawn";
    });
  }

  updateOverviewList();
  updateDrawControlStates();
  isDirty = false;

  Swal.fire({
    toast: true,
    icon: "success",
    title: "Applied to Map!",
    showConfirmButton: false,
    timer: 1500,
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const tabBtn = document.getElementById("tab-btn-data");
  const textarea = document.getElementById("data-editor-textarea");
  const panel = document.getElementById("data-editor-panel");

  const getCmTheme = () =>
    document.body.classList.contains("dark-mode") || document.body.classList.contains("glass-mode")
      ? CM_THEME_DARK
      : CM_THEME_LIGHT;

  // Lazily initialize CodeMirror on first tab click so it measures correct dimensions
  // regardless of whether the tab was hidden at page load (e.g. mobile with force-desktop-layout).
  function initCodeMirror() {
    if (cmEditor) return;

    cmEditor = CodeMirror.fromTextArea(textarea, {
      mode: { name: "javascript", json: true },
      theme: getCmTheme(),
      lineNumbers: true,
      matchBrackets: true,
      foldGutter: true,
      gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter", "CodeMirror-lint-markers"],
      styleActiveLine: true,
      lineWrapping: false,
      lint: {
        getAnnotations: (text) => {
          if (!text.trim()) return [];
          try {
            JSON.parse(text);
          } catch (e) {
            let from = CodeMirror.Pos(0, 0);
            const posMatch = e.message.match(/at position (\d+)/);
            const lineColMatch = e.message.match(/at line (\d+) column (\d+)/);
            if (posMatch) {
              from = cmEditor.getDoc().posFromIndex(parseInt(posMatch[1]));
            } else if (lineColMatch) {
              from = CodeMirror.Pos(parseInt(lineColMatch[1]) - 1, parseInt(lineColMatch[2]) - 1);
            }
            return [
              {
                from,
                to: CodeMirror.Pos(from.line, from.ch + 1),
                message: e.message,
                severity: "error",
              },
            ];
          }
          return [];
        },
      },
      extraKeys: {
        "Cmd-Enter": applyDataEditor,
        "Ctrl-Enter": applyDataEditor,
        "Ctrl-Q": (cm) => cm.foldCode(cm.getCursor()),
      },
    });

    new MutationObserver(() => {
      cmEditor.setOption("theme", getCmTheme());
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

    // Only mark dirty on user edits, not on programmatic setValue calls
    cmEditor.on("change", (_cm, change) => {
      if (change.origin !== "setValue") {
        isDirty = true;
      }
    });
  }

  document.getElementById("data-editor-restore").addEventListener("click", () => {
    const hadEdits = isDirty;
    isDirty = false;
    refreshDataEditor();
    if (hadEdits) {
      Swal.fire({
        toast: true,
        icon: "info",
        title: "Reset to Map!",
        showConfirmButton: false,
        timer: 1500,
      });
    }
  });

  function copyGeoJSON(stripProperties) {
    if (!cmEditor) return;
    let text = cmEditor.getValue();
    if (stripProperties) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        Swal.fire({
          toast: true,
          icon: "error",
          title: "Invalid JSON",
          showConfirmButton: false,
          timer: 1500,
        });
        return;
      }
      if (parsed.type !== "Feature" && parsed.type !== "FeatureCollection") {
        Swal.fire({
          toast: true,
          icon: "error",
          title: "Invalid GeoJSON",
          showConfirmButton: false,
          timer: 1500,
        });
        return;
      }
      const fc =
        parsed.type === "Feature" ? { type: "FeatureCollection", features: [parsed] } : parsed;
      const clean = {
        ...fc,
        features: (fc.features ?? []).map((f) => ({ ...f, properties: {} })),
      };
      text = JSON.stringify(clean, null, 2);
    }
    navigator.clipboard
      .writeText(text)
      .then(() =>
        Swal.fire({
          toast: true,
          icon: "success",
          title: stripProperties ? "Clean GeoJSON Copied!" : "Raw GeoJSON Copied!",
          showConfirmButton: false,
          timer: 1500,
        }),
      )
      .catch(() =>
        Swal.fire({
          toast: true,
          icon: "error",
          title: "Copy failed",
          showConfirmButton: false,
          timer: 1500,
        }),
      );
  }

  document.getElementById("data-editor-copy").addEventListener("click", () => copyGeoJSON(false));
  document
    .getElementById("data-editor-copy-clean")
    .addEventListener("click", () => copyGeoJSON(true));

  document.getElementById("data-editor-apply").addEventListener("click", applyDataEditor);

  document.getElementById("data-editor-find").addEventListener("click", () => {
    const target = getEffectiveSelectedLayer();
    if (!target) {
      Swal.fire({
        toast: true,
        icon: "info",
        title: "No feature selected",
        showConfirmButton: false,
        timer: 1500,
      });
      return;
    }
    if (isDirty) {
      Swal.fire({
        toast: true,
        icon: "warning",
        title: "Apply or reset your edits first",
        showConfirmButton: false,
        timer: 2000,
      });
      return;
    }
    const allLayers = [...editableLayers.getLayers(), ...importedItems.getLayers()];
    const index = allLayers.indexOf(target);
    if (index === -1) {
      Swal.fire({
        toast: true,
        icon: "info",
        title: "Selected feature is not shown in the editor",
        showConfirmButton: false,
        timer: 2000,
      });
      return;
    }
    const content = cmEditor.getValue();
    let count = 0;
    let pos = 0;
    while (pos < content.length) {
      const found = content.indexOf('"type": "Feature"', pos);
      if (found === -1) return;
      if (count === index) {
        const lineInfo = cmEditor.getDoc().posFromIndex(found);
        const coords = cmEditor.charCoords(
          { line: Math.max(0, lineInfo.line - 1), ch: 0 },
          "local",
        );
        cmEditor.scrollTo(null, coords.top);
        cmEditor.setCursor({ line: lineInfo.line, ch: 0 });
        const handle = cmEditor.addLineClass(lineInfo.line, "background", "cm-find-highlight");
        setTimeout(() => cmEditor.removeLineClass(handle, "background", "cm-find-highlight"), 3000);
        return;
      }
      count++;
      pos = found + 1;
    }
  });

  tabBtn.addEventListener("click", () => {
    initCodeMirror();
    refreshDataEditor();
    // CodeMirror needs a refresh after becoming visible
    setTimeout(() => cmEditor.refresh(), 0);
  });

  // Tab is desktop-only — fall back to Contents if viewport shrinks to mobile while active
  window.matchMedia(`(max-width: ${BREAKPOINT_MOBILE}px)`).addEventListener("change", (e) => {
    if (e.matches && panel.classList.contains("active")) {
      document.getElementById("tab-btn-overview").click();
    }
  });

  let refreshTimer = null;
  const scheduleRefresh = () => {
    if (!panel.classList.contains("active")) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshDataEditor, 300);
  };

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.getElementById("overview-panel-list"), {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Color changes don't update the overview list DOM, so observe the color swatch directly
  const colorObserver = new MutationObserver(scheduleRefresh);
  colorObserver.observe(document.getElementById("info-panel-color-swatch"), {
    attributes: true,
    attributeFilter: ["style"],
  });
});
