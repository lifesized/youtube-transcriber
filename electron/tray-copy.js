"use strict";

/**
 * Human tray strings from Design spec §8.5. {port} is filled by the caller
 * (19721 on this branch). Never put a raw exception in these labels.
 */

function runningStatus(port, supportsSublabel) {
  if (supportsSublabel) {
    return { label: "Transcriber is running", sublabel: `App library · Port ${port}` };
  }
  return { label: `Transcriber is running · App library · Port ${port}` };
}

function startingStatus() {
  return { label: "Starting…" };
}

function portInUseStatus(port, holder, supportsSublabel) {
  const label = `Port ${port} is in use`;
  const sub =
    holder && holder.process && holder.pid
      ? `Used by ${holder.process} (PID ${holder.pid}). Quit it, then try again.`
      : "Quit the app using it, then try again.";
  if (supportsSublabel) return { label, sublabel: sub };
  return { label: `${label}. ${sub}` };
}

function stoppedStatus() {
  return { label: "Transcriber is stopped" };
}

function wrongLocationStatus() {
  return { label: "Move Transcriber to Applications, then reopen it." };
}

function tooltipFor(state, port) {
  switch (state) {
    case "running":
      return "Transcriber — Running";
    case "starting":
      return "Transcriber — Starting…";
    case "port-conflict":
      return `Transcriber — Port ${port} is in use`;
    case "wrong-location":
      return "Transcriber — Move to Applications";
    default:
      return "Transcriber — Stopped";
  }
}

function servingLabel(port) {
  return `App library · Port ${port}`;
}

function trayImageName(state) {
  switch (state) {
    case "running":
      return "trayTemplate.png";
    case "starting":
      return "trayStartingTemplate.png";
    default:
      return "trayAlertTemplate.png";
  }
}

function tuskStatusLine(state, workspace) {
  if (state === "connected") {
    return workspace ? `Tusk: connected to ${workspace}` : "Tusk: connected";
  }
  if (state === "error") return "Tusk: error";
  return "Tusk: off";
}

const AI_KEY_MISSING = "AI key missing";

const TRY_AGAIN = "Try Again";
const RESTART = "Start Transcriber";
const MOVE_TO_APPLICATIONS = "Move to Applications and Reopen";
const RUNNING_IN_MENU_BAR = "Transcriber is running in the menu bar";
const OPEN_TRANSCRIBER = "Open Transcriber";
const OPEN_LIBRARY = "Open Library";
const ADVANCED = "Advanced";
const SHOW_DATA_IN_FINDER = "Show Data in Finder";

const UPDATER_COPY = Object.freeze({
  check: "Check for Updates…",
  checking: "Checking for Updates…",
  upToDate: "Transcriber Is Up to Date",
  available: "Update Available — {version}",
  downloading: "Downloading Update… {n}%",
  restart: "Restart to Update",
  notifyUpToDateTitle: "You're up to date",
  notifyUpToDateBody: "Transcriber {version} is the latest.",
  notifyReadyTitle: "Update ready",
  notifyReadyBody: "Restart Transcriber to finish updating to {version}.",
  notifyErrorTitle: "Couldn't check for updates",
  notifyErrorBody: "Check your connection and try again.",
});

const UPDATER_UP_TO_DATE_HOLD_MS = 5000;
const UPDATER_DOWNLOAD_PERCENT_STEP = 5;

function fillVersion(template, version) {
  return String(template).replace("{version}", String(version || "").trim());
}

function updaterCheckLabel() {
  return UPDATER_COPY.check;
}

function updaterCheckingLabel() {
  return UPDATER_COPY.checking;
}

function updaterUpToDateLabel() {
  return UPDATER_COPY.upToDate;
}

function updaterAvailableLabel(version) {
  const v = String(version || "").trim();
  return v ? fillVersion(UPDATER_COPY.available, v) : "Update Available —";
}

function updaterDownloadingLabel(percent) {
  const n = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
  return UPDATER_COPY.downloading.replace("{n}", String(n));
}

function updaterRestartLabel() {
  return UPDATER_COPY.restart;
}

function updaterUpToDateNotification(version) {
  return {
    title: UPDATER_COPY.notifyUpToDateTitle,
    body: fillVersion(UPDATER_COPY.notifyUpToDateBody, version),
  };
}

function updaterReadyNotification(version) {
  return {
    title: UPDATER_COPY.notifyReadyTitle,
    body: fillVersion(UPDATER_COPY.notifyReadyBody, version),
  };
}

function updaterErrorNotification() {
  return {
    title: UPDATER_COPY.notifyErrorTitle,
    body: UPDATER_COPY.notifyErrorBody,
  };
}

module.exports = {
  runningStatus,
  startingStatus,
  portInUseStatus,
  stoppedStatus,
  wrongLocationStatus,
  tooltipFor,
  servingLabel,
  trayImageName,
  TRY_AGAIN,
  RESTART,
  MOVE_TO_APPLICATIONS,
  RUNNING_IN_MENU_BAR,
  OPEN_TRANSCRIBER,
  OPEN_LIBRARY,
  ADVANCED,
  SHOW_DATA_IN_FINDER,
  tuskStatusLine,
  AI_KEY_MISSING,
  UPDATER_COPY,
  UPDATER_UP_TO_DATE_HOLD_MS,
  UPDATER_DOWNLOAD_PERCENT_STEP,
  updaterCheckLabel,
  updaterCheckingLabel,
  updaterUpToDateLabel,
  updaterAvailableLabel,
  updaterDownloadingLabel,
  updaterRestartLabel,
  updaterUpToDateNotification,
  updaterReadyNotification,
  updaterErrorNotification,
};
