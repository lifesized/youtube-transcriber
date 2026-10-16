"use strict";

const trayCopy = require("./tray-copy.js");

const UPDATER_COPY = trayCopy.UPDATER_COPY;

function downloadingLabel(percent) {
  return trayCopy.updaterDownloadingLabel(percent);
}

function updaterMenuItem(state) {
  if (!state || state.enabled !== true) {
    return { label: trayCopy.updaterCheckLabel(), enabled: false, action: "none" };
  }
  switch (state.status) {
    case "checking":
      return { label: trayCopy.updaterCheckingLabel(), enabled: false, action: "none" };
    case "up-to-date":
      return { label: trayCopy.updaterUpToDateLabel(), enabled: false, action: "none" };
    case "available":
      return {
        label: trayCopy.updaterAvailableLabel(state.version),
        enabled: true,
        action: "download",
      };
    case "downloading":
      return {
        label: downloadingLabel(state.percent),
        enabled: false,
        action: "none",
      };
    case "ready":
      return { label: trayCopy.updaterRestartLabel(), enabled: true, action: "restart" };
    default:
      return { label: trayCopy.updaterCheckLabel(), enabled: true, action: "check" };
  }
}

module.exports = { UPDATER_COPY, downloadingLabel, updaterMenuItem };
