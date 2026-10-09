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

function isBetaPrereleaseVersion(version) {
  const pre = String(version || "").split("-")[1] || "";
  return pre === "beta" || pre.startsWith("beta.");
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
  autoUpdater.channel = "beta";
  autoUpdater.allowDowngrade = false;
  autoUpdater.forceDevUpdateConfig = false;
  autoUpdater.setFeedURL(pinnedFeed());
  autoUpdater.isUpdateSupported = (updateInfo) =>
    isBetaPrereleaseVersion(updateInfo && updateInfo.version);
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
    beforeQuitHookTimeoutMs = BEFORE_QUIT_HOOK_TIMEOUT_MS,
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
  let installInFlight = false;

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

    autoUpdater = configureAutoUpdater(loaded);
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
};
