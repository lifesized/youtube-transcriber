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

const TRY_AGAIN = "Try Again";
const RESTART = "Start Transcriber";
const MOVE_TO_APPLICATIONS = "Move to Applications and Reopen";
const RUNNING_IN_MENU_BAR = "Transcriber is running in the menu bar";
const OPEN_TRANSCRIBER = "Open Transcriber";
const OPEN_LIBRARY = "Open Library";
const ADVANCED = "Advanced";
const SHOW_DATA_IN_FINDER = "Show Data in Finder";
// DESIGN REVIEW: updater labels live in updater-menu.js (placeholders).

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
};
