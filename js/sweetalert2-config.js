// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Animation configuration
const USE_CUSTOM_ANIMATION = false; // Set to false to use the default fade-from-top animation

// Custom animation (old bounce style from SweetAlert2 v11.23.0)
// This recreates the centered bounce/pop effect instead of the fade-from-top
if (USE_CUSTOM_ANIMATION) {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes swal2-show-custom {
      0% {
        transform: scale(0.7);
      }
      45% {
        transform: scale(1.05);
      }
      80% {
        transform: scale(0.95);
      }
      100% {
        transform: scale(1);
      }
    }

    @keyframes swal2-hide-custom {
      0% {
        transform: scale(1);
        opacity: 1;
      }
      100% {
        transform: scale(0.5);
        opacity: 0;
      }
    }

    .swal2-custom-animation.swal2-show {
      animation: swal2-show-custom 0.3s !important;
    }

    .swal2-custom-animation.swal2-hide {
      animation: swal2-hide-custom 0.15s forwards !important;
    }
  `;
  document.head.appendChild(style);
}

// Configure global SweetAlert2 defaults
const SwalOriginal = Swal.fire;
Swal.fire = function (options) {
  if (typeof options === "object") {
    // Auto-set iconColor based on icon type
    if (options.icon && !options.iconColor) {
      const iconColorMap = {
        error: "var(--swal-color-error)",
        warning: "var(--swal-color-warning)",
        success: "var(--swal-color-success)",
        info: "var(--swal-color-info)",
        question: "var(--swal-color-question)",
      };
      options.iconColor = iconColorMap[options.icon];
    }

    // Default position configuration
    if (!options.position) {
      // Default position for toasts
      if (options.toast) {
        options.position = "top";
      }
      // Default position for regular popups
      else {
        options.position = "top";
      }
    }

    // Apply custom animation if enabled
    if (USE_CUSTOM_ANIMATION) {
      options.customClass = options.customClass || {};
      const existingPopupClass = options.customClass.popup || "";
      if (!existingPopupClass.includes("swal2-custom-animation")) {
        options.customClass.popup = existingPopupClass
          ? `${existingPopupClass} swal2-custom-animation`
          : "swal2-custom-animation";
      }
    }
  }
  return SwalOriginal.call(this, options);
};
