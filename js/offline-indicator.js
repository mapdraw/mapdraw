// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Offline Indicator
// Shows a banner and disables network-dependent buttons while offline.
(function () {
  const indicator = document.getElementById("offline-indicator");
  const toDisable = [
    document.getElementById("search-btn"),
    document.getElementById("poi-finder-btn"),
    document.getElementById("route-start"),
    document.getElementById("route-end"),
    document.getElementById("route-via"),
  ];

  const setOffline = () => {
    indicator.classList.add("visible");
    toDisable.forEach((el) => {
      if (el) el.disabled = true;
    });
    if (typeof Swal !== "undefined" && Swal.isVisible()) Swal.close();
  };

  const setOnline = () => {
    indicator.classList.remove("visible");
    toDisable.forEach((el) => {
      if (el) el.disabled = false;
    });
  };

  window.addEventListener("offline", setOffline);
  window.addEventListener("online", setOnline);
  if (!navigator.onLine) setOffline();
})();
