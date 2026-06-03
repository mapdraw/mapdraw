// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// OpenStreetMap Integration Module
// Handles OAuth 2.0 PKCE authentication and settings panel UI.

const OSM_TEST_MODE = true; // Switch to false for production

const OSM_BASE = OSM_TEST_MODE
  ? "https://master.apis.dev.openstreetmap.org"
  : "https://www.openstreetmap.org";
const OSM_AUTH_URL = `${OSM_BASE}/oauth2/authorize`;
const OSM_TOKEN_URL = `${OSM_BASE}/oauth2/token`;
const OSM_API_URL = OSM_TEST_MODE
  ? "https://master.apis.dev.openstreetmap.org/api/0.6"
  : "https://api.openstreetmap.org/api/0.6";
const OSM_REDIRECT_URI = `${window.location.origin}/osm-callback.html`;
const OSM_SCOPE = "read_prefs write_api";

const OSM_CONTRIBUTE_CATEGORIES = [
  { id: "bench", name: "Bench", icon: "chair", tags: { amenity: "bench" } },
  { id: "waste_basket", name: "Waste Basket", icon: "delete", tags: { amenity: "waste_basket" } },
  {
    id: "drinking_water",
    name: "Drinking Water",
    icon: "water_drop",
    tags: { amenity: "drinking_water" },
  },
  {
    id: "picnic_table",
    name: "Picnic Table",
    icon: "deck",
    tags: { leisure: "picnic_table" },
  },
  { id: "toilets", name: "Toilets", icon: "wc", tags: { amenity: "toilets" } },
  { id: "bbq", name: "Barbecue", icon: "outdoor_grill", tags: { amenity: "bbq" } },
  { id: "shelter", name: "Shelter", icon: "cabin", tags: { amenity: "shelter" } },
  {
    id: "bicycle_parking",
    name: "Bicycle Parking",
    icon: "directions_bike",
    tags: { amenity: "bicycle_parking" },
  },
  { id: "viewpoint", name: "Viewpoint", icon: "landscape", tags: { tourism: "viewpoint" } },
];

async function osmGeneratePKCE() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const codeVerifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return { codeVerifier, codeChallenge };
}

async function osmSignIn() {
  if (typeof osmClientId === "undefined" || !osmClientId) {
    Swal.fire({
      title: "OSM not configured",
      text: "Set osmClientId in secrets.js to enable OpenStreetMap sign-in.",
    });
    return;
  }

  const { codeVerifier, codeChallenge } = await osmGeneratePKCE();
  const state = crypto.randomUUID();

  sessionStorage.setItem("osmCodeVerifier", codeVerifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: osmClientId,
    redirect_uri: OSM_REDIRECT_URI,
    scope: OSM_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  window.open(`${OSM_AUTH_URL}?${params}`, "_blank");

  const poll = setInterval(async () => {
    const code = localStorage.getItem("osmAuthCode");

    if (code) {
      clearInterval(poll);
      localStorage.removeItem("osmAuthCode");

      const success = await osmExchangeCode(code);
      if (success) {
        await osmUpdateSettingsUI();
      }
    }
  }, 500);

  setTimeout(() => clearInterval(poll), 5 * 60 * 1000);
}

async function osmExchangeCode(code) {
  const codeVerifier = sessionStorage.getItem("osmCodeVerifier");
  if (!codeVerifier) {
    Swal.fire({
      title: "Authentication Failed",
      text: "Code verifier not found. Please try again.",
    });
    return false;
  }

  try {
    const tokenParams = {
      grant_type: "authorization_code",
      code,
      redirect_uri: OSM_REDIRECT_URI,
      client_id: osmClientId,
      code_verifier: codeVerifier,
    };
    if (typeof osmClientSecret !== "undefined" && osmClientSecret) {
      tokenParams.client_secret = osmClientSecret;
    }

    const response = await fetch(OSM_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(tokenParams),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error_description || data.error || "Token exchange failed");
    }

    localStorage.setItem("osmAccessToken", data.access_token);
    sessionStorage.removeItem("osmCodeVerifier");
    return true;
  } catch (error) {
    console.error("OSM token exchange error:", error);
    Swal.fire({ title: "Authentication Failed", html: `Error: ${error.message}` });
    return false;
  }
}

async function osmFetchUser() {
  const token = localStorage.getItem("osmAccessToken");
  if (!token) return null;

  try {
    const response = await fetch(`${OSM_API_URL}/user/details.json`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 401) {
      localStorage.removeItem("osmAccessToken");
      return null;
    }

    if (!response.ok) return null;

    const data = await response.json();
    return data.user || null;
  } catch {
    return null;
  }
}

function osmSignOut() {
  localStorage.removeItem("osmAccessToken");
  osmUpdateSettingsUI();
}

async function osmUpdateSettingsUI() {
  const signInBtn = document.getElementById("osm-sign-in-btn");
  const signOutBtn = document.getElementById("osm-sign-out-btn");
  const usernameEl = document.getElementById("osm-username");

  if (!signInBtn) return;

  const token = localStorage.getItem("osmAccessToken");

  if (token) {
    const user = await osmFetchUser();
    if (user) {
      signInBtn.style.display = "none";
      usernameEl.textContent = user.display_name;
      usernameEl.style.display = "";
      signOutBtn.style.display = "";
      return;
    }
  }

  signInBtn.style.display = "";
  usernameEl.style.display = "none";
  signOutBtn.style.display = "none";
}

function osmRenderCategories(filter = "") {
  return OSM_CONTRIBUTE_CATEGORIES.filter(
    (cat) => !filter || cat.name.toLowerCase().includes(filter.toLowerCase()),
  )
    .map(
      (cat) => `
    <button class="poi-category-btn osm-contribute-btn" data-id="${cat.id}">
      <span class="material-symbols" style="font-size: 20px;">${cat.icon}</span>
      <span>${cat.name}</span>
    </button>`,
    )
    .join("");
}

function osmAttachCategoryHandlers(grid, latlng) {
  grid.querySelectorAll(".osm-contribute-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const cat = OSM_CONTRIBUTE_CATEGORIES.find((c) => c.id === btn.dataset.id);
      if (!cat) return;
      Swal.close();
      try {
        const nodeId = await osmSubmitNode(latlng, cat.tags);
        Swal.fire({
          toast: true,
          icon: "success",
          title: "Submitted to OpenStreetMap",
          html: `<a href="${OSM_BASE}/node/${nodeId}" target="_blank">${cat.name} #${nodeId}</a>`,
          showConfirmButton: false,
          timer: 4000,
        });
      } catch (error) {
        Swal.fire({ title: "Submission Failed", html: error.message });
      }
    });
  });
}

async function osmShowContributePicker(latlng) {
  await Swal.fire({
    html: `
      <div style="text-align: left;">
        <p style="font-size: var(--font-size-12); color: var(--text-color); margin: 0 0 12px 0; text-align: center;">
          Add to OpenStreetMap
        </p>
        <input
          id="osm-contribute-search"
          type="text"
          placeholder="Search"
          class="osm-contribute-search"
          style="width: 100%; box-sizing: border-box; margin-bottom: 12px; padding: 8px; border: 1px solid var(--border-color); border-radius: var(--border-radius); background: var(--background-color); color: var(--text-color); font-size: var(--font-size-14);"
        />
        <div class="poi-category-grid" id="osm-contribute-grid">
          ${osmRenderCategories()}
        </div>
      </div>
    `,
    confirmButtonText: "Cancel",
    customClass: { popup: "poi-finder-modal" },
    didOpen: () => {
      const grid = document.getElementById("osm-contribute-grid");
      const search = document.getElementById("osm-contribute-search");
      osmAttachCategoryHandlers(grid, latlng);
      search.addEventListener("input", () => {
        grid.innerHTML = osmRenderCategories(search.value);
        osmAttachCategoryHandlers(grid, latlng);
      });
    },
  });
}

function osmIsSignedIn() {
  return !!localStorage.getItem("osmAccessToken");
}

async function osmSubmitNode(latlng, tags) {
  const token = localStorage.getItem("osmAccessToken");
  if (!token) return;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "text/xml",
  };

  const tagComment = Object.entries(tags)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  try {
    // Create changeset
    const changesetXml = `<osm><changeset><tag k="created_by" v="MapDraw"/><tag k="comment" v="Add ${tagComment}"/></changeset></osm>`;
    const changesetRes = await fetch(`${OSM_API_URL}/changeset/create`, {
      method: "PUT",
      headers,
      body: changesetXml,
    });
    if (!changesetRes.ok) throw new Error(`Failed to create changeset: ${changesetRes.status}`);
    const changesetId = await changesetRes.text();

    // Create node
    const tagsXml = Object.entries(tags)
      .map(([k, v]) => `<tag k="${k}" v="${v}"/>`)
      .join("");
    const nodeXml = `<osm><node lat="${latlng.lat}" lon="${latlng.lng}" changeset="${changesetId}">${tagsXml}</node></osm>`;
    const nodeRes = await fetch(`${OSM_API_URL}/node/create`, {
      method: "PUT",
      headers,
      body: nodeXml,
    });
    if (!nodeRes.ok) throw new Error(`Failed to create node: ${nodeRes.status}`);
    const nodeId = await nodeRes.text();

    // Close changeset
    await fetch(`${OSM_API_URL}/changeset/${changesetId}/close`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });

    return nodeId.trim();
  } catch (error) {
    console.error("OSM submit error:", error);
    throw error;
  }
}

function initializeOSM(settingsPanel) {
  const osmContainer = L.DomUtil.create(
    "div",
    "settings-control-item osm-profile-item",
    settingsPanel,
  );

  const osmRow = L.DomUtil.create("div", "osm-profile-row", osmContainer);

  const osmLabel = L.DomUtil.create("label", "", osmRow);
  osmLabel.innerText = "OpenStreetMap Profile";

  const signInBtn = L.DomUtil.create("button", "osm-auth-btn", osmRow);
  signInBtn.id = "osm-sign-in-btn";
  signInBtn.innerText = "Sign in";

  const signOutBtn = L.DomUtil.create("button", "osm-auth-btn", osmRow);
  signOutBtn.id = "osm-sign-out-btn";
  signOutBtn.innerText = "Sign out";
  signOutBtn.style.display = "none";

  const usernameEl = L.DomUtil.create("span", "osm-username", osmContainer);
  usernameEl.id = "osm-username";
  usernameEl.style.display = "none";

  L.DomUtil.create("hr", "osm-separator", osmContainer);

  L.DomEvent.on(signInBtn, "click", osmSignIn);
  L.DomEvent.on(signOutBtn, "click", osmSignOut);
  L.DomEvent.on(osmContainer, "dblclick mousedown wheel", L.DomEvent.stopPropagation);

  osmUpdateSettingsUI();
}
