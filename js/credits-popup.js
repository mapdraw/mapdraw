// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * Opens the credits popup for any click on a .js-show-credits element
 * anywhere in the map container (delegated, so it works for elements added
 * after load too).
 */
function initCreditsTrigger() {
  map.getContainer().addEventListener("click", (e) => {
    const creditsTrigger = e.target.closest(".js-show-credits");

    if (creditsTrigger) {
      e.preventDefault();
      e.stopPropagation();
      showCreditsPopup();
    }
  });
}

let creditsHtmlPromise = null;

/**
 * Fetches credits.html, caching the in-flight promise so concurrent/later
 * callers (welcome popup, tab button, prefetch) share a single request.
 */
function getCreditsHtml() {
  if (!creditsHtmlPromise) {
    creditsHtmlPromise = fetch("/credits.html")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
      })
      .catch((error) => {
        creditsHtmlPromise = null;
        throw error;
      });
  }
  return creditsHtmlPromise;
}

/**
 * Warms the credits.html cache and its icon image ahead of time so opening
 * the popup later is instant.
 */
function prefetchCreditsHtml() {
  getCreditsHtml().catch(() => {});
  new Image().src = "/img/icon-1024x1024.png";
}

/**
 * Fetches the credits content from an HTML file and displays it in a SweetAlert modal.
 * @param {boolean} [isWelcome=false] - If true, shows as a first-visit welcome popup with
 *   a "Let's Go!" button. If false, shows as the standard credits popup with a "Close" button.
 */
async function showCreditsPopup(isWelcome = false) {
  try {
    const creditsHtmlContent = await getCreditsHtml();

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
