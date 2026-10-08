/**
 * Native messaging host installer for Chrome/Brave/Arc/Edge.
 * 
 * Writes the manifest with a wrapper script that uses Electron's own
 * binary with ELECTRON_RUN_AS_NODE=1 to run the host script.
 * 
 * P1 implementation: automatic install on first launch, plus manual
 * reinstall from tray menu.
 */

const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { checkIfTranslocated } = require("./utils.js");
const { filterValidExtensionIds } = require("../lib/native-host-pair.js");

const HOST_NAME = "com.transcribed.host";

function packagedNativeHostScriptPath(resourcesPath) {
  return path.join(
    resourcesPath,
    "app.asar.unpacked",
    "tools",
    "native-host",
    "transcriber-host.js"
  );
}

class NativeHostInstaller {
  constructor() {
    this.browsers = this._detectBrowsers();
    this.extensionIds = this._loadExtensionIds();
  }
  
  /**
   * Load extension IDs from config file in app data directory.
   * Falls back to empty array if config doesn't exist.
   * 
   * Users can add their unpacked dev extension IDs by creating:
   * ~/Library/Application Support/Transcriber/extension-ids.json
   * 
   * Example:
   * ["abcdefghijklmnopqrstuvwxyz123456", "anotherextensionid32chars"]
   */
  _idsPath() {
    const home = os.homedir();
    return path.join(
      home,
      "Library",
      "Application Support",
      "Transcriber",
      "extension-ids.json"
    );
  }

  appendExtensionId(id) {
    if (typeof id !== "string" || !/^[a-p]{32}$/.test(id)) {
      throw new Error("Invalid extension ID");
    }
    const ids = this._loadExtensionIds();
    if (!ids.includes(id)) {
      ids.push(id);
    }
    this.extensionIds = ids;
    const configPath = this._idsPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(ids, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    return ids;
  }

  _loadExtensionIds() {
    const configPath = this._idsPath();
    
    try {
      if (fs.existsSync(configPath)) {
        const data = JSON.parse(fs.readFileSync(configPath, "utf8"));
        if (Array.isArray(data)) {
          const ids = filterValidExtensionIds(data);
          console.log(`Loaded ${ids.length} extension ID(s) from ${configPath}`);
          return ids;
        }
      }
    } catch (error) {
      console.warn(`Failed to load extension IDs from ${configPath}:`, error.message);
    }
    
    // No config or invalid format
    console.log("No extension IDs configured. Users must add their extension ID to:");
    console.log(`  ${configPath}`);
    console.log('Example: ["abcdefghijklmnopqrstuvwxyz123456"]');
    return [];
  }
  
  /**
   * Install native host manifests for all detected browsers.
   * Returns { success: boolean, browsers: string[], error?: string, extensionIds: string[] }
   */
  async install() {
    // Check for translocation on macOS
    if (process.platform === "darwin") {
      const appPath = app.getAppPath();
      const translocated = checkIfTranslocated(appPath);
      
      if (translocated) {
        return {
          success: false,
          browsers: [],
          extensionIds: this.extensionIds,
          error: "App is running from a translocated path. Move to /Applications and reopen.",
        };
      }
    }
    
    // Check if we have any extension IDs
    if (this.extensionIds.length === 0) {
      return {
        success: false,
        browsers: [],
        extensionIds: [],
        error: "No extension IDs configured. Add your extension ID to:\n~/Library/Application Support/Transcriber/extension-ids.json",
      };
    }
    
    const results = [];
    const errors = [];
    
    for (const browser of this.browsers) {
      try {
        await this._installForBrowser(browser);
        results.push(browser.name);
      } catch (error) {
        console.error(`Failed to install for ${browser.name}:`, error);
        errors.push(`${browser.name}: ${error.message}`);
      }
    }
    
    if (results.length === 0) {
      return {
        success: false,
        browsers: [],
        extensionIds: this.extensionIds,
        error: errors.join("; "),
      };
    }
    
    return {
      success: true,
      browsers: results,
      extensionIds: this.extensionIds,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    };
  }
  
  /**
   * Uninstall native host manifests from all browsers.
   */
  async uninstall() {
    for (const browser of this.browsers) {
      try {
        const manifestPath = this._getManifestPath(browser);
        if (fs.existsSync(manifestPath)) {
          fs.unlinkSync(manifestPath);
        }
        
        // Also remove wrapper script
        const wrapperPath = this._getWrapperPath();
        if (fs.existsSync(wrapperPath)) {
          fs.unlinkSync(wrapperPath);
        }
      } catch (error) {
        console.error(`Failed to uninstall for ${browser.name}:`, error);
      }
    }
  }
  
  // Private methods
  
  _detectBrowsers() {
    if (process.platform !== "darwin") {
      // For now, only support macOS
      return [];
    }
    
    const home = os.homedir();
    const browsers = [
      {
        name: "Chrome",
        manifestDir: path.join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"),
        appPath: "/Applications/Google Chrome.app",
      },
      {
        name: "Brave",
        manifestDir: path.join(home, "Library", "Application Support", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
        appPath: "/Applications/Brave Browser.app",
      },
      {
        name: "Arc",
        manifestDir: path.join(home, "Library", "Application Support", "Arc", "NativeMessagingHosts"),
        appPath: "/Applications/Arc.app",
      },
      {
        name: "Edge",
        manifestDir: path.join(home, "Library", "Application Support", "Microsoft Edge", "NativeMessagingHosts"),
        appPath: "/Applications/Microsoft Edge.app",
      },
    ];
    
    // Only return browsers that are actually installed
    return browsers.filter((browser) => {
      return fs.existsSync(browser.appPath);
    });
  }
  
  async _installForBrowser(browser) {
    // Create wrapper script in Application Support
    const wrapperPath = this._getWrapperPath();
    this._writeWrapperScript(wrapperPath);
    
    // Write manifest
    const manifestPath = this._getManifestPath(browser);
    this._writeManifest(manifestPath, wrapperPath);
    
    console.log(`Installed native host for ${browser.name}`);
  }
  
  _getWrapperPath() {
    const home = os.homedir();
    const dir = path.join(home, "Library", "Application Support", "Transcriber");
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "transcriber-host.sh");
  }
  
  _writeWrapperScript(wrapperPath) {
    // The wrapper script uses Electron's own binary with ELECTRON_RUN_AS_NODE=1
    // to run the host script
    const electronBinary = process.execPath;
    
    // In production, the host script is in resources
    // In dev, it's in the repo
    const isDev = process.env.NODE_ENV === "development";
    const hostScript = isDev
      ? path.resolve(__dirname, "..", "tools", "native-host", "transcriber-host.js")
      : packagedNativeHostScriptPath(process.resourcesPath);
    
    const script = `#!/bin/sh
# Transcriber native messaging host wrapper
# This script is generated by the Electron app
export ELECTRON_RUN_AS_NODE=1
exec "${electronBinary}" "${hostScript}" "$@"
`;
    
    fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
    fs.chmodSync(wrapperPath, 0o755);
    
    console.log("Wrote wrapper script:", wrapperPath);
  }
  
  _getManifestPath(browser) {
    fs.mkdirSync(browser.manifestDir, { recursive: true });
    return path.join(browser.manifestDir, `${HOST_NAME}.json`);
  }
  
  _writeManifest(manifestPath, wrapperPath) {
    const manifest = {
      name: HOST_NAME,
      description: "Transcriber for YouTube — local server controller",
      path: wrapperPath,
      type: "stdio",
      allowed_origins: this.extensionIds.map((id) => `chrome-extension://${id}/`),
    };
    
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log("Wrote manifest:", manifestPath);
    console.log("  Allowed extension IDs:", this.extensionIds.join(", "));
  }
}

module.exports = NativeHostInstaller;
module.exports.packagedNativeHostScriptPath = packagedNativeHostScriptPath;
