#!/usr/bin/env node
/**
 * Install (or remove) the Chrome Native Messaging manifest for the Transcriber
 * extension's "Start Transcriber" button.
 *
 * Usage:
 *   node scripts/install-native-host.js --ext-id <chrome-extension-id> [--remove]
 *   EXTENSION_ID=<id> node scripts/install-native-host.js
 *
 * Multiple --ext-id flags or a comma-separated EXTENSION_ID env var are
 * supported (useful when the published Web Store ID and a local unpacked ID
 * both need to be allowed).
 *
 * Manifest paths (where this writes to):
 *   macOS:  ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
 *   Linux:  ~/.config/google-chrome/NativeMessagingHosts/
 *   Win:    HKCU\Software\Google\Chrome\NativeMessagingHosts\<name>
 *
 * The host name is "com.transcribed.host" — must match what the extension
 * passes to chrome.runtime.connectNative().
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const HOST_NAME = "com.transcribed.host";
const HOST_SCRIPT = path.resolve(__dirname, "..", "tools", "native-host", "transcriber-host.js");

function parseArgs(argv) {
  const args = { ids: [], remove: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--remove") args.remove = true;
    else if (a === "--ext-id") args.ids.push(argv[++i]);
    else if (a.startsWith("--ext-id=")) args.ids.push(a.slice("--ext-id=".length));
  }
  if (process.env.EXTENSION_ID) {
    args.ids.push(...process.env.EXTENSION_ID.split(",").map((s) => s.trim()).filter(Boolean));
  }
  args.ids = [...new Set(args.ids)];
  return args;
}

function manifestDir() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
  }
  if (process.platform === "linux") {
    return path.join(home, ".config", "google-chrome", "NativeMessagingHosts");
  }
  if (process.platform === "win32") {
    // Windows uses the registry, not a file. We still write the JSON so the
    // registry value can point at it.
    return path.join(process.env.APPDATA || home, "Transcriber");
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}

function makeWrapperIfNeeded() {
  // On macOS / Linux we point Chrome directly at a node shebang script. If
  // node isn't on the PATH that Chrome inherits (common when node lives in a
  // version manager like nvm), we fall back to a small shell wrapper that
  // resolves node explicitly.
  if (process.platform === "win32") return HOST_SCRIPT;

  const nodeBin = process.execPath;
  const wrapperPath = path.join(path.dirname(HOST_SCRIPT), "transcriber-host.sh");
  const wrapper = `#!/bin/sh\nexec "${nodeBin}" "${HOST_SCRIPT}" "$@"\n`;
  fs.writeFileSync(wrapperPath, wrapper, { mode: 0o755 });
  fs.chmodSync(HOST_SCRIPT, 0o755);
  return wrapperPath;
}

function writeManifest({ ids, remove }) {
  const dir = manifestDir();
  const manifestPath = path.join(dir, `${HOST_NAME}.json`);

  if (remove) {
    if (fs.existsSync(manifestPath)) {
      fs.unlinkSync(manifestPath);
      console.log(`Removed: ${manifestPath}`);
    } else {
      console.log("Nothing to remove.");
    }
    if (process.platform === "win32") removeWindowsRegistry();
    return;
  }

  if (ids.length === 0) {
    console.error("Error: pass --ext-id <chrome-extension-id> or set EXTENSION_ID.");
    console.error("Find it at chrome://extensions (enable Developer mode to see IDs).");
    process.exit(1);
  }

  fs.mkdirSync(dir, { recursive: true });
  const hostPath = makeWrapperIfNeeded();

  const manifest = {
    name: HOST_NAME,
    description: "Transcriber for YouTube — local server controller",
    path: hostPath,
    type: "stdio",
    allowed_origins: ids.map((id) => `chrome-extension://${id}/`),
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Installed: ${manifestPath}`);
  console.log(`Host script: ${hostPath}`);
  console.log(`Allowed extension IDs: ${ids.join(", ")}`);

  if (process.platform === "win32") writeWindowsRegistry(manifestPath);
}

function writeWindowsRegistry(manifestPath) {
  const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
  execSync(`reg add "${key}" /ve /t REG_SZ /d "${manifestPath}" /f`, { stdio: "inherit" });
  console.log(`Wrote registry: ${key}`);
}

function removeWindowsRegistry() {
  const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
  try {
    execSync(`reg delete "${key}" /f`, { stdio: "inherit" });
  } catch {
    // Key may not exist — that's fine.
  }
}

const args = parseArgs(process.argv.slice(2));
writeManifest(args);
