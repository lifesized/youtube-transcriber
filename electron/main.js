#!/usr/bin/env node
/**
 * Electron main process for Transcriber.
 * 
 * Features:
 * - Single-instance lock
 * - Menu-bar tray icon with status
 * - Next.js standalone server lifecycle management
 * - Power save blocker (keep server running)
 * - Native messaging host installation
 */

const { app, dialog, BrowserWindow, powerSaveBlocker, safeStorage, shell } = require("electron");
const path = require("path");
const config = require("./config.js");
const appLog = require("./app-log.js");
const ServerManager = require("./server-manager.js");
const TrayManager = require("./tray-manager.js");
const PairingBridge = require("./pairing-bridge.js");
const NativeHostInstaller = require("./native-host-installer.js");
const { SecretsStore, attachSecretsIpc } = require("./secrets-store.js");
const { createTuskManager } = require("./tusk/manager.js");
const { attachOpenExternalIpc } = require("./tusk/llm-links.js");
const { confirmTuskSensitiveChange } = require("./tusk/confirm.js");
const { checkIfTranslocated, shouldRepointNativeHost } = require("./utils.js");
const { launchedByNativeHost, shouldRevealOnLaunch } = require("../lib/launch-source.js");
const { createUpdater, readDarwinSignatureAsync } = require("./updater.js");
const { appBundleFromExecPath, parseCodesignVerbose } = require("./code-signature.js");

const IS_DEV = process.env.NODE_ENV === "development";
const PORT = config.port;
const APP_STATE_DIR = config.resolveAppStateDir();
const APP_LOG_DIR = config.resolveAppLogDir();

function pinAppPaths() {
  app.setPath("userData", APP_STATE_DIR);
  app.setPath("sessionData", APP_STATE_DIR);
  app.setPath("logs", APP_LOG_DIR);
  app.setPath("crashDumps", config.crashDumpsDir(APP_STATE_DIR));
  process.env.TRANSCRIBER_STATE_DIR = APP_STATE_DIR;
  process.env.TRANSCRIBER_LOG_DIR = APP_LOG_DIR;
}

pinAppPaths();
appLog.install();

let serverManager = null;
let trayManager = null;
let pairingBridge = null;
let secretsStore = null;
let tuskManager = null;
let updater = null;
let powerSaveId = null;
let pendingReveal = false;
let installingUpdate = false;

async function attachUpdaterAfterTray({ extraResources, serverManager }) {
  let signature;
  try {
    signature = await readDarwinSignatureAsync(
      appBundleFromExecPath(process.execPath) || process.execPath
    );
  } catch (error) {
    console.warn("updater: codesign failed:", error && error.message);
    signature = parseCodesignVerbose("code object is not signed at all");
  }
  updater = createUpdater({
    isPackaged: app.isPackaged,
    isDev: IS_DEV,
    resourcesPath: extraResources,
    execPath: process.execPath,
    signature,
    serverManager,
    onState: (state) => {
      if (trayManager) trayManager.setUpdaterState(state);
    },
    onBeforeQuitAndInstall: async () => {
      if (tuskManager) await tuskManager.stop();
    },
    onReadyToInstall: () => {
      installingUpdate = true;
    },
    onInstallFailed: async () => {
      installingUpdate = false;
      if (tuskManager) {
        try {
          await tuskManager.sync();
        } catch (error) {
          console.warn("updater: tusk restart failed:", error && error.message);
        }
      }
    },
  });
  if (trayManager) {
    trayManager.updater = updater;
    trayManager.setUpdaterState({
      enabled: updater.enabled,
      status: "idle",
      percent: 0,
    });
  }
  if (updater.enabled) {
    updater.startBackgroundChecks();
  }
}

function revealRunningApp(reason) {
  console.log(`${reason}: revealing tray`);
  if (trayManager) {
    trayManager.revealInMenuBar(reason);
    return;
  }
  pendingReveal = true;
}

// Single-instance lock. The handoff to the primary happens inside
// requestSingleInstanceLock() before it returns false.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log("Another instance is already running. Exiting after handoff.");
  app.quit();
  process.exit(0);
}

app.on("second-instance", (_event, argv) => {
  if (launchedByNativeHost(argv)) {
    console.log("second-instance from native host: no reveal");
    return;
  }
  // Return before popping the menu so the second process can exit the lock.
  setImmediate(() => revealRunningApp("second-instance"));
});

app.on("activate", () => {
  setImmediate(() => revealRunningApp("activate"));
});

// Set app name for menu bar. Re-pin paths so setName does not
// collide with the checkout's ~/Library/Application Support/Transcriber
// or ~/Library/Logs/Transcriber.
if (process.platform === "darwin") {
  app.setName("Transcriber");
}
pinAppPaths();

// Quit when all windows are closed (but we don't use windows, just tray)
app.on("window-all-closed", () => {
  // Don't quit — we're a menu-bar app with no windows
});

app.on("before-quit", async (event) => {
  if (installingUpdate) {
    return;
  }
  if ((tuskManager && tuskManager.getStatus().state !== "off") || (serverManager && serverManager.isRunning())) {
    event.preventDefault();
    if (tuskManager) await tuskManager.stop();
    if (serverManager && serverManager.isRunning()) await serverManager.stop();
    app.exit(0);
  }
});

app.whenReady().then(async () => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.hide();
  }
  console.log("Transcriber starting...");
  console.log("App path:", app.getAppPath());
  console.log("User data:", app.getPath("userData"));
  console.log("Is dev:", IS_DEV);
  
  // Determine paths. Packaged server lives in extraResources (outside asar)
  // because ELECTRON_RUN_AS_NODE cannot read asar archives.
  const appRoot = IS_DEV
    ? path.resolve(__dirname, "..")
    : path.join(process.resourcesPath, "standalone");
  
  const standaloneServer = IS_DEV
    ? null  // In dev, use npm run dev
    : path.join(appRoot, "server.js");
  
  const extraResources = IS_DEV
    ? path.join(path.resolve(__dirname, ".."), "electron", "resources")
    : process.resourcesPath;
  
  secretsStore = new SecretsStore({
    safeStorage,
  });

  // Initialize managers
  serverManager = new ServerManager({
    port: PORT,
    appRoot,
    standaloneServer,
    extraResources,
    isDev: IS_DEV,
  });

  const nativeHostInstaller = new NativeHostInstaller();
  pairingBridge = new PairingBridge({
    installer: nativeHostInstaller,
  });

  trayManager = new TrayManager({
    port: PORT,
    serverManager,
    isDev: IS_DEV,
    nativeHostInstaller,
    pairingBridge,
    updater: null,
  });

  // codesign --verify --strict is async and only after the tray exists
  // so a slow seal check cannot block the menu bar.
  void attachUpdaterAfterTray({ extraResources, serverManager });

  tuskManager = createTuskManager({
    store: secretsStore,
    onStatus: (next) => trayManager.setTuskStatus(next),
    confirmSensitiveChange: (info) =>
      confirmTuskSensitiveChange(
        {
          dialog,
          app,
          getParentWindow: () => {
            const focused = BrowserWindow.getFocusedWindow();
            if (focused && !focused.isDestroyed()) return focused;
            const open = BrowserWindow.getAllWindows().find((win) => win && !win.isDestroyed());
            return open || null;
          },
        },
        info
      ),
  });
  trayManager.setTuskStatus(tuskManager.getStatus());

  if (process.platform === "darwin") {
    const translocated = checkIfTranslocated(app.getAppPath());
    if (translocated) {
      console.warn("App is running from a translocated path!");
      trayManager.showWrongLocation();
      return;
    }
  }

  if (!IS_DEV) {
    try {
      if (nativeHostInstaller.listExtensionIds().length > 0) {
        const bundlePath =
          appBundleFromExecPath(process.execPath) || app.getAppPath();
        const recorded = nativeHostInstaller.readRecordedBundlePath();
        if (shouldRepointNativeHost(bundlePath, recorded)) {
          const result = await nativeHostInstaller.install();
          if (!result.success) {
            console.warn("native host first-launch install:", result.error);
          }
        } else {
          console.warn(
            "native host first-launch install: skipped (not /Applications or recorded install)"
          );
        }
      }
    } catch (error) {
      console.warn("native host first-launch install failed:", error && error.message);
    }
  }

  serverManager.on("spawned", (child) => {
    pairingBridge.attach(child);
    attachSecretsIpc(child, secretsStore, () => {
      void tuskManager.refreshLlmReady();
    });
    tuskManager.attachIpc(child);
    attachOpenExternalIpc(child, shell);
  });
  
  // Start power save blocker. isStarted() rejects null; id is null until first start.
  if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId);
  }
  powerSaveId = powerSaveBlocker.start("prevent-app-suspension");
  console.log("Power save blocker started:", powerSaveId);
  
  // Start server
  trayManager.showStarting();
  try {
    await serverManager.start();
    trayManager.showRunning();
  } catch (error) {
    console.error("Failed to start server:", error);
    const status = serverManager.getStatus().status;
    if (status === "port-conflict") {
      trayManager.showPortConflict();
    } else {
      trayManager.showError(error && error.message);
    }
  }

  try {
    await tuskManager.sync();
  } catch (error) {
    console.error("Failed to start Tusk:", error && error.message);
  }

  // Monitor server health
  serverManager.on("status-change", (status) => {
    console.log("Server status changed:", status);
    switch (status) {
      case "running":
        trayManager.showRunning();
        break;
      case "starting":
        trayManager.showStarting();
        break;
      case "error":
      case "stopped":
        trayManager.showStopped();
        break;
      case "port-conflict":
        trayManager.showPortConflict();
        break;
    }
  });

  // After the server is up: Notification + menu pop so a notch-clipped
  // icon still has visible feedback. popUpContextMenu does not return until
  // the menu closes, so it runs last and off the ready path.
  const openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin === true;
  const revealReason = pendingReveal ? "second-instance-queued" : "first-launch";
  const reveal = pendingReveal || shouldRevealOnLaunch({ openedAtLogin, argv: process.argv });
  pendingReveal = false;
  if (reveal) {
    setImmediate(() => trayManager.revealInMenuBar(revealReason));
  } else {
    console.log(
      `launch reveal skipped (openedAtLogin=${openedAtLogin} nativeHost=${launchedByNativeHost(process.argv)})`
    );
  }

  console.log("Transcriber ready");
}).catch((error) => {
  console.error("Uncaught Exception", error);
});

app.on("will-quit", () => {
  if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId);
  }
});
