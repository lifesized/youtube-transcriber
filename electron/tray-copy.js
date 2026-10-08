"use strict";

/**
 * Human tray strings from Design spec §8.5. {port} is filled by the caller
 * (19721 on this branch). Never put a raw exception in these labels.
 */

function runningStatus(port, supportsSublabel) {
  if (supportsSublabel) {
    return { label: "Transcriber is running", sublabel: `Port ${port}` };
  }
  return { label: `Running on port ${port}` };
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
  return { label: "Transcriber stopped unexpectedly" };
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

const TRY_AGAIN = "Try Again";
const RESTART = "Restart Transcriber";
const MOVE_TO_APPLICATIONS = "Move to Applications and Reopen";

module.exports = {
  runningStatus,
  startingStatus,
  portInUseStatus,
  stoppedStatus,
  wrongLocationStatus,
  tooltipFor,
  trayImageName,
  TRY_AGAIN,
  RESTART,
  MOVE_TO_APPLICATIONS,
};
