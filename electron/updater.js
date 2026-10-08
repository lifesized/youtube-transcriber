"use strict";

/**
 * electron-updater wrapper. The module is required only after the gate
 * passes so ad-hoc / dev / unsigned builds never initialize it and never
 * open a socket. Feed is pinned; env and Settings cannot change it.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  evaluateUpdaterGate,
  readExpectedTeamId,
  pinnedFeed,
  UPDATE_FEED,
} = require("./updater-gate.js");
const { updaterMenuItem } = require("./updater-menu.js");
const {
  parseCodesignVerbose,
  appBundleFromExecPath,
} = require("./code-signature.js");

const INITIAL_DELAY_MS = 30 * 1000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

function loadSigningIdentity(resourcesPath) {
  const file = path.join(resourcesPath, "signing-identity.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readDarwinSignature(bundlePath, run = spawnSync) {
  if (!bundlePath) {
    return parseCodesignVerbose("code object is not signed at all");
  }
  const result = run("codesign", ["-dv", "--verbose=4", bundlePath], {
    encoding: "utf8",
  });
  return parseCodesignVerbose(`${result.stderr || ""}\n${result.stdout || ""}`);
}

function updaterModuleDir(resourcesPath) {
  if (resourcesPath) {
    return path.join(resourcesPath, "app.asar.unpacked", "node_modules");
  }
  return path.join(__dirname, "..", "node_modules");
}

function loadElectronUpdater(resourcesPath = process.resourcesPath) {
  const dir = updaterModuleDir(resourcesPath);
  if (!module.paths.includes(dir)) {
    module.paths.unshift(dir);
  }
  // Computed name so assert-packaged-requires does not demand this
  // package inside app.asar. afterPack copies it into asar.unpacked.
  const spec = ["electron", "updater"].join("-");
  return require(spec).autoUpdater;
}

function evaluateFromDisk(options) {
  const {
    isPackaged = false,
    isDev = false,
    resourcesPath = "",
    execPath = "",
    run = spawnSync,
    signature = undefined,
  } = options || {};
  const expectedTeamId = readExpectedTeamId(loadSigningIdentity(resourcesPath));
  const info =
    signature !== undefined
      ? signature
      : readDarwinSignature(appBundleFromExecPath(execPath) || execPath, run);
  return evaluateUpdaterGate({
    isPackaged,
    isDev,
    signature: info,
    expectedTeamId,
  });
}

async function stopServerThenInstall(serverManager, install) {
  if (serverManager && typeof serverManager.stop === "function") {
    try {
      await serverManager.stop();
    } catch (error) {
      console.warn("updater: server stop failed:", error && error.message);
    }
  }
  if (typeof install === "function") install();
}

function createUpdater(options) {
  const {
    isPackaged,
    isDev,
    resourcesPath,
    execPath,
    run,
    signature,
    serverManager,
    onState,
    onBeforeQuitAndInstall,
    loadAutoUpdater,
    setIntervalFn = setInterval,
    setTimeoutFn = setTimeout,
    clearIntervalFn = clearInterval,
    clearTimeoutFn = clearTimeout,
  } = options || {};

  const gate = evaluateFromDisk({
    isPackaged,
    isDev,
    resourcesPath,
    execPath,
    run,
    signature,
  });

  let status = "idle";
  let percent = 0;
  let timers = [];
  let autoUpdater = null;

  const emit = () => {
    if (typeof onState === "function") {
      onState({ enabled: gate.enabled, status, percent });
    }
  };

  const menu = () =>
    updaterMenuItem({ enabled: gate.enabled, status, percent });

  const disabled = (reason) => ({
    enabled: false,
    reason,
    feed: null,
    getMenuItem: () =>
      updaterMenuItem({ enabled: false, status: "idle", percent: 0 }),
    startBackgroundChecks() {},
    checkForUpdates() {},
    downloadUpdate() {},
    async quitAndInstall() {},
    dispose() {},
  });

  if (!gate.enabled) {
    return disabled(gate.reason);
  }

  try {
    const loaded =
      typeof loadAutoUpdater === "function"
        ? loadAutoUpdater()
        : loadElectronUpdater(resourcesPath);

    autoUpdater = loaded;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = true;
    autoUpdater.forceDevUpdateConfig = false;
    autoUpdater.setFeedURL(pinnedFeed());
  } catch (error) {
    console.warn("updater: load failed:", error && error.message);
    return disabled("load-failed");
  }

  autoUpdater.on("checking-for-update", () => {
    status = "checking";
    emit();
  });
  autoUpdater.on("update-not-available", () => {
    status = "up-to-date";
    emit();
  });
  autoUpdater.on("update-available", () => {
    status = "available";
    emit();
    autoUpdater.downloadUpdate().catch((error) => {
      console.warn("updater: download failed:", error && error.message);
      status = "available";
      emit();
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    status = "downloading";
    percent = progress && Number.isFinite(progress.percent) ? progress.percent : 0;
    emit();
  });
  autoUpdater.on("update-downloaded", () => {
    status = "ready";
    percent = 100;
    emit();
  });
  autoUpdater.on("error", (error) => {
    console.warn("updater: error:", error && error.message);
    if (status === "checking") status = "idle";
    emit();
  });

  function checkForUpdates() {
    if (!autoUpdater) return;
    autoUpdater.checkForUpdates().catch((error) => {
      console.warn("updater: check failed:", error && error.message);
    });
  }

  function downloadUpdate() {
    if (!autoUpdater) return;
    autoUpdater.downloadUpdate().catch((error) => {
      console.warn("updater: download failed:", error && error.message);
    });
  }

  async function quitAndInstall() {
    if (typeof onBeforeQuitAndInstall === "function") onBeforeQuitAndInstall();
    await stopServerThenInstall(serverManager, () => {
      if (autoUpdater) autoUpdater.quitAndInstall();
    });
  }

  function startBackgroundChecks() {
    const initial = setTimeoutFn(() => {
      checkForUpdates();
    }, INITIAL_DELAY_MS);
    if (initial && typeof initial.unref === "function") initial.unref();
    const repeating = setIntervalFn(() => {
      checkForUpdates();
    }, INTERVAL_MS);
    if (repeating && typeof repeating.unref === "function") repeating.unref();
    timers = [initial, repeating];
  }

  function dispose() {
    for (const timer of timers) {
      clearTimeoutFn(timer);
      clearIntervalFn(timer);
    }
    timers = [];
    autoUpdater = null;
  }

  emit();
  return {
    enabled: true,
    reason: gate.reason,
    feed: pinnedFeed(),
    getMenuItem: menu,
    startBackgroundChecks,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    dispose,
  };
}

module.exports = {
  createUpdater,
  evaluateFromDisk,
  loadSigningIdentity,
  loadElectronUpdater,
  readDarwinSignature,
  stopServerThenInstall,
  INITIAL_DELAY_MS,
  INTERVAL_MS,
  UPDATE_FEED,
};
