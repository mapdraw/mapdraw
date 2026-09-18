// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * Wires up the "Install App" link to prompt the deferred PWA install flow.
 */
function initPwaInstall() {
  const installLink = document.getElementById("install-pwa-link");
  let installPrompt = null;

  // Chrome fires this when the app can be installed; keep the event so the
  // Install link can open its dialog.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    installLink.style.display = "inline";
  });
  installLink.addEventListener("click", (e) => {
    e.preventDefault();
    installLink.style.display = "none";
    installPrompt.prompt();
    installPrompt = null;
  });
  window.addEventListener("appinstalled", () => {
    installLink.style.display = "none";
    installPrompt = null;
  });
}
