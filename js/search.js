// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

/**
 * Search Modal
 *
 * Provides a consistent search interface for all search inputs in the application.
 * Opens a SweetAlert2 modal containing the search input and results.
 * Reuses the existing setupAutocomplete() function for all search logic.
 */

/**
 * Shows a search modal
 * @param {string} title - Modal title (e.g., "Search Location", "Set Start Point")
 * @param {string} placeholder - Input placeholder text
 * @param {string} currentValue - Current value of the input (if any)
 * @param {function(L.LatLng, string): void} callback - Callback when location is selected
 * @returns {Promise<void>}
 */
async function showSearchModal(title, placeholder, currentValue, callback) {
  await Swal.fire({
    html: `
      <div>
        <p style="font-size: var(--font-size-12); color: var(--text-color); margin: 0 0 8px 0; text-align: center;">
          Basel or 47.559722, 7.588611 or N 47° 33' 35" E 7° 35' 19"
        </p>
        <input
          type="text"
          id="search-modal-input"
          class="swal2-input swal-input-field"
          placeholder="${title}"
          value="${escHtml(currentValue || "")}"
          autocomplete="off"
        />
        <div id="search-modal-suggestions" class="search-modal-suggestions"></div>
      </div>
    `,
    confirmButtonText: "Close",
    customClass: {
      popup: "search-modal",
      htmlContainer: "search-modal-container",
    },
    didOpen: () => {
      const inputEl = document.getElementById("search-modal-input");
      const suggestionsEl = document.getElementById("search-modal-suggestions");

      // Auto-focus and select existing text
      inputEl.focus();
      if (currentValue) {
        inputEl.select();
      }

      // Set up autocomplete with a wrapper callback that closes the modal
      setupAutocomplete(inputEl, suggestionsEl, (latLng, label) => {
        // Close modal and trigger the original callback
        Swal.close();
        callback(latLng, label);
      });

      // Handle Enter key on empty results (close modal)
      inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const hasSuggestions =
            suggestionsEl.style.display === "block" &&
            suggestionsEl.querySelectorAll(".autocomplete-suggestion-item").length > 0;
          if (!hasSuggestions && inputEl.value.trim() === "") {
            Swal.close();
          }
        }
      });
    },
    willClose: () => {
      // Clean up any event listeners if needed
      // setupAutocomplete already handles its own cleanup via blur event
    },
  });

  // If user clicks Cancel or clicks outside, result.isDismissed will be true
  // We don't need to do anything in that case
}

/**
 * Attaches click handler to an input element to show the unified search modal
 * @param {HTMLInputElement} inputEl - The input element to enhance
 * @param {string} modalTitle - Title for the search modal
 * @param {function(L.LatLng, string): void} callback - Callback when location is selected
 */
function attachSearchModalToInput(inputEl, modalTitle, callback) {
  // Prevent duplicate attachment - guard against multiple calls on the same input
  if (inputEl._searchModalAttached) {
    return;
  }
  inputEl._searchModalAttached = true;

  // Store original placeholder for offline state handling
  const originalPlaceholder = inputEl.placeholder;

  // Make input look clickable
  inputEl.style.cursor = "pointer";
  inputEl.setAttribute("title", "Search");

  // Make input readonly to prevent keyboard from appearing and cursor from blinking
  inputEl.setAttribute("readonly", "true");

  // Track if modal is currently open to avoid double-opening
  let modalOpen = false;

  // Helper function to open the modal
  const openModal = () => {
    if (modalOpen) return;

    // Don't open modal if input is disabled (offline)
    if (inputEl.disabled) return;

    modalOpen = true;

    // Immediately blur the input to prevent keyboard from staying open on mobile
    inputEl.blur();

    // For buttons, always start with empty value. For inputs, use current value.
    const currentValue = inputEl.tagName === "BUTTON" ? "" : inputEl.value;

    showSearchModal(modalTitle, originalPlaceholder, currentValue, (latLng, label) => {
      // Update input display (only works for input elements, not buttons)
      if (inputEl.tagName !== "BUTTON") {
        inputEl.value = label;
      }
      // Trigger the original callback
      callback(latLng, label);
    }).finally(() => {
      modalOpen = false;
    });
  };

  // Click handler to open modal
  inputEl.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openModal();
  });

  // Intercept keyboard input to open modal instead of typing
  inputEl.addEventListener("keydown", (e) => {
    // Allow Tab, Shift, Ctrl, Alt, Meta for navigation
    // Allow Escape to close anything
    const allowedKeys = ["Tab", "Shift", "Control", "Alt", "Meta", "Escape"];
    if (allowedKeys.includes(e.key)) {
      return;
    }

    // For any other key, open the modal instead
    e.preventDefault();
    openModal();
  });

  // Prevent focus to eliminate cursor/keyboard flicker on mobile
  inputEl.addEventListener("focus", (e) => {
    e.preventDefault();
    inputEl.blur();
  });
}
