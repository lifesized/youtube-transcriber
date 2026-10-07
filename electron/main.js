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

const { app, powerSaveBlocker } = require("electron");
const path = require("path");
const ServerManager = require("./server-manager.js");
const TrayManager = require("./tray-manager.js");
const { checkIfTranslocated } = require("./utils.js");

const IS_DEV = process.env.NODE_ENV === "development";
const PORT = 19720;

let serverManager = null;
let trayManager = null;
let powerSaveId = null;

// Single-instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log("Another instance is already running. Exiting.");
  app.quit();
  process.exit(0);
}

app.on("second-instance", () => {
  if (trayManager) {
    trayManager.showRunning();
  }
});

// Set app name for menu bar
if (process.platform === "darwin") {
  app.setName("Transcriber");
}

// Quit when all windows are closed (but we don't use windows, just tray)
app.on("window-all-closed", () => {
  // Don't quit — we're a menu-bar app with no windows
});

app.on("before-quit", async (event) => {
  if (serverManager && serverManager.isRunning()) {
    event.preventDefault();
    await serverManager.stop();
    app.exit(0);
  }
});

app.whenReady().then(async () => {
  console.log("Transcriber starting...");
  console.log("App path:", app.getAppPath());
  console.log("User data:", app.getPath("userData"));
  console.log("Is dev:", IS_DEV);
  
  // Check if app is translocated on macOS
  if (process.platform === "darwin") {
    const translocated = checkIfTranslocated(app.getAppPath());
    if (translocated) {
      console.warn("App is running from a translocated path!");
    }
  }
  
  // Determine paths
  const appRoot = IS_DEV
    ? path.resolve(__dirname, "..")
    : path.join(process.resourcesPath, "app");
  
  const standaloneServer = IS_DEV
    ? null  // In dev, use npm run dev
    : path.join(appRoot, ".next", "standalone", "server.js");
  
  const extraResources = IS_DEV
    ? path.join(appRoot, "electron", "resources")
    : process.resourcesPath;
  
  // Initialize managers
  serverManager = new ServerManager({
    port: PORT,
    appRoot,
    standaloneServer,
    extraResources,
    isDev: IS_DEV,
  });
  
  trayManager = new TrayManager({
    port: PORT,
    serverManager,
    isDev: IS_DEV,
  });
  
  // Start power save blocker
  if (powerSaveBlocker.isStarted(powerSaveId)) {
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
    trayManager.showError(error.message);
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
  
  console.log("Transcriber ready");
});

app.on("will-quit", () => {
  if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId);
  }
});
