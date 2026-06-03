// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// OpenStreetMap Integration Module
// Handles OAuth 2.0 PKCE authentication and settings panel UI.

const OSM_AUTH_URL = "https://www.openstreetmap.org/oauth2/authorize";
const OSM_TOKEN_URL = "https://www.openstreetmap.org/oauth2/token";
const OSM_API_URL = "https://api.openstreetmap.org/api/0.6";
const OSM_REDIRECT_URI = `${window.location.origin}/osm-callback.html`;
const OSM_SCOPE = "read_prefs write_api";

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
  sessionStorage.setItem("osmState", state);

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
    const returnedState = localStorage.getItem("osmAuthState");

    if (code) {
      clearInterval(poll);
      localStorage.removeItem("osmAuthCode");
      localStorage.removeItem("osmAuthState");

      if (returnedState !== state) {
        Swal.fire({ title: "Authentication Failed", text: "State mismatch. Please try again." });
        return;
      }

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
    sessionStorage.removeItem("osmState");
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
