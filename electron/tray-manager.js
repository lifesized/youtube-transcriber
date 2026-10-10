/**
 * Manages the system tray icon and menu.
 *
 * Menu items (template in tray-menu.js):
 * - Status line (human sentences from Design spec §8.5)
 * - Open Transcriber / Open Library (open in browser)
 * - Connect Browser Extension… (2-minute pairing window)
 * - Paired Extensions… (list + remove, rotates local API token)
 * - Reinstall Browser Connection
 * - Advanced ▸ Show Data in Finder, Import Existing Library… (backup-first merge from a .db)
 * - Start at Login (toggle)
 * - Quit
 */

const { app, Tray, Menu, shell, nativeImage, Notification, dialog, screen, powerMonitor } = require("electron");
const fs = require("fs");
const path = require("path");
const NativeHostInstaller = require("./native-host-installer.js");
const {
  killNativeHostProcesses,
  resolveHostScriptPath,
} = NativeHostInstaller;
const { PAIRING_WINDOW_MS } = require("../lib/native-host-pair.js");
const { rotateLocalApiToken, getStateDir } = require("../lib/local-api-token.js");
const { importLibrary, inspectSourceDatabase } = require("../lib/import-library.js");
const { resolveMigrationsDir } = require("../lib/apply-migrations.js");
const { findPortHolder } = require("./utils.js");
const config = require("./config.js");
const appLog = require("./app-log.js");
const productDefaults = require("./product-defaults.js");
const trayCopy = require("./tray-copy.js");
const { buildTrayMenuTemplate, transcriberUrl, libraryUrl } = require("./tray-menu.js");
const { openAllowedLlmKeyUrl } = require("./llm-links.js");
const trayPng = require("./tray-png.js");

// Strong module-level pin. V8 can otherwise GC the Tray and the
// NSStatusItem vanishes while the process stays alive on :19721.
let retainedTray = null;

async function unpairExtension(id, deps) {
  const rotate = deps.rotate || rotateLocalApiToken;
  deps.installer.removeExtensionId(id);
  await deps.installer.rewriteManifests();
  rotate();
  const hostScript = deps.hostScriptPath || resolveHostScriptPath();
  const kill = deps.killNativeHosts || killNativeHostProcesses;
  kill(hostScript);
  if (deps.serverManager && typeof deps.serverManager.restart === "function") {
    await deps.serverManager.restart();
  }
}

function supportsMenuSublabel() {
  if (process.platform !== "darwin") return false;
  const version =
    typeof process.getSystemVersion === "function"
      ? process.getSystemVersion()
      : "";
  const parts = String(version)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  return parts[0] > 14 || (parts[0] === 14 && parts[1] >= 4);
}

function checkoutLibraryDetected() {
  try {
    const db = config.checkoutStatePaths().db;
    const st = fs.statSync(db);
    return st.isFile() && st.size > 100;
  } catch {
    return false;
  }
}

class TrayManager {
  constructor(options) {
    this.port = options.port;
    this.serverManager = options.serverManager;
    this.isDev = options.isDev;
    this.nativeHostInstaller = options.nativeHostInstaller || new NativeHostInstaller();
    this.pairingBridge = options.pairingBridge || null;

    this.tray = null;
    this.status = "stopped";
    this.errorMessage = "";
    this.portHolder = null;
    this.hasLlmKey = true;
    this._restarting = false;
    this._healthTimer = null;
    this.updater = options.updater || null;
    this.updaterState = {
      enabled: !!(this.updater && this.updater.enabled),
      status: "idle",
      percent: 0,
    };

    this._createTray();
    this._updateMenu();
    this._startHealthWatch();
  }

  setHasLlmKey(hasKey) {
    this.hasLlmKey = Boolean(hasKey);
    this._updateMenu();
  }

  showRunning() {
    this.status = "running";
    this._updateMenu();
  }

  showStarting() {
    this.status = "starting";
    this._updateMenu();
  }

  showStopped() {
    this.status = "stopped";
    this._updateMenu();
  }

  showError(message) {
    this._logError(message);
    this.status = "error";
    this.errorMessage = message;
    this._updateMenu();
  }

  showPortConflict() {
    this.status = "port-conflict";
    this.portHolder = findPortHolder(this.port);
    this._updateMenu();
  }

  showWrongLocation() {
    this.status = "wrong-location";
    this._updateMenu();
  }

  // Private methods

  _logError(message) {
    appLog.error("Transcriber error:", String(message || "Unknown error"));
  }

  _loadTrayImage(filename) {
    const one = trayPng.readPngFile(filename, __dirname);
    const twoName = filename.replace(/\.png$/i, "@2x.png");
    const two = twoName === filename ? null : trayPng.readPngFile(twoName, __dirname);
    let icon = nativeImage.createEmpty();
    try {
      if (one) {
        const info = trayPng.inspectPng(one.buf);
        icon.addRepresentation({
          buffer: one.buf,
          width: info.width,
          height: info.height,
          scaleFactor: 1,
        });
      }
      if (two) {
        const info = trayPng.inspectPng(two.buf);
        icon.addRepresentation({
          buffer: two.buf,
          width: info.width,
          height: info.height,
          scaleFactor: 2,
        });
      }
    } catch (error) {
      console.warn(`tray addRepresentation failed for ${filename}:`, error && error.message);
    }
    if (!this._imageIsUsable(icon) && (one || two)) {
      const fallback = two || one;
      try {
        icon = nativeImage.createFromBuffer(fallback.buf);
      } catch (error) {
        console.warn(`tray createFromBuffer failed for ${filename}:`, error && error.message);
      }
    }
    if (!this._imageIsUsable(icon) && one) {
      try {
        icon = nativeImage.createFromPath(one.path);
      } catch (error) {
        console.warn(`tray createFromPath failed for ${one.path}:`, error && error.message);
      }
    }
    const size = icon.getSize ? icon.getSize() : { width: 0, height: 0 };
    let alpha = "?";
    try {
      if (one) alpha = String(trayPng.inspectPng(one.buf).nonzeroAlpha);
    } catch {
      alpha = "unreadable";
    }
    console.log(
      `tray image ${filename} empty=${icon.isEmpty()} size=${size.width}x${size.height} alpha=${alpha} path=${(one && one.path) || "(missing)"}`
    );
    if (this._imageIsUsable(icon)) {
      icon.setTemplateImage(true);
    }
    return icon;
  }

  _imageIsUsable(icon) {
    if (!icon || typeof icon.isEmpty !== "function" || icon.isEmpty()) return false;
    const size = icon.getSize ? icon.getSize() : { width: 0, height: 0 };
    return size.width > 0 && size.height > 0;
  }

  _applyTrayImage() {
    if (!this.tray) return;
    // Swap pixels on the existing Tray. Never destroy() here — that is
    // how a live status item disappears on starting→running.
    const icon = this._loadTrayImage(trayCopy.trayImageName(this.status));
    const usable = this._imageIsUsable(icon);
    if (usable) {
      this.tray.setImage(icon);
      if (typeof this.tray.setTitle === "function") this.tray.setTitle("");
    } else {
      console.warn("tray image unusable; falling back to title");
      try {
        this.tray.setImage(nativeImage.createEmpty());
      } catch {
        // keep existing image
      }
      if (typeof this.tray.setTitle === "function") this.tray.setTitle("Transcriber");
    }
    this.tray.setToolTip(trayCopy.tooltipFor(this.status, this.port));
  }

  isTrayHealthy() {
    if (!this.tray) return false;
    try {
      if (typeof this.tray.isDestroyed === "function" && this.tray.isDestroyed()) {
        return false;
      }
      // Zero bounds means the item is clipped (notch / crowded menu bar),
      // not that the Tray is dead. Recreating it would drop the only item.
      return true;
    } catch {
      return false;
    }
  }

  ensureTray(reason = "health-check") {
    if (this.isTrayHealthy()) {
      this._retainTray(this.tray);
      return this.tray;
    }
    console.log(`tray recreate: ${reason}`);
    try {
      if (this.tray && typeof this.tray.isDestroyed === "function" && !this.tray.isDestroyed()) {
        this.tray.destroy();
      }
    } catch {
      // Native item may already be gone (FBScene disconnect).
    }
    this.tray = null;
    retainedTray = null;
    this._createTray();
    this._updateMenu();
    return this.tray;
  }

  revealInMenuBar(reason = "second-instance") {
    this.ensureTray(reason);
    // Where the icon landed: a notch-hidden icon shows up here as off-screen.
    // CI also uses it to crop the tray-menu screenshot.
    const b = this.tray && typeof this.tray.getBounds === "function" ? this.tray.getBounds() : null;
    console.log(`tray reveal bounds: ${b ? [b.x, b.y, b.width, b.height].join(",") : "unknown"}`);
    // Notification only — a modal dialog would block the main process and
    // deadlock requestSingleInstanceLock (CI has no one to dismiss it).
    this._notify("Transcriber", trayCopy.RUNNING_IN_MENU_BAR, { modalFallback: false });
    // popUpContextMenu is synchronous on macOS until dismissed. Skip it in
    // GitHub Actions so the smoke test can kill the process (SIGTERM is
    // ignored while the menu is up). On a real Mac, still pop.
    if (process.env.GITHUB_ACTIONS) {
      console.log(`tray reveal: skip popUpContextMenu in CI (${reason})`);
      return;
    }
    try {
      if (this.tray && typeof this.tray.popUpContextMenu === "function") {
        this.tray.popUpContextMenu();
      }
    } catch (error) {
      console.warn("popUpContextMenu failed:", error && error.message);
    }
  }

  _startHealthWatch() {
    const tick = (reason) => {
      try {
        this.ensureTray(reason);
      } catch (error) {
        console.warn("tray health check failed:", error && error.message);
      }
    };
    if (this._healthTimer) clearInterval(this._healthTimer);
    this._healthTimer = setInterval(() => tick("interval"), 15000);
    if (this._healthTimer.unref) this._healthTimer.unref();
    try {
      if (screen && typeof screen.on === "function") {
        screen.on("display-added", () => tick("display-added"));
        screen.on("display-removed", () => tick("display-removed"));
        screen.on("display-metrics-changed", () => tick("display-metrics"));
      }
      if (powerMonitor && typeof powerMonitor.on === "function") {
        powerMonitor.on("resume", () => tick("resume"));
        powerMonitor.on("unlock-screen", () => tick("unlock-screen"));
      }
    } catch (error) {
      console.warn("tray health watch attach failed:", error && error.message);
    }
  }

  _retainTray(tray) {
    this.tray = tray;
    retainedTray = tray;
  }

  _createTray() {
    const icon = this._loadTrayImage("trayTemplate.png");
    const usable = this._imageIsUsable(icon);
    const tray = new Tray(usable ? icon : nativeImage.createEmpty());
    this._retainTray(tray);
    if (!usable && typeof tray.setTitle === "function") {
      console.warn("tray create: image empty or zero-size; using title fallback");
      tray.setTitle("Transcriber");
    }
    tray.setToolTip(trayCopy.tooltipFor(this.status, this.port));
    try {
      const bounds = tray.getBounds ? tray.getBounds() : null;
      console.log(
        `tray created bounds=${bounds ? `${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}` : "n/a"}`
      );
    } catch {
      console.log("tray created (bounds unavailable)");
    }

    if (process.platform !== "darwin") {
      tray.on("click", () => {
        this._openTranscriber();
      });
    }
  }

  _shouldShowImport() {
    if (!productDefaults.IMPORT_LIBRARY_ONLY_WHEN_DETECTED) return true;
    return checkoutLibraryDetected();
  }

  _updateMenu() {
    this._applyTrayImage();

    if (productDefaults.PORT_CONFLICT_OFFER_QUIT) {
      // Off for the friends beta. Flip the flag when James wants a quit action.
    }

    const template = buildTrayMenuTemplate(
      {
        status: this.status,
        port: this.port,
        supportsSublabel: supportsMenuSublabel(),
        portHolder: this.portHolder,
        openAtLogin: app.getLoginItemSettings().openAtLogin,
        showImport: this._shouldShowImport(),
        hasLlmKey: this.hasLlmKey,
        updater: this.updaterState,
      },
      {
        tryAgain: () => this._tryAgain(),
        openLlmKeyUrl: (url) => openAllowedLlmKeyUrl(shell, url),
        start: () => this._restartServer(),
        moveToApplications: () => this._moveToApplications(),
        openTranscriber: () => this._openTranscriber(),
        openLibrary: () => this._openLibrary(),
        openPairingWindow: () => this._openPairingWindow(),
        showPairedExtensions: () => this._showPairedExtensions(),
        reinstallNativeHost: () => this._reinstallNativeHost(),
        showDataInFinder: () => this._showDataInFinder(),
        importLibrary: () => this._importExistingLibrary(),
        toggleLoginItem: () => this._toggleLoginItem(),
        checkForUpdates: () => this._checkForUpdates(),
        downloadUpdate: () => this._downloadUpdate(),
        restartToUpdate: () => this._restartToUpdate(),
        quit: () => this._quit(),
      }
    );

    const menu = Menu.buildFromTemplate(template);
    this.tray.setContextMenu(menu);
  }

  async _tryAgain() {
    if (this._restarting) return;
    this._restarting = true;
    this.showStarting();
    try {
      await this.serverManager.start();
      this.showRunning();
    } catch (error) {
      const status = this.serverManager.getStatus().status;
      if (status === "port-conflict") this.showPortConflict();
      else this.showError(error && error.message);
    } finally {
      this._restarting = false;
    }
  }

  async _restartServer() {
    if (this._restarting) return;
    this._restarting = true;
    this.showStarting();
    try {
      await this.serverManager.restart();
      this.showRunning();
    } catch (error) {
      const status = this.serverManager.getStatus().status;
      if (status === "port-conflict") this.showPortConflict();
      else this.showError(error && error.message);
    } finally {
      this._restarting = false;
    }
  }

  _moveToApplications() {
    if (typeof app.moveToApplicationsFolder === "function") {
      app.moveToApplicationsFolder();
    }
  }

  async _showDataInFinder() {
    const error = await shell.openPath(config.appStatePaths().stateDir);
    if (error) console.warn("show data in finder failed:", error);
  }

  _openTranscriber() {
    shell.openExternal(transcriberUrl(this.port));
  }

  _openLibrary() {
    shell.openExternal(libraryUrl(this.port));
  }

  _openPairingWindow() {
    if (!this.pairingBridge) return;
    const openUntil = Date.now() + PAIRING_WINDOW_MS;
    this.pairingBridge.openWindow(openUntil);
    this._notify(
      "Connect browser extension",
      "Pairing is open for 2 minutes. Click the Transcriber extension in Chrome to connect."
    );
  }

  async _showPairedExtensions() {
    let ids;
    try {
      ids = this.nativeHostInstaller.listExtensionIds();
    } catch (error) {
      this._notify(
        "Paired extensions",
        error.message || "Could not read paired extensions."
      );
      return;
    }
    if (ids.length === 0) {
      await dialog.showMessageBox({
        type: "info",
        message: "Paired extensions",
        detail: "No extensions are paired.",
        buttons: ["OK"],
      });
      return;
    }
    const result = await dialog.showMessageBox({
      type: "question",
      message: "Paired extensions",
      detail:
        "Select an extension ID to remove it. That rewrites native-host manifests and rotates the local API token.",
      buttons: [...ids, "Close"],
      cancelId: ids.length,
      defaultId: ids.length,
    });
    if (result.response < 0 || result.response >= ids.length) return;
    await unpairExtension(ids[result.response], {
      installer: this.nativeHostInstaller,
      serverManager: this.serverManager,
    });
    this._notify(
      "Paired extensions",
      `Removed ${ids[result.response]}. Local API token rotated.`
    );
  }

  _toggleLoginItem() {
    const current = app.getLoginItemSettings();
    app.setLoginItemSettings({
      openAtLogin: !current.openAtLogin,
      openAsHidden: false,
    });
    this._updateMenu();
  }

  async _importExistingLibrary() {
    if (this._importing) return;
    this._importing = true;
    try {
      if (typeof app.focus === "function") {
        app.focus({ steal: true });
      }
      const picked = await dialog.showOpenDialog({
        title: "Import existing library",
        message: "Choose a Transcriber .db file",
        filters: [
          { name: "SQLite database", extensions: ["db"] },
          { name: "All files", extensions: ["*"] },
        ],
        properties: ["openFile"],
      });
      if (picked.canceled || !picked.filePaths || !picked.filePaths[0]) return;
      const sourcePath = picked.filePaths[0];
      let inspect;
      try {
        inspect = inspectSourceDatabase(sourcePath);
      } catch (error) {
        await dialog.showMessageBox({
          type: "error",
          message: "Could not open that file",
          detail: error.message || String(error),
          buttons: ["OK"],
        });
        return;
      }
      const confirm = await dialog.showMessageBox({
        type: "question",
        message: `Import ${inspect.count} transcripts? Your current library will be backed up first.`,
        buttons: ["Import", "Cancel"],
        defaultId: 0,
        cancelId: 1,
      });
      if (confirm.response !== 0) return;

      const destPath = path.join(getStateDir(), "transcriber.db");
      const backupsDir = path.join(getStateDir(), "backups");
      const packagedMigrations = process.resourcesPath
        ? path.join(process.resourcesPath, "standalone", "prisma", "migrations")
        : undefined;
      const result = await importLibrary({
        sourcePath,
        destPath,
        backupsDir,
        migrationsDir: resolveMigrationsDir(packagedMigrations),
      });
      if (this.serverManager && typeof this.serverManager.restart === "function") {
        try {
          await this.serverManager.restart();
        } catch (error) {
          console.warn("Restart after import failed:", error.message);
        }
      }
      await dialog.showMessageBox({
        type: "info",
        message: "Library imported",
        detail:
          `Imported ${result.imported}. Skipped ${result.skipped} already in your library. Failed ${result.failed}.\n\n` +
          `Backup: ${result.backupPath}`,
        buttons: ["OK"],
      });
    } catch (error) {
      console.error("Import existing library failed:", error);
      await dialog.showMessageBox({
        type: "error",
        message: "Import failed",
        detail: `${(error && error.message) || error}\n\nYour current library was not changed. The source file was not modified.`,
        buttons: ["OK"],
      });
    } finally {
      this._importing = false;
    }
  }

  async _reinstallNativeHost() {
    try {
      const result = await this.nativeHostInstaller.install();
      if (result.success) {
        this._notify(
          "Browser Connection",
          `Installed for ${result.browsers.join(", ")}`
        );
      } else {
        this._notify("Installation Failed", result.error || "Unknown error");
      }
    } catch (error) {
      console.error("Failed to reinstall native host:", error);
      this._notify("Installation Failed", error.message);
    }
  }

  _notify(title, body, options = {}) {
    // displayBalloon is Windows-only. Prefer a native Notification on macOS;
    // fall back to a modal if notifications are unsupported — unless the
    // caller is a reveal, which must never block the main process.
    if (typeof Notification === "function" && Notification.isSupported()) {
      try {
        new Notification({ title, body }).show();
        return;
      } catch (error) {
        console.warn("Notification.show failed:", error.message);
      }
    }
    if (process.platform === "win32" && this.tray) {
      this.tray.displayBalloon({ title, content: body });
      return;
    }
    if (options.modalFallback === false) {
      console.log(`notify (no modal): ${title}: ${body}`);
      return;
    }
    dialog
      .showMessageBox({
        type: "info",
        title,
        message: title,
        detail: body,
        buttons: ["OK"],
      })
      .catch(() => {});
  }

  setUpdaterState(state) {
    this.updaterState = {
      enabled: !!(state && state.enabled),
      status: (state && state.status) || "idle",
      percent: state && Number.isFinite(state.percent) ? state.percent : 0,
    };
    this._updateMenu();
  }

  _checkForUpdates() {
    if (this.updater && typeof this.updater.checkForUpdates === "function") {
      this.updater.checkForUpdates();
    }
  }

  _downloadUpdate() {
    if (this.updater && typeof this.updater.downloadUpdate === "function") {
      this.updater.downloadUpdate();
    }
  }

  async _restartToUpdate() {
    if (this.updater && typeof this.updater.quitAndInstall === "function") {
      await this.updater.quitAndInstall();
    }
  }

  _quit() {
    app.quit();
  }
}

module.exports = TrayManager;
module.exports.unpairExtension = unpairExtension;
module.exports.checkoutLibraryDetected = checkoutLibraryDetected;
