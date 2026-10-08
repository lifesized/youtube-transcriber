"use strict";

/**
 * DESIGN REVIEW: placeholder updater copy. Labels match the requested
 * states only. Do not treat these as final product strings.
 */

const UPDATER_COPY = Object.freeze({
  check: "Check for Updates…",
  checking: "Checking for Updates…",
  upToDate: "Up to Date",
  available: "Update Available…",
  restart: "Restart to Update",
});

function downloadingLabel(percent) {
  const n = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
  return `Downloading Update ${n}%`;
}

function updaterMenuItem(state) {
  if (!state || state.enabled !== true) {
    return { label: UPDATER_COPY.check, enabled: false, action: "none" };
  }
  switch (state.status) {
    case "checking":
      return { label: UPDATER_COPY.checking, enabled: false, action: "none" };
    case "up-to-date":
      return { label: UPDATER_COPY.upToDate, enabled: true, action: "check" };
    case "available":
      return { label: UPDATER_COPY.available, enabled: true, action: "download" };
    case "downloading":
      return {
        label: downloadingLabel(state.percent),
        enabled: false,
        action: "none",
      };
    case "ready":
      return { label: UPDATER_COPY.restart, enabled: true, action: "restart" };
    default:
      return { label: UPDATER_COPY.check, enabled: true, action: "check" };
  }
}

module.exports = { UPDATER_COPY, downloadingLabel, updaterMenuItem };
