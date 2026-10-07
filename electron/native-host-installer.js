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

const HOST_NAME = "com.transcribed.host";

// Extension IDs that are allowed to connect
// These come from the existing extension builds
const ALLOWED_EXTENSION_IDS = [
  "gkfnbcjjpkhoohpgdkmefjmmadcjbljb",  // Placeholder - replace with actual IDs
];

class NativeHostInstaller {
  constructor() {
    this.browsers = this._detectBrowsers();
  }
  
  /**
   * Install native host manifests for all detected browsers.
   * Returns { success: boolean, browsers: string[], error?: string }
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
          error: "App is running from a translocated path. Move to /Applications and reopen.",
        };
      }
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
        error: errors.join("; "),
      };
    }
    
    return {
      success: true,
      browsers: results,
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
      : path.join(process.resourcesPath, "app", "tools", "native-host", "transcriber-host.js");
    
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
      allowed_origins: ALLOWED_EXTENSION_IDS.map((id) => `chrome-extension://${id}/`),
    };
    
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log("Wrote manifest:", manifestPath);
  }
}

module.exports = NativeHostInstaller;
