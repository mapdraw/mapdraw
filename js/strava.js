// Copyright (C) 2025 Aron Sommer. See LICENSE file for full license details.

// Strava Integration Module
// This module handles the integration with Strava's API, including OAuth authentication,
// activity fetching, and exporting activities to various formats.

// Strava API Configuration
const redirectURI = `${window.location.origin}/strava-callback.html`;
const scope = "read,activity:read_all";
const tokenURL = "https://www.strava.com/oauth/token";
// TODO June 1 2027: change base URL to https://www.api-v3.strava.com (ERR_NAME_NOT_RESOLVED as of June 2026)
const activitiesURL = "https://www.strava.com/api/v3/athlete/activities";
const streamsURL = "https://www.strava.com/api/v3/activities";

// DOM Elements
let stravaPanelContent;

// Global variable to store the raw activities data from the API
let allFetchedActivities = [];

// Temporary storage for user-provided API keys (memory only, not persisted)
let tempUserClientId = "";
let tempUserClientSecret = "";

// Remember the last selected fetch period
let lastSelectedPeriod = "all";

// Track whether a fetch has been performed this session
let hasFetchedActivities = false;

// Core Authentication and Data Fetching

/**
 * Exchanges an authorization code for an access token using the provided credentials.
 * @param {string} code - The authorization code from Strava
 * @param {string} clientId - The Strava Client ID
 * @param {string} clientSecret - The Strava Client Secret
 * @returns {Promise<boolean>} True on success, false on failure
 */
async function getAccessToken(code, clientId, clientSecret) {
  try {
    const response = await fetch(tokenURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: "authorization_code",
      }),
    });

    const data = await response.json();

    if (!response.ok || data.errors) {
      let errorMessage = data.message || "An unknown authentication error occurred.";
      if (String(errorMessage).toLowerCase().includes("invalid client")) {
        errorMessage = "Authentication failed: Invalid Client ID or Secret provided.";
      }
      throw new Error(errorMessage);
    }

    if (data.access_token) {
      sessionStorage.setItem("strava_access_token", data.access_token);
      sessionStorage.setItem("strava_refresh_token", data.refresh_token);
      sessionStorage.setItem("strava_expires_at", data.expires_at);
      return true;
    } else {
      throw new Error("Access token was not received from Strava.");
    }
  } catch (error) {
    console.error("Error getting Strava access token:", error);
    Swal.fire({
      title: "Authentication Failed",
      html: `Please check your API keys and try again.<br>Error: ${error.message}`,
    });
    return false;
  }
}

/**
 * Fetches activities from the Strava API, handling pagination and time-based filtering.
 */
async function fetchAllActivities() {
  const accessToken = sessionStorage.getItem("strava_access_token");
  if (!accessToken) {
    // Determine which UI to show if the token is missing.
    if (
      typeof stravaClientId !== "undefined" &&
      stravaClientId &&
      typeof stravaClientSecret !== "undefined" &&
      stravaClientSecret
    ) {
      showConnectUI();
    } else {
      renderUserKeysPanel();
    }
    return;
  }

  const fetchCountSelect = document.getElementById("strava-fetch-count");
  const period = fetchCountSelect ? fetchCountSelect.value : "all";
  lastSelectedPeriod = period;

  // Calculate the "after" timestamp based on the selected period
  let afterTimestamp = null;
  if (period !== "all") {
    const now = new Date();
    const dateOffsets = {
      "30d": [0, 30],
      "90d": [0, 90],
      "6m": [6, 0],
      "12m": [12, 0],
      "24m": [24, 0],
      "36m": [36, 0],
    };
    const offset = dateOffsets[period];
    if (offset) {
      const cutoff = new Date(now);
      if (offset[0] > 0) cutoff.setMonth(cutoff.getMonth() - offset[0]);
      if (offset[1] > 0) cutoff.setDate(cutoff.getDate() - offset[1]);
      afterTimestamp = Math.floor(cutoff.getTime() / 1000);
    }
  }

  const controlsDiv = document.getElementById("strava-controls");
  if (controlsDiv) controlsDiv.style.display = "none";

  const progressText = document.getElementById("strava-progress");
  if (progressText) {
    progressText.style.display = "block";
    progressText.innerText = "Starting activity fetch...";
  }

  let activitiesBuffer = [];
  let page = 1;
  const perPage = 100;
  let keepFetching = true;

  while (keepFetching) {
    try {
      let url = `${activitiesURL}?per_page=${perPage}&page=${page}`;
      if (afterTimestamp) {
        url += `&after=${afterTimestamp}`;
      }
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const activities = await response.json();
      if (activities.length > 0) {
        activitiesBuffer.push(...activities);
        if (progressText)
          progressText.innerText = `Fetched ${activitiesBuffer.length} activities...`;
        page++;
      } else {
        keepFetching = false;
      }
    } catch (error) {
      console.error("Error fetching Strava activities:", error);
      if (progressText) progressText.innerText = "Error fetching activities.";
      keepFetching = false;
    }
  }

  allFetchedActivities = activitiesBuffer;
  hasFetchedActivities = true;

  if (progressText)
    progressText.innerText = `Found ${activitiesBuffer.length} total activities. Processing...`;
  displayActivitiesOnMap(activitiesBuffer);
}

// UI Rendering and Event Handling

/**
 * Displays the "Connect with Strava" button (for developer keys flow).
 */
function showConnectUI() {
  if (!stravaPanelContent) return;
  stravaPanelContent.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center;">
      <p>To see your activities on the map:</p>
      <button id="strava-connect-btn" class="strava-button-link" style="border: none; background: transparent; padding: 0; cursor: pointer;">
        <img src="/img/btn_strava_connect_with_orange.svg" alt="Connect with Strava" />
      </button>
      <p style="font-size: var(--font-size-12); color: var(--text-color); margin-top: 5px;">
        By connecting, you agree to the ${APP_NAME}<br>
        <a href="/privacy.html" target="_blank" style="color: var(--link-color);">Privacy Policy</a>
      </p>
    </div>
  `;

  document.getElementById("strava-connect-btn").addEventListener("click", () => {
    stravaPanelContent.innerHTML = "<p>Waiting for Strava authentication in the new tab...</p>";
    const stravaAuthURL = `https://www.strava.com/oauth/authorize?client_id=${stravaClientId}&redirect_uri=${redirectURI}&response_type=code&scope=${scope}`;
    window.open(stravaAuthURL, "_blank");
    window.addEventListener("storage", handleStravaAuthReturn);
  });
}

/**
 * Renders the Strava panel for user-provided keys.
 * Shows either a single CTA button (not authenticated) or fetch controls (authenticated).
 */
function renderUserKeysPanel() {
  if (!stravaPanelContent) return;
  const accessToken = sessionStorage.getItem("strava_access_token");

  if (accessToken) {
    // User is authenticated - show fetch controls
    stravaPanelContent.innerHTML = _getFetchControlsHTML(stravaActivitiesLayer.getLayers().length);
    _addFetchControlsListeners(fetchAllActivities, stravaActivitiesLayer.getLayers().length);
  } else {
    // No authentication - show single CTA button
    stravaPanelContent.innerHTML = `
      <div style="padding: 0; text-align: center;">
        <p style="margin-bottom: 10px;">To see your activities on the map:</p>
        <button id="strava-provide-keys-btn" class="strava-button-primary" style="width: 100%;">
          Provide your Strava API Keys
        </button>
      </div>
    `;
    document.getElementById("strava-provide-keys-btn").addEventListener("click", () => {
      tempUserClientId = "";
      tempUserClientSecret = "";
      showApiKeysModal();
    });
  }
}

/**
 * Shows a SweetAlert modal for entering Strava API keys.
 * Follows the WMS import dialog pattern.
 */
function showApiKeysModal() {
  function buildModalOptions() {
    return {
      title: "Provide your Strava API Keys",
      html: `
        <div style="text-align: left;">
          <p style="margin-bottom: 15px;">This application uses your personal Strava API credentials for performance and data control.</p>
          <p><strong>How to get your keys:</strong></p>
          <ol style="padding-left: 20px; margin-bottom: 15px;">
            <li>Go to your <a href="https://www.strava.com/settings/api" target="_blank" style="color: var(--highlight-color);">Strava API Settings</a>.</li>
            <li>Create a new app. For "Authorization Callback Domain", enter <strong id="strava-domain-copy" style="cursor: pointer; text-decoration: underline;" title="Click to copy">${APP_DOMAIN}&nbsp;<span class="copy-icon material-symbols">content_copy</span></strong>.</li>
            <li>Copy your <strong>Client ID</strong> and <strong>Client Secret</strong> and paste them below.</li>
          </ol>
          <p style="font-size: var(--font-size-12); color: var(--text-color); margin-bottom: 15px;"><strong>Security:</strong> Your keys are kept in memory for this session only and are not saved in your browser.</p>
          <input
            type="password"
            id="swal-strava-client-id"
            class="swal2-input swal-input-field"
            placeholder="Strava Client ID"
            autocomplete="off"
            value="${tempUserClientId}"
            style="margin-bottom: 10px;"
          />
          <input
            type="password"
            id="swal-strava-client-secret"
            class="swal2-input swal-input-field"
            placeholder="Strava Client Secret"
            autocomplete="off"
            value="${tempUserClientSecret}"
          />
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Connect",
      cancelButtonText: "Cancel",
      customClass: {
        confirmButton: "swal-confirm-button",
      },
      didOpen: () => {
        const confirmButton = Swal.getConfirmButton();
        const clientIdInput = document.getElementById("swal-strava-client-id");
        const clientSecretInput = document.getElementById("swal-strava-client-secret");

        // Update button state based on both inputs
        const updateButtonState = () => {
          const hasClientId = clientIdInput.value.trim().length > 0;
          const hasClientSecret = clientSecretInput.value.trim().length > 0;
          confirmButton.disabled = !(hasClientId && hasClientSecret);
        };

        // Disable button initially if inputs are empty
        updateButtonState();

        // Add input listeners
        clientIdInput.addEventListener("input", updateButtonState);
        clientSecretInput.addEventListener("input", updateButtonState);

        // Select all on focus
        clientIdInput.addEventListener("focus", () => clientIdInput.select());
        clientSecretInput.addEventListener("focus", () => clientSecretInput.select());

        // Copy-to-clipboard for domain (save inputs, toast, then re-open modal)
        document.getElementById("strava-domain-copy")?.addEventListener("click", (e) => {
          e.stopPropagation();
          // Preserve current input values before the modal is destroyed by the toast
          tempUserClientId = clientIdInput.value.trim();
          tempUserClientSecret = clientSecretInput.value.trim();
          copyToClipboard(APP_DOMAIN).then(() => {
            Swal.fire({
              toast: true,
              icon: "success",
              title: "Domain Copied!",
              showConfirmButton: false,
              timer: 1500,
            }).then(() => {
              Swal.fire(buildModalOptions());
            });
          });
        });
      },
      preConfirm: () => {
        const clientId = document.getElementById("swal-strava-client-id").value.trim();
        const clientSecret = document.getElementById("swal-strava-client-secret").value.trim();

        // Store keys in memory for reconnection
        tempUserClientId = clientId;
        tempUserClientSecret = clientSecret;
        sessionStorage.removeItem("strava_access_token");

        // Open Strava OAuth in new tab
        const userAuthUrl = `https://www.strava.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectURI}&response_type=code&scope=${scope}`;
        window.open(userAuthUrl, "_blank");

        // Listen for auth callback
        window.addEventListener("storage", handleStravaAuthReturnForUserKeys);

        // Return false to keep modal open
        return false;
      },
    };
  }

  Swal.fire(buildModalOptions());
}

/**
 * Generates HTML for the Strava fetch/export controls.
 * @param {number} activityCount - The number of currently loaded activities
 * @returns {string} The HTML string for the controls
 */
function _getFetchControlsHTML(activityCount = 0) {
  let message;
  if (activityCount > 0) {
    message = `${activityCount} activities loaded.`;
  } else if (hasFetchedActivities) {
    message = "No activities found for the selected period.";
  } else {
    message = "Select a time period and fetch your activities.";
  }
  return `
      <p>Successfully connected to Strava.<br>${message}</p>
      <div id="strava-controls" style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; width: 100%;">
        <select id="strava-fetch-count" class="strava-button-secondary" style="flex: 2; min-width: 120px;">
          <option value="30d"${lastSelectedPeriod === "30d" ? " selected" : ""}>Last 30 Days</option>
          <option value="90d"${lastSelectedPeriod === "90d" ? " selected" : ""}>Last 90 Days</option>
          <option value="6m"${lastSelectedPeriod === "6m" ? " selected" : ""}>Last 6 Months</option>
          <option value="12m"${lastSelectedPeriod === "12m" ? " selected" : ""}>Last 12 Months</option>
          <option value="24m"${lastSelectedPeriod === "24m" ? " selected" : ""}>Last 24 Months</option>
          <option value="36m"${lastSelectedPeriod === "36m" ? " selected" : ""}>Last 36 Months</option>
          <option value="all"${lastSelectedPeriod === "all" ? " selected" : ""}>All Time</option>
        </select>
        <button id="fetch-strava-btn" class="strava-button-primary" style="flex: 1; min-width: 80px;">Fetch</button>
        <div class="strava-export-buttons">
          <button id="export-strava-geojson-btn" class="strava-button-secondary" style="flex: 1; min-width: 80px;">Export GeoJSON</button>
          <button id="export-strava-json-btn" class="strava-button-secondary" style="flex: 1; min-width: 80px;">Export Raw JSON</button>
        </div>
      </div>
      <p id="strava-progress" style="display: none;"></p>
    `;
}

/**
 * Attaches event listeners to the fetch/export controls.
 * @param {function} fetchFunction - The fetch function to call
 * @param {number} activityCount - The number of loaded activities
 */
function _addFetchControlsListeners(fetchFunction, activityCount = 0) {
  document.getElementById("fetch-strava-btn").addEventListener("click", fetchFunction);
  const exportGeoJsonBtn = document.getElementById("export-strava-geojson-btn");
  exportGeoJsonBtn.addEventListener("click", () => exportGeoJson({ mode: "strava" }));
  exportGeoJsonBtn.disabled = activityCount === 0;
  const exportJsonBtn = document.getElementById("export-strava-json-btn");
  exportJsonBtn.addEventListener("click", exportStravaActivitiesAsJson);
  exportJsonBtn.disabled = activityCount === 0;
}

/**
 * Displays the UI for fetching/exporting (developer keys flow).
 * @param {number} [activityCount=0] - The number of loaded activities
 */
function showFetchUI(activityCount = 0) {
  if (!stravaPanelContent) return;
  stravaPanelContent.innerHTML = _getFetchControlsHTML(activityCount);
  _addFetchControlsListeners(fetchAllActivities, activityCount);
}

// Authentication Callback Handlers

/**
 * Handles the auth callback from the new tab (developer keys flow).
 * @param {StorageEvent} event - The storage event
 */
async function handleStravaAuthReturn(event) {
  if (event.key === "stravaAuthCode" && event.newValue) {
    const authCode = event.newValue;
    localStorage.removeItem("stravaAuthCode");
    window.removeEventListener("storage", handleStravaAuthReturn);
    stravaPanelContent.innerHTML = "<p>Authenticating...</p>";

    const success = await getAccessToken(authCode, stravaClientId, stravaClientSecret);
    if (success) {
      showFetchUI();
    } else {
      showConnectUI();
    }
  } else if (event.key === "stravaAuthError") {
    console.error("Strava authentication error:", event.newValue);
    localStorage.removeItem("stravaAuthError");
    window.removeEventListener("storage", handleStravaAuthReturn);
    showConnectUI();
  }
}

/**
 * Handles the auth callback from the new tab (user keys flow).
 * @param {StorageEvent} event - The storage event
 */
async function handleStravaAuthReturnForUserKeys(event) {
  if (event.key === "stravaAuthCode" && event.newValue) {
    const authCode = event.newValue;
    localStorage.removeItem("stravaAuthCode");
    window.removeEventListener("storage", handleStravaAuthReturnForUserKeys);
    Swal.close();

    await getAccessToken(authCode, tempUserClientId, tempUserClientSecret);
    renderUserKeysPanel();
  } else if (event.key === "stravaAuthError") {
    console.error("Strava authentication error:", event.newValue);
    localStorage.removeItem("stravaAuthError");
    window.removeEventListener("storage", handleStravaAuthReturnForUserKeys);
  }
}

// Data Processing, Export, and Initialization

/**
 * Processes activities and adds them to the map layer.
 * @param {Array} activities - The array of activity objects from Strava
 */
function displayActivitiesOnMap(activities) {
  if (!stravaActivitiesLayer) return;
  stravaActivitiesLayer.clearLayers();
  let processedCount = 0;

  activities.forEach((activity) => {
    if (activity.map && activity.map.summary_polyline) {
      try {
        const latlngs = L.Polyline.fromEncoded(activity.map.summary_polyline).getLatLngs();
        const polyline = L.polyline(latlngs, { ...STYLE_CONFIG.path.default, color: STRAVA_COLOR });
        polyline.feature = {
          properties: {
            ...activity,
            totalDistance: activity.distance,
            color: STRAVA_COLOR,
            pathType: "strava",
            stravaId: activity.id,
          },
        };
        polyline.pathType = "strava";
        polyline.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          selectItem(polyline);
        });
        stravaActivitiesLayer.addLayer(polyline);
        processedCount++;
      } catch (e) {
        console.warn("Could not decode polyline for activity:", activity.id, e);
      }
    }
  });

  if (stravaActivitiesLayer.getLayers().length > 0) {
    map.fitBounds(stravaActivitiesLayer.getBounds());
  }

  if (!map.hasLayer(stravaActivitiesLayer)) {
    map.addLayer(stravaActivitiesLayer);
  }
  updateOverviewList();
  updateDrawControlStates();

  // Determine which UI needs updating
  if (
    typeof stravaClientId !== "undefined" &&
    stravaClientId &&
    typeof stravaClientSecret !== "undefined" &&
    stravaClientSecret
  ) {
    showFetchUI(processedCount);
  } else {
    renderUserKeysPanel();
  }

  const progressText = document.getElementById("strava-progress");
  if (progressText) {
    progressText.innerText = `Displayed ${processedCount} activities on the map.`;
  }
}

/**
 * Creates and triggers a download for a JSON file of all loaded Strava activities.
 */
async function exportStravaActivitiesAsJson() {
  if (allFetchedActivities.length === 0) {
    return Swal.fire({
      title: "No Activities Loaded",
      text: "Please fetch your activities before exporting.",
    });
  }
  const jsonContent = JSON.stringify(allFetchedActivities, null, 2);
  downloadFile(generateTimestampedFilename("Strava_Export", "json"), jsonContent);
}

/**
 * Triggers a browser download of the original GPX file from Strava's website.
 * @param {string} activityId - The ID of the Strava activity
 * @param {string} activityName - The name of the activity, used for the filename
 */
function downloadOriginalStravaGpx(activityId, activityName) {
  const link = document.createElement("a");
  link.href = `https://www.strava.com/activities/${activityId}/export_gpx`;
  link.download = `${activityName.replace(/[^a-z0-9]/gi, "_")}.gpx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Initializes the Strava integration.
 */
function initializeStrava() {
  stravaPanelContent = document.getElementById("strava-panel-content");
  sessionStorage.removeItem("strava_access_token");

  // This logic checks if developer keys are provided in secrets.js.
  if (
    typeof stravaClientId !== "undefined" &&
    stravaClientId &&
    typeof stravaClientSecret !== "undefined" &&
    stravaClientSecret
  ) {
    showConnectUI();
  } else {
    renderUserKeysPanel();
  }
}
