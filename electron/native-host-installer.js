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
const { execFileSync } = require("child_process");
const { checkIfTranslocated, recordedBundleFromWrapper, writeFileAtomic } = require("./utils.js");
const { filterValidExtensionIds } = require("../lib/native-host-pair.js");
const { getLogDir } = require("../lib/local-api-token.js");
const config = require("./config.js");

function shSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

const HOST_NAME = config.nativeHostName;

function packagedNativeHostScriptPath(resourcesPath) {
  return path.join(
    resourcesPath,
    "app.asar.unpacked",
    "tools",
    "native-host",
    "transcriber-host.js"
  );
}

function resolveHostScriptPath() {
  if (process.env.NODE_ENV === "development") {
    return path.resolve(__dirname, "..", "tools", "native-host", "transcriber-host.js");
  }
  if (process.resourcesPath) {
    return packagedNativeHostScriptPath(process.resourcesPath);
  }
  return path.resolve(__dirname, "..", "tools", "native-host", "transcriber-host.js");
}

function commandLineMentionsPath(commandLine, hostScriptPath) {
  if (!commandLine || !hostScriptPath) return false;
  const escaped = String(hostScriptPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[\\s'"])${escaped}(?:[\\s'"]|$)`).test(commandLine);
}

function killNativeHostProcesses(hostScriptPath, options = {}) {
  if (!hostScriptPath) return [];
  const selfPid = options.selfPid || process.pid;
  const killPid = options.kill || ((pid, signal) => process.kill(pid, signal));
  let out = options.psOutput;
  if (out == null) {
    try {
      const run = options.execFileSync || execFileSync;
      out = run("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" });
    } catch {
      return [];
    }
  }
  const killed = [];
  for (const line of String(out).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const space = trimmed.search(/\s/);
    if (space < 0) continue;
    const pid = Number(trimmed.slice(0, space));
    const cmd = trimmed.slice(space).trim();
    if (!Number.isInteger(pid) || pid <= 0 || pid === selfPid) continue;
    if (!commandLineMentionsPath(cmd, hostScriptPath)) continue;
    try {
      killPid(pid, "SIGTERM");
      killed.push(pid);
    } catch {
      // process already gone
    }
  }
  return killed;
}

class NativeHostInstaller {
  constructor(options = {}) {
    this.idsPathOverride = options.idsPath || null;
    this.hostName = options.hostName || HOST_NAME;
    this.port = options.port || config.port;
    this.stateDir = options.stateDir || config.resolveAppStateDir();
    this.logDir = options.logDir || getLogDir(this.stateDir);
    this.browsers = options.browsers || this._detectBrowsers();
    this.idsFileCorrupt = false;
    try {
      this.extensionIds = this._loadExtensionIds();
    } catch (error) {
      console.error("Failed to load extension IDs:", error.message);
      this.extensionIds = [];
      this.idsFileCorrupt = true;
    }
  }
  
  /**
   * Load extension IDs from config file in app data directory.
   * Falls back to empty array if config doesn't exist.
   * 
   * Users can add their unpacked dev extension IDs by creating:
   * ~/Library/Application Support/Transcriber App/extension-ids.json
   * 
   * Example:
   * ["abcdefghijklmnopqrstuvwxyz123456", "anotherextensionid32chars"]
   */
  _idsPath() {
    if (this.idsPathOverride) return this.idsPathOverride;
    return path.join(this.stateDir, "extension-ids.json");
  }

  listExtensionIds() {
    if (this.idsFileCorrupt) {
      throw new Error("extension-ids.json is corrupt");
    }
    this.extensionIds = this._loadExtensionIds();
    return [...this.extensionIds];
  }

  _writeExtensionIds(ids) {
    const configPath = this._idsPath();
    this._assertAppStatePath(configPath);
    writeFileAtomic(configPath, JSON.stringify(ids, null, 2) + "\n", 0o600);
    this.extensionIds = ids;
    this.idsFileCorrupt = false;
    return ids;
  }

  appendExtensionId(id) {
    if (typeof id !== "string" || !/^[a-p]{32}$/.test(id)) {
      throw new Error("Invalid extension ID");
    }
    if (this.idsFileCorrupt) {
      console.error("extension-ids.json is corrupt; refusing to append");
      throw new Error("extension-ids.json is corrupt; refusing to append");
    }
    const ids = this._loadExtensionIds();
    if (!ids.includes(id)) {
      ids.push(id);
    }
    return this._writeExtensionIds(ids);
  }

  removeExtensionId(id) {
    if (this.idsFileCorrupt) {
      console.error("extension-ids.json is corrupt; refusing to update");
      throw new Error("extension-ids.json is corrupt; refusing to update");
    }
    const ids = this._loadExtensionIds().filter((existing) => existing !== id);
    return this._writeExtensionIds(ids);
  }

  async rewriteManifests() {
    const results = [];
    const errors = [];
    for (const browser of this.browsers) {
      try {
        await this._installForBrowser(browser);
        results.push(browser.name);
      } catch (error) {
        console.error(`Failed to rewrite manifest for ${browser.name}:`, error);
        errors.push(`${browser.name}: ${error.message}`);
      }
    }
    return {
      success: errors.length === 0,
      browsers: results,
      extensionIds: this.extensionIds,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    };
  }

  _loadExtensionIds() {
    const configPath = this._idsPath();
    if (!fs.existsSync(configPath)) {
      console.log("No extension IDs configured. Users must add their extension ID to:");
      console.log(`  ${configPath}`);
      return [];
    }
    let data;
    try {
      data = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (error) {
      console.error(`extension-ids.json is corrupt; refusing to parse (${configPath}):`, error.message);
      const err = new Error("extension-ids.json is corrupt");
      err.code = "CORRUPT_EXTENSION_IDS";
      throw err;
    }
    if (!Array.isArray(data)) {
      console.error(`extension-ids.json is not an array; refusing to parse (${configPath})`);
      const err = new Error("extension-ids.json is corrupt");
      err.code = "CORRUPT_EXTENSION_IDS";
      throw err;
    }
    const ids = filterValidExtensionIds(data);
    console.log(`Loaded ${ids.length} extension ID(s) from ${configPath}`);
    return ids;
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
        error: `No extension IDs configured. Add your extension ID to:\n${this._idsPath()}`,
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
        this._assertAppManifestPath(manifestPath);
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
    const dir = this.stateDir;
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "transcriber-app-host.sh");
  }

  readRecordedBundlePath() {
    try {
      return recordedBundleFromWrapper(fs.readFileSync(this._getWrapperPath(), "utf8"));
    } catch {
      return "";
    }
  }
  
  _writeWrapperScript(wrapperPath) {
    // The wrapper script uses Electron's own binary with ELECTRON_RUN_AS_NODE=1
    // to run the host script
    const electronBinary = process.execPath;
    
    // In production, the host script is in resources
    // In dev, it's in the repo
    const isDev = process.env.NODE_ENV === "development";
    const hostScript =
      isDev || !process.resourcesPath
        ? path.resolve(__dirname, "..", "tools", "native-host", "transcriber-host.js")
        : packagedNativeHostScriptPath(process.resourcesPath);
    
    const script = `#!/bin/sh
# Transcriber native messaging host wrapper
# This script is generated by the Electron app
export ELECTRON_RUN_AS_NODE=1
export PORT=${shSingleQuote(String(this.port))}
export TRANSCRIBER_STATE_DIR=${shSingleQuote(this.stateDir)}
export TRANSCRIBER_LOG_DIR=${shSingleQuote(this.logDir)}
exec ${shSingleQuote(electronBinary)} ${shSingleQuote(hostScript)} "$@"
`;
    
    fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
    fs.chmodSync(wrapperPath, 0o755);
    
    console.log("Wrote wrapper script:", wrapperPath);
  }
  
  _getManifestPath(browser) {
    fs.mkdirSync(browser.manifestDir, { recursive: true });
    const manifestPath = path.join(browser.manifestDir, `${this.hostName}.json`);
    this._assertAppManifestPath(manifestPath);
    return manifestPath;
  }

  _assertAppManifestPath(manifestPath) {
    const checkoutManifest = `${config.checkoutNativeHostName}.json`;
    if (path.basename(manifestPath) === checkoutManifest) {
      throw new Error(
        `refusing to write or remove the checkout native-host manifest (${checkoutManifest})`
      );
    }
  }
  
  _assertAppStatePath(filePath) {
    const checkoutState = config.resolveCheckoutStateDir();
    const rel = path.relative(path.resolve(checkoutState), path.resolve(filePath));
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      throw new Error(
        `refusing to write app state inside the checkout state dir (${checkoutState})`
      );
    }
  }

  _writeManifest(manifestPath, wrapperPath) {
    this._assertAppManifestPath(manifestPath);
    const manifest = {
      name: this.hostName,
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
module.exports.resolveHostScriptPath = resolveHostScriptPath;
module.exports.commandLineMentionsPath = commandLineMentionsPath;
module.exports.killNativeHostProcesses = killNativeHostProcesses;
module.exports.shSingleQuote = shSingleQuote;
module.exports.HOST_NAME = HOST_NAME;
