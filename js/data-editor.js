// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * GEOJSON EDITOR
 *
 * Desktop-only tab that shows all drawn and imported items - but not Strava activities
 * or the active route - as editable GeoJSON. Supports applying edited JSON back to the map.
 *
 * - Shows layerToPortableFeature() output verbatim: internal state lives on layer.internal, so
 *   what's displayed is byte-for-byte the same feature a GeoJSON export writes.
 * - Apply validates JSON, GeoJSON structure, and geometry before clearing the map, and
 *   turns every applied feature into a drawn item.
 * - isDirty blocks auto-refresh while the user has unsaved edits in the editor.
 * - Auto-refresh is explicit: anything that changes layer data calls scheduleDataEditorRefresh()
 *   directly (updateOverviewList() does; so do the two color-write spots in ui-handlers.js that
 *   bypass it). refreshDataEditor() itself doesn't check tab visibility - only
 *   scheduleDataEditorRefresh() does - so opening the tab and clicking Reset call
 *   refreshDataEditor() directly for an immediate, non-debounced result.
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
      const feature = layerToPortableFeature(layer);
      if (feature) features.push(feature);
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

let dataEditorRefreshTimer = null;

/**
 * Call after any layer-data change (name, color, geometry, add/remove, ...) to keep the
 * GeoJSON Editor tab in sync while it's open. Debounced so bursts of changes only trigger one
 * rebuild. No-ops while the tab is closed - opening it refreshes directly instead (see the
 * tabBtn click handler below).
 */
function scheduleDataEditorRefresh() {
  if (!document.getElementById("data-editor-panel")?.classList.contains("active")) return;
  clearTimeout(dataEditorRefreshTimer);
  dataEditorRefreshTimer = setTimeout(refreshDataEditor, 300);
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
      // The same explosion every file import does before calling importGeoJsonToMap(), which
      // doesn't do it itself. Leaflet builds one layer with nested latlngs from a pasted
      // MultiLineString/MultiPolygon, and an L.FeatureGroup from a MultiPoint/GeometryCollection
      // - neither survives layerToPortableFeature(): the first is cut down to a plain
      // LineString/Polygon keeping at most its first part, the second has no usable geometry and
      // is dropped from this editor and every export while still sitting on the map. Runs before
      // the check below so that validates what actually gets imported, and inside the try so a
      // malformed feature reports an error instead of throwing past the map-clearing step.
      parsed.features = parsed.features.flatMap((f) => explodeMultiGeometries(f));
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

  // Everything applied from the editor becomes a directly-editable drawn item: the
  // edited text is pure GeoJSON and carries no pathType to route features by.
  if (parsed.features?.length > 0) {
    const layerGroup = importGeoJsonToMap(parsed, "geojson");
    layerGroup.eachLayer((layer) => {
      layer.internal.pathType = "drawn";
      importedItems.removeLayer(layer);
      addAsDrawnItem(layer);
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
    // Direct call: tab's already open, and Reset should feel instant, not debounced.
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
    // Direct call: this listener runs before tab-navigation.js adds the panel's "active" class
    // (data-editor.js loads first), so scheduleDataEditorRefresh()'s check would wrongly skip it.
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
});
