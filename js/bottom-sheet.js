// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * Wires up the mobile bottom-sheet drag handle (tap or swipe) to open/close
 * the right panel container. This toggles the same #main-right-container
 * "hidden" class and #sidebar-toggle-btn state as the desktop sidebar
 * toggle button in top-right-buttons.js - two separate input affordances (touch
 * gesture vs. click) for the same panel, kept in separate files since they
 * live in different parts of the DOM and target different device contexts.
 */
function initBottomSheet() {
  const sheetHandle = document.getElementById("sheet-handle");
  if (!sheetHandle) return;

  const panelContainer = document.getElementById("main-right-container");
  const toggleButton = document.getElementById("sidebar-toggle-btn");

  const openSheet = () => {
    panelContainer.classList.remove("hidden");
    if (toggleButton) {
      toggleButton.classList.add("panels-visible");
      toggleButton.classList.remove("panels-hidden");
    }
  };

  const closeSheet = () => {
    panelContainer.classList.add("hidden");
    if (toggleButton) {
      toggleButton.classList.remove("panels-visible");
      toggleButton.classList.add("panels-hidden");
    }
  };

  sheetHandle.addEventListener("click", () => {
    if (panelContainer.classList.contains("hidden")) {
      openSheet();
    } else {
      closeSheet();
    }
  });

  let touchStartY = 0;
  const swipeThreshold = 50;

  sheetHandle.addEventListener(
    "touchstart",
    (e) => {
      touchStartY = e.changedTouches[0].clientY;
    },
    { passive: true },
  );

  sheetHandle.addEventListener("touchend", (e) => {
    const touchEndY = e.changedTouches[0].clientY;
    const deltaY = touchEndY - touchStartY;

    if (deltaY > swipeThreshold) {
      closeSheet();
    }

    if (deltaY < -swipeThreshold) {
      openSheet();
    }
  });
}
