// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * Fetches the credits content from an HTML file and displays it in a SweetAlert modal.
 * @param {boolean} [isWelcome=false] - If true, shows as a first-visit welcome popup with
 *   a "Let's Go!" button. If false, shows as the standard credits popup with a "Close" button.
 */
async function showCreditsPopup(isWelcome = false) {
  try {
    const response = await fetch("/credits.html");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const creditsHtmlContent = await response.text();

    const swalContent = document.createElement("div");
    swalContent.innerHTML = creditsHtmlContent;

    const appNameEl = swalContent.querySelector("#credits-app-name");
    if (isWelcome) {
      appNameEl.innerHTML = `Welcome to ${APP_NAME}`;
    } else {
      appNameEl.textContent = APP_NAME;
    }

    const populateAttributionList = (placeholder, config) => {
      if (!placeholder) return;
      const seen = new Set();
      const frag = document.createDocumentFragment();
      config.forEach((item) => {
        if (!item.attribution || seen.has(item.attribution.url)) return;
        seen.add(item.attribution.url);
        const li = document.createElement("li");
        const label = item.creditLabel || item.label;
        li.innerHTML = `${label}: &copy; ${attrLinksHTML(item.attribution)}`;
        frag.appendChild(li);
      });
      placeholder.replaceWith(frag);
    };

    populateAttributionList(
      swalContent.querySelector("#basemap-credits-placeholder"),
      BASEMAP_CONFIG,
    );
    populateAttributionList(
      swalContent.querySelector("#overlay-credits-placeholder"),
      OVERLAY_CONFIG,
    );

    return Swal.fire({
      html: swalContent,
      confirmButtonText: isWelcome ? "Let's Go!" : "Close",
    });
  } catch (error) {
    console.error("Could not load credits.html:", error);
    return Swal.fire({
      title: "Error",
      text: "Could not load the credits information.",
    });
  }
}
