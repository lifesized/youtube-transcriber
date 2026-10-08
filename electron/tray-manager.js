/**
 * Manages the system tray icon and menu.
 * 
 * Menu items:
 * - Status line (Running / Starting / Error)
 * - Open Transcriber (opens in browser)
 * - Start at Login (toggle)
 * - Connect browser extension… (2-minute pairing window)
 * - Paired extensions… (list + remove, rotates local API token)
 * - Reinstall browser connection (P1)
 * - Import existing library… (backup-first merge from a .db)
 * - Quit
 */

const { app, Tray, Menu, shell, nativeImage, Notification, dialog } = require("electron");
const path = require("path");
const NativeHostInstaller = require("./native-host-installer.js");
const { PAIRING_WINDOW_MS } = require("../lib/native-host-pair.js");
const { rotateLocalApiToken, getStateDir } = require("../lib/local-api-token.js");
const { importLibrary, inspectSourceDatabase } = require("../lib/import-library.js");
const { resolveMigrationsDir } = require("../lib/apply-migrations.js");

async function unpairExtension(id, deps) {
  const rotate = deps.rotate || rotateLocalApiToken;
  deps.installer.removeExtensionId(id);
  await deps.installer.rewriteManifests();
  rotate();
  if (deps.serverManager && typeof deps.serverManager.restart === "function") {
    await deps.serverManager.restart();
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
    
    this._createTray();
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
    this.status = "error";
    this.errorMessage = message;
    this._updateMenu();
  }
  
  showPortConflict() {
    this.status = "port-conflict";
    this._updateMenu();
  }
  
  // Private methods
  
  _createTray() {
    let icon;
    try {
      const iconPath = path.join(__dirname, "resources", "trayTemplate.png");
      icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) {
        throw new Error("Icon is empty");
      }
      icon.setTemplateImage(true);
    } catch (error) {
      console.warn("Could not load tray icon, using title fallback:", error.message);
      icon = nativeImage.createEmpty();
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip("Transcriber");
    if (icon.isEmpty()) {
      this.tray.setTitle("T");
    }

    this.tray.on("click", () => {
      this._openTranscriber();
    });
  }
  
  _updateMenu() {
    const loginSettings = app.getLoginItemSettings();
    const openAtLogin = loginSettings.openAtLogin;
    
    const statusLabel = this._getStatusLabel();
    const canOpen = this.status === "running";
    
    const template = [
      {
        label: statusLabel,
        enabled: false,
      },
      { type: "separator" },
      {
        label: "Open Transcriber",
        enabled: canOpen,
        click: () => this._openTranscriber(),
      },
      { type: "separator" },
      {
        label: "Start at Login",
        type: "checkbox",
        checked: openAtLogin,
        click: () => this._toggleLoginItem(),
      },
      {
        label: "Connect browser extension…",
        click: () => this._openPairingWindow(),
      },
      {
        label: "Paired extensions…",
        click: () => this._showPairedExtensions(),
      },
      {
        label: "Reinstall Browser Connection",
        click: () => this._reinstallNativeHost(),
      },
      {
        label: "Import existing library…",
        click: () => this._importExistingLibrary(),
      },
      { type: "separator" },
      {
        label: "Quit Transcriber",
        click: () => this._quit(),
      },
    ];
    
    const menu = Menu.buildFromTemplate(template);
    this.tray.setContextMenu(menu);
  }
  
  _getStatusLabel() {
    switch (this.status) {
      case "running": {
        const uptime = this.serverManager.getStatus().uptime;
        const uptimeStr = this._formatUptime(uptime);
        return `● Running ${uptimeStr}`;
      }
      case "starting":
        return "● Starting...";
      case "port-conflict":
        return `✕ Port ${this.port} in use (dev server running?)`;
      case "error":
        return `✕ Error: ${this.errorMessage || "Unknown"}`;
      default:
        return "○ Stopped";
    }
  }
  
  _formatUptime(ms) {
    if (!ms || ms < 0) return "";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `(${seconds}s)`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `(${minutes}m)`;
    const hours = Math.floor(minutes / 60);
    return `(${hours}h)`;
  }
  
  _openTranscriber() {
    shell.openExternal(`http://127.0.0.1:${this.port}`);
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
  
  _notify(title, body) {
    // displayBalloon is Windows-only. Prefer a native Notification on macOS;
    // fall back to a modal if notifications are unsupported.
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

  _quit() {
    app.quit();
  }
}

module.exports = TrayManager;
module.exports.unpairExtension = unpairExtension;
