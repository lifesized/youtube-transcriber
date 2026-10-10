"use strict";

/**
 * electron-updater wrapper. The module is required only after the gate
 * passes so ad-hoc / dev / unsigned builds never initialize it and never
 * open a socket. Feed is pinned; env and Settings cannot change it.
 */

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const {
  evaluateUpdaterGate,
  readExpectedTeamId,
  pinnedFeed,
  UPDATE_FEED,
} = require("./updater-gate.js");
const { updaterMenuItem } = require("./updater-menu.js");
const trayCopy = require("./tray-copy.js");
const {
  UPDATE_CHANNEL,
  isBetaPrereleaseVersion,
  isUpdateSupported,
} = require("./update-feed.js");
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

const CODESIGN_BIN = "/usr/bin/codesign";

function spawnCodesign(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", () => resolve({ status: 1, stdout, stderr }));
    child.on("close", (status) => resolve({ status: status ?? 1, stdout, stderr }));
  });
}

function signatureFromCodesignResult(verify, detail) {
  if (!verify || verify.status !== 0) {
    return parseCodesignVerbose("code object is not signed at all");
  }
  return parseCodesignVerbose(`${(detail && detail.stderr) || ""}\n${(detail && detail.stdout) || ""}`);
}

function readDarwinSignature(bundlePath, run = spawnSync) {
  if (!bundlePath) {
    return parseCodesignVerbose("code object is not signed at all");
  }
  // Fail closed: verify the seal before trusting TeamIdentifier.
  const verify = run(CODESIGN_BIN, ["--verify", "--strict", bundlePath], {
    encoding: "utf8",
  });
  if (!verify || verify.status !== 0) {
    return parseCodesignVerbose("code object is not signed at all");
  }
  const result = run(CODESIGN_BIN, ["-dv", "--verbose=4", bundlePath], {
    encoding: "utf8",
  });
  return signatureFromCodesignResult(verify, result);
}

async function readDarwinSignatureAsync(bundlePath, runAsync = spawnCodesign) {
  if (!bundlePath) {
    return parseCodesignVerbose("code object is not signed at all");
  }
  const verify = await runAsync(CODESIGN_BIN, ["--verify", "--strict", bundlePath]);
  if (!verify || verify.status !== 0) {
    return parseCodesignVerbose("code object is not signed at all");
  }
  const result = await runAsync(CODESIGN_BIN, ["-dv", "--verbose=4", bundlePath]);
  return signatureFromCodesignResult(verify, result);
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
  // package inside app.asar. afterPack copies it into asar.unpacked;
  // CI asserts every UPDATER_MODULES entry is there and that
  // ELECTRON_RUN_AS_NODE can require electron-updater from the binary.
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

/**
 * electron-updater 6.8.9's `channel` setter sets allowDowngrade = true.
 * Set channel first, then pin allowDowngrade false. Beta clients only
 * follow the beta channel (reject a future plain vX.Y.Z).
 */
function configureAutoUpdater(autoUpdater) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = true;
  autoUpdater.channel = UPDATE_CHANNEL;
  autoUpdater.allowDowngrade = false;
  autoUpdater.forceDevUpdateConfig = false;
  autoUpdater.setFeedURL(pinnedFeed());
  autoUpdater.isUpdateSupported = (updateInfo) =>
    isUpdateSupported(updateInfo, require("os").release());
  return autoUpdater;
}

const BEFORE_QUIT_HOOK_TIMEOUT_MS = 5000;

async function runBeforeQuitHook(hook, timeoutMs, setTimeoutFn, clearTimeoutFn) {
  if (typeof hook !== "function") return;
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => hook()),
      new Promise((_, reject) => {
        timer = setTimeoutFn(() => {
          reject(new Error("onBeforeQuitAndInstall timed out"));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    console.warn("updater: before-quit hook failed:", error && error.message);
  } finally {
    if (timer != null) clearTimeoutFn(timer);
  }
}

async function stopServerThenInstall(serverManager, install) {
  if (serverManager && typeof serverManager.stop === "function") {
    try {
      await serverManager.stop();
    } catch (error) {
      console.warn("updater: server stop failed:", error && error.message);
    }
  }
  if (typeof install === "function") await install();
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
    onReadyToInstall,
    onInstallFailed,
    onNotify,
    currentVersion = "",
    beforeQuitHookTimeoutMs = BEFORE_QUIT_HOOK_TIMEOUT_MS,
    upToDateHoldMs = trayCopy.UPDATER_UP_TO_DATE_HOLD_MS,
    downloadPercentStep = trayCopy.UPDATER_DOWNLOAD_PERCENT_STEP,
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
  let version = "";
  let timers = [];
  let autoUpdater = null;
  let installInFlight = false;
  let userRequestedCheck = false;
  let upToDateTimer = null;
  let lastProgressBucket = -1;
  let readyNotified = false;

  const emit = () => {
    if (typeof onState === "function") {
      onState({ enabled: gate.enabled, status, percent, version });
    }
  };

  function notify(payload) {
    if (typeof onNotify === "function" && payload && payload.title) {
      onNotify(payload);
    }
  }

  function clearUpToDateTimer() {
    if (upToDateTimer != null) {
      clearTimeoutFn(upToDateTimer);
      upToDateTimer = null;
    }
  }

  function scheduleIdleAfterUpToDate() {
    clearUpToDateTimer();
    upToDateTimer = setTimeoutFn(() => {
      upToDateTimer = null;
      if (status === "up-to-date") {
        status = "idle";
        emit();
      }
    }, upToDateHoldMs);
    if (upToDateTimer && typeof upToDateTimer.unref === "function") {
      upToDateTimer.unref();
    }
  }

  const menu = () =>
    updaterMenuItem({ enabled: gate.enabled, status, percent, version });

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

    autoUpdater = configureAutoUpdater(loaded);
  } catch (error) {
    console.warn("updater: load failed:", error && error.message);
    return disabled("load-failed");
  }

  autoUpdater.on("checking-for-update", () => {
    clearUpToDateTimer();
    status = "checking";
    emit();
  });
  autoUpdater.on("update-not-available", (info) => {
    status = "up-to-date";
    version = (info && info.version) || currentVersion || version;
    emit();
    if (userRequestedCheck) {
      notify(trayCopy.updaterUpToDateNotification(currentVersion || version));
    }
    userRequestedCheck = false;
    scheduleIdleAfterUpToDate();
  });
  autoUpdater.on("update-available", (info) => {
    clearUpToDateTimer();
    status = "available";
    version = (info && info.version) || version;
    userRequestedCheck = false;
    emit();
  });
  autoUpdater.on("download-progress", (progress) => {
    const next = progress && Number.isFinite(progress.percent) ? progress.percent : 0;
    const step = Number.isFinite(downloadPercentStep) && downloadPercentStep > 0
      ? downloadPercentStep
      : trayCopy.UPDATER_DOWNLOAD_PERCENT_STEP;
    const bucket = Math.floor(next / step);
    percent = next;
    if (status !== "downloading") {
      status = "downloading";
      lastProgressBucket = bucket;
      emit();
      return;
    }
    if (bucket !== lastProgressBucket) {
      lastProgressBucket = bucket;
      emit();
    }
  });
  autoUpdater.on("update-downloaded", (info) => {
    status = "ready";
    percent = 100;
    version =
      (info && info.version) ||
      (info && info.updateInfo && info.updateInfo.version) ||
      version;
    emit();
    if (!readyNotified) {
      readyNotified = true;
      notify(trayCopy.updaterReadyNotification(version));
    }
  });
  autoUpdater.on("error", (error) => {
    console.warn("updater: error:", error && error.message);
    const wasChecking = status === "checking" || userRequestedCheck;
    userRequestedCheck = false;
    if (wasChecking) {
      notify(trayCopy.updaterErrorNotification());
    }
    status = "idle";
    emit();
  });

  function requestCheck() {
    if (!autoUpdater) return;
    autoUpdater.checkForUpdates().catch((error) => {
      console.warn("updater: check failed:", error && error.message);
    });
  }

  function checkForUpdates() {
    userRequestedCheck = true;
    requestCheck();
  }

  function downloadUpdate() {
    if (!autoUpdater) return;
    autoUpdater.downloadUpdate().catch((error) => {
      console.warn("updater: download failed:", error && error.message);
    });
  }

  async function quitAndInstall() {
    if (installInFlight) return;
    installInFlight = true;
    try {
      await runBeforeQuitHook(
        onBeforeQuitAndInstall,
        beforeQuitHookTimeoutMs,
        setTimeoutFn,
        clearTimeoutFn
      );
      await stopServerThenInstall(serverManager, async () => {
        if (typeof onReadyToInstall === "function") onReadyToInstall();
        if (autoUpdater) await autoUpdater.quitAndInstall();
      });
    } catch (error) {
      console.warn("updater: quitAndInstall failed:", error && error.message);
      if (typeof onInstallFailed === "function") onInstallFailed();
      installInFlight = false;
      if (serverManager && typeof serverManager.start === "function") {
        try {
          await serverManager.start();
        } catch (startError) {
          console.warn(
            "updater: server restart failed:",
            startError && startError.message
          );
        }
      }
    }
  }

  function startBackgroundChecks() {
    const initial = setTimeoutFn(() => {
      requestCheck();
    }, INITIAL_DELAY_MS);
    if (initial && typeof initial.unref === "function") initial.unref();
    const repeating = setIntervalFn(() => {
      requestCheck();
    }, INTERVAL_MS);
    if (repeating && typeof repeating.unref === "function") repeating.unref();
    timers = [initial, repeating];
  }

  function dispose() {
    clearUpToDateTimer();
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
  readDarwinSignatureAsync,
  CODESIGN_BIN,
  configureAutoUpdater,
  isBetaPrereleaseVersion,
  stopServerThenInstall,
  runBeforeQuitHook,
  BEFORE_QUIT_HOOK_TIMEOUT_MS,
  INITIAL_DELAY_MS,
  INTERVAL_MS,
  UPDATE_FEED,
  UPDATER_UP_TO_DATE_HOLD_MS: trayCopy.UPDATER_UP_TO_DATE_HOLD_MS,
  UPDATER_DOWNLOAD_PERCENT_STEP: trayCopy.UPDATER_DOWNLOAD_PERCENT_STEP,
};
