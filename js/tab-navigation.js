// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * Wires up the panel tab buttons (Overview/Routing/Strava/Data/Settings) and
 * the routing help icon, whose enabled state and click behavior both track
 * whether the Routing tab is currently active.
 */
function initTabNavigation() {
  const tabButtons = document.querySelectorAll(".tab-button");
  const tabPanels = document.querySelectorAll(".tab-panel");
  const routingInfoIcon = document.getElementById("routing-info-icon");

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      tabButtons.forEach((btn) => btn.classList.remove("active"));
      tabPanels.forEach((panel) => panel.classList.remove("active"));

      button.classList.add("active");

      const targetPanelId = button.getAttribute("data-target");
      const targetPanel = document.getElementById(targetPanelId);
      if (targetPanel) {
        targetPanel.classList.add("active");
      }

      if (targetPanelId === "overview-panel") {
        // The panel was display:none until the classList.add("active") above, so the
        // virtualized list (ui-handlers.js) had no real viewport height to render
        // against - render now that it actually has one.
        renderOverviewWindow();

        const selectedForOverview = getEffectiveSelectedLayer();
        if (selectedForOverview) {
          if (window.expandCategoryForItem) {
            window.expandCategoryForItem(selectedForOverview);
          }
          scrollOverviewToLayer(selectedForOverview);
        }
      }

      if (document.getElementById("tab-btn-routing").classList.contains("active")) {
        routingInfoIcon.classList.remove("disabled");
      } else {
        routingInfoIcon.classList.add("disabled");
      }
    });
  });

  if (routingInfoIcon) {
    if (!document.getElementById("tab-btn-routing").classList.contains("active")) {
      routingInfoIcon.classList.add("disabled");
    }

    L.DomEvent.on(routingInfoIcon, "click", (e) => {
      const routingTabButton = document.getElementById("tab-btn-routing");

      if (routingTabButton.classList.contains("active")) {
        L.DomEvent.stop(e);
        Swal.fire({
          title: "Routing Help",
          html: `
<p style="text-align: left; margin: 0 0 18px 0">
  <strong>Managing Waypoints:</strong> The <strong>Start</strong>, <strong>Via</strong>, and
  <strong>End</strong> markers can be managed with your mouse or finger.
</p>
<p style="text-align: left"><strong>To Move:</strong> Drag the marker to a new position.</p>
<p style="text-align: left; margin: 0 0 18px 0">
  <strong>To Remove:</strong> Long-press or right-click the marker.
</p>
<p style="text-align: left">
  <strong>Adding Extra Via Points: </strong>You can add extra stops by <strong>long-pressing or right-clicking</strong> anywhere on the route line.
</p>
<p style="text-align: left; margin: 18px 0 0 0">
  <strong>Draw Mode:</strong> Use the <span class="material-symbols" style="font-size: 1em; vertical-align: middle">draw</span> button to trace a route step by step. First click sets the start, second sets the end, and each click after that extends the route. <strong>To finish, click the last marker, press Escape, or click the button again.</strong>
</p>
`,
          confirmButtonText: "Got it!",
        });
      }
    });
  }
}
