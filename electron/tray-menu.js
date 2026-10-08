"use strict";

/**
 * The tray menu as a plain Menu.buildFromTemplate() array. No Electron
 * require, so tests can check the order, labels and enabled states.
 */

const trayCopy = require("./tray-copy.js");

function transcriberUrl(port) {
  return `http://127.0.0.1:${port}`;
}

function libraryUrl(port) {
  return `${transcriberUrl(port)}/?layout=list`;
}

function statusItem(state) {
  const { status, port, supportsSublabel, portHolder } = state;
  switch (status) {
    case "running":
      return trayCopy.runningStatus(port, supportsSublabel);
    case "starting":
      return trayCopy.startingStatus();
    case "port-conflict":
      return trayCopy.portInUseStatus(port, portHolder, supportsSublabel);
    case "wrong-location":
      return trayCopy.wrongLocationStatus();
    default: {
      const { label } = trayCopy.stoppedStatus();
      const serving = trayCopy.servingLabel(port);
      return supportsSublabel ? { label, sublabel: serving } : { label: `${label} · ${serving}` };
    }
  }
}

function recoveryItem(status, actions) {
  switch (status) {
    case "port-conflict":
      return { label: trayCopy.TRY_AGAIN, click: actions.tryAgain };
    case "error":
    case "stopped":
      return { label: trayCopy.RESTART, click: actions.start };
    case "wrong-location":
      return { label: trayCopy.MOVE_TO_APPLICATIONS, click: actions.moveToApplications };
    default:
      return null;
  }
}

function buildTrayMenuTemplate(state, actions) {
  const running = state.status === "running";
  const wrongLocation = state.status === "wrong-location";
  const status = statusItem(state);

  const template = [{ label: status.label, sublabel: status.sublabel, enabled: false }];
  const recovery = recoveryItem(state.status, actions);
  if (recovery) template.push(recovery);

  const advanced = [{ label: trayCopy.SHOW_DATA_IN_FINDER, click: actions.showDataInFinder }];
  if (state.showImport) {
    advanced.push({
      label: "Import Existing Library…",
      enabled: running,
      click: actions.importLibrary,
    });
  }

  // Open Transcriber opens / (the saved layout, which may be tiles), so it
  // never lands on the list URL that Open Library opens. Keep both.
  template.push(
    { type: "separator" },
    { label: trayCopy.OPEN_TRANSCRIBER, enabled: running, click: actions.openTranscriber },
    { label: trayCopy.OPEN_LIBRARY, enabled: running, click: actions.openLibrary },
    { type: "separator" },
    { label: "Connect Browser Extension…", enabled: running, click: actions.openPairingWindow },
    { label: "Paired Extensions…", enabled: running, click: actions.showPairedExtensions },
    {
      label: "Reinstall Browser Connection",
      enabled: !wrongLocation,
      click: actions.reinstallNativeHost,
    },
    { type: "separator" },
    { label: trayCopy.ADVANCED, submenu: advanced },
    {
      label: "Start at Login",
      type: "checkbox",
      checked: !!state.openAtLogin,
      enabled: !wrongLocation,
      click: actions.toggleLoginItem,
    },
    { label: "Quit Transcriber", accelerator: "Command+Q", click: actions.quit }
  );
  return template;
}

module.exports = { buildTrayMenuTemplate, transcriberUrl, libraryUrl };
