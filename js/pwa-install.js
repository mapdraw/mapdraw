// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * Wires up the "Install App" link to prompt the deferred PWA install flow.
 */
function initPwaInstall() {
  let deferredPrompt;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;

    const installLink = document.getElementById("install-pwa-link");
    if (installLink) {
      installLink.style.display = "inline";

      installLink.addEventListener("click", (clickEvent) => {
        clickEvent.preventDefault();
        installLink.style.display = "none";

        if (deferredPrompt) {
          deferredPrompt.prompt();

          deferredPrompt.userChoice.then(({ outcome }) => {
            console.log(`User response to the install prompt: ${outcome}`);
          });

          deferredPrompt = null;
        }
      });
    }
  });

  window.addEventListener("appinstalled", () => {
    const installLink = document.getElementById("install-pwa-link");
    if (installLink) {
      installLink.style.display = "none";
    }
    deferredPrompt = null;
    console.log("PWA was installed");
  });
}
