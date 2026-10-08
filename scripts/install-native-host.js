#!/usr/bin/env node
/**
 * Install (or remove) the Chrome Native Messaging manifest for the Transcriber
 * extension's "Start Transcriber" button.
 *
 * Usage:
 *   node scripts/install-native-host.js --ext-id <chrome-extension-id> [--project-root <abs-path>]
 *   node scripts/install-native-host.js --project-root <abs-path>
 *   node scripts/install-native-host.js --clear-project-root
 *   node scripts/install-native-host.js --remove
 *   EXTENSION_ID=<id> node scripts/install-native-host.js
 *
 * Multiple --ext-id flags or a comma-separated EXTENSION_ID env var are
 * supported (useful when the published Web Store ID and a local unpacked ID
 * both need to be allowed).
 *
 * The host script stays in the checkout you install from. Start runs
 * `npm run dev` from the project root recorded in native-host.json in the
 * Transcriber state dir. A plain install records this checkout only when no
 * root is recorded yet.
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
const { getStateDir } = require("../lib/local-api-token.js");
const { writeFileAtomic } = require("../lib/write-file-atomic.js");
const { EXTENSION_ID_RE, filterValidExtensionIds } = require("../lib/native-host-pair.js");
const { resolveAppStateDir } = require("../electron/config.js");
const {
  defaultProjectRoot,
  getConfigPath,
  readRecordedProjectRoot,
  validateProjectRoot,
  writeProjectRootConfig,
  clearProjectRootConfig,
  describeDetail,
} = require("../tools/native-host/project-root.js");

const HOST_NAME = "com.transcribed.host";
const HOST_SCRIPT = path.resolve(__dirname, "..", "tools", "native-host", "transcriber-host.js");
const EXTENSION_IDS_FILE = "extension-ids.json";

const BOOLEAN_FLAGS = {
  "--remove": "remove",
  "--replace": "replace",
  "--clear-project-root": "clearProjectRoot",
};
const VALUE_FLAGS = ["--ext-id", "--project-root"];

class UsageError extends Error {}

function parseArgs(argv, env = process.env) {
  const args = { ids: [], remove: false, replace: false, projectRoot: null, clearProjectRoot: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (BOOLEAN_FLAGS[a]) {
      args[BOOLEAN_FLAGS[a]] = true;
      continue;
    }
    const flag = VALUE_FLAGS.find((f) => a === f || a.startsWith(f + "="));
    if (!flag) throw new UsageError(`Unknown option: ${a}`);
    let value;
    if (a === flag) {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(`Missing value for ${flag}`);
      }
      i += 1;
    } else {
      value = a.slice(flag.length + 1);
    }
    if (!value) throw new UsageError(`Missing value for ${flag}`);
    if (flag === "--ext-id") args.ids.push(value);
    else if (args.projectRoot !== null) throw new UsageError("--project-root given twice");
    else args.projectRoot = value;
  }
  if (args.projectRoot !== null && args.clearProjectRoot) {
    throw new UsageError("Use either --project-root or --clear-project-root, not both.");
  }
  if (env.EXTENSION_ID) {
    args.ids.push(...env.EXTENSION_ID.split(",").map((s) => s.trim()).filter(Boolean));
  }
  for (const id of args.ids) {
    if (!EXTENSION_ID_RE.test(id)) {
      throw new UsageError(`Invalid extension ID: ${id} (expected 32 letters a–p)`);
    }
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
  // On macOS / Linux we install the wrapper to Application Support with an
  // absolute Node path resolved at install time, so Chrome can launch it even
  // when Node isn't on Chrome's PATH (common with Homebrew or version managers).
  if (process.platform === "win32") return HOST_SCRIPT;

  const nodeBin = process.execPath;
  const dir = manifestDir();
  const installedWrapper = path.join(dir, "transcriber-host.sh");
  
  // Write wrapper with absolute node and host script paths
  const wrapper = `#!/bin/sh\nexec "${nodeBin}" "${HOST_SCRIPT}" "$@"\n`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(installedWrapper, wrapper, { mode: 0o755 });
  fs.chmodSync(HOST_SCRIPT, 0o755);
  
  return installedWrapper;
}

// Replace the long absolute home path with ~ for readable output.
function tildify(p) {
  const home = os.homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

function readManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function manifestIds(manifest) {
  const origins = (manifest && manifest.allowed_origins) || [];
  return filterValidExtensionIds(
    origins.map((o) => String(o).match(/^chrome-extension:\/\/([^/]+)\/?$/)?.[1])
  );
}

/** The dev host's getLocalToken allowlist. Refuses to guess at a damaged file. */
function readAllowlist(idsPath) {
  let raw;
  try {
    raw = fs.readFileSync(idsPath, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return { exists: false, ids: [] };
    throw e;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed) || filterValidExtensionIds(parsed).length !== parsed.length) {
    throw new Error(
      `${tildify(idsPath)} is not a JSON array of extension IDs. Fix or delete it, then re-run.`
    );
  }
  return { exists: true, ids: parsed };
}

function writeAllowlist(idsPath, ids) {
  writeFileAtomic(idsPath, JSON.stringify(ids, null, 2) + "\n", 0o600);
}

function writeManifestFile(manifestPath, manifest) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function uniq(ids) {
  return [...new Set(ids)];
}

function removeHost({ ids }, stateDir) {
  const manifestPath = path.join(manifestDir(), `${HOST_NAME}.json`);
  const idsPath = path.join(stateDir, EXTENSION_IDS_FILE);
  const allowlist = readAllowlist(idsPath);
  const manifest = readManifest(manifestPath);
  const allowed = manifestIds(manifest);

  if (ids.length > 0) {
    const remaining = uniq([...allowlist.ids, ...allowed]).filter((id) => !ids.includes(id));
    if (allowlist.exists || remaining.length > 0) writeAllowlist(idsPath, remaining);
    if (manifest && remaining.length > 0) {
      writeManifestFile(manifestPath, {
        ...manifest,
        allowed_origins: remaining.map((id) => `chrome-extension://${id}/`),
      });
      console.log("");
      console.log(`Removed ${ids.join(", ")} from the native host.`);
      console.log(`  Still allowed: ${remaining.join(", ")}`);
      console.log("");
      return;
    }
  } else if (allowlist.exists) {
    writeAllowlist(idsPath, allowlist.ids.filter((id) => !allowed.includes(id)));
  }

  if (fs.existsSync(manifestPath)) {
    fs.unlinkSync(manifestPath);
    console.log("");
    console.log("Native host removed.");
    console.log("");
    console.log("The 'Start Transcriber' button in the extension side panel will no");
    console.log("longer work. You can still start the server manually with:");
    console.log("  npm run dev");
    console.log("");
  } else {
    console.log("");
    console.log("Nothing to remove — the native host wasn't installed.");
    console.log("");
  }
  if (process.platform === "win32") removeWindowsRegistry();
}

function installHost({ ids, replace }, stateDir) {
  const dir = manifestDir();
  const manifestPath = path.join(dir, `${HOST_NAME}.json`);
  const idsPath = path.join(stateDir, EXTENSION_IDS_FILE);

  // Merge by default so installing a new ID (e.g. dev unpacked) doesn't
  // silently wipe a previously-installed one. --replace opts out for both
  // the manifest and extension-ids.json so they never disagree.
  const allowlist = readAllowlist(idsPath);
  const mergedIds = replace
    ? ids
    : uniq([...allowlist.ids, ...manifestIds(readManifest(manifestPath)), ...ids]);

  // Allowlist first: if the manifest write fails, Chrome still can't launch
  // the host for an ID the host would then refuse a token.
  writeAllowlist(idsPath, mergedIds);

  fs.mkdirSync(dir, { recursive: true });
  const hostPath = makeWrapperIfNeeded();
  writeManifestFile(manifestPath, {
    name: HOST_NAME,
    description: "Transcriber for YouTube — local server controller",
    path: hostPath,
    type: "stdio",
    allowed_origins: mergedIds.map((id) => `chrome-extension://${id}/`),
  });

  console.log("");
  console.log("Native host installed.");
  console.log("");
  console.log("The Transcriber extension can now start your local server in one");
  console.log("click — no more 'npm run dev' from the terminal.");
  console.log("");
  console.log("Next steps:");
  console.log("  1. Reload the extension at chrome://extensions");
  console.log("  2. Open the side panel on a YouTube tab");
  console.log("  3. When the server is offline, click 'Start Transcriber'");
  console.log("");
  console.log("Important: Re-run this command after a fresh checkout or rebuild");
  console.log("to update the absolute Node path.");
  console.log("");
  console.log("To remove later: npm run uninstall-native-host");
  console.log("");
  console.log("─────────────────────────────────────────────────────────");
  console.log("Details (for debugging):");
  console.log(`  Allowed extension IDs:  ${mergedIds.join(", ")}`);
  console.log(`  Token allowlist:        ${tildify(idsPath)}`);
  console.log(`  Manifest:               ${tildify(manifestPath)}`);
  console.log(`  Host wrapper:           ${tildify(hostPath)}`);
  console.log(`  Host script:            ${tildify(HOST_SCRIPT)}`);
  console.log("");

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

function fail(lines) {
  console.error("");
  for (const line of lines) console.error(line);
  console.error("");
  process.exit(1);
}

function applyProjectRoot(args, stateDir) {
  if (args.clearProjectRoot) {
    clearProjectRootConfig(stateDir);
    return;
  }
  if (args.projectRoot !== null) {
    writeProjectRootConfig(args.projectRoot, stateDir);
    return;
  }
  if (args.remove || readRecordedProjectRoot(stateDir) !== null) return;
  const own = validateProjectRoot(defaultProjectRoot());
  if (own.ok) writeProjectRootConfig(own.projectRoot, stateDir);
}

function printProjectRoot(stateDir) {
  const recorded = readRecordedProjectRoot(stateDir);
  const check = validateProjectRoot(recorded);
  console.log(`Project root config: ${tildify(getConfigPath(stateDir))}`);
  if (check.ok) {
    console.log(`Start runs npm run dev from: ${tildify(check.projectRoot)}`);
  } else {
    console.log(`Start is disabled: ${describeDetail(check.detail)}`);
    console.log("Fix with: npm run install-native-host -- --project-root <abs-path-to-Transcriber>");
  }
  console.log("");
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      fail([e.message, "", "Usage: npm run install-native-host -- --ext-id=<id> [--project-root=<abs-path>]"]);
    }
    throw e;
  }

  const configOnly =
    (args.projectRoot !== null || args.clearProjectRoot) && !args.remove && args.ids.length === 0;
  if (!configOnly && !args.remove && args.ids.length === 0) {
    fail([
      "Missing extension ID.",
      "",
      "To find it:",
      "  1. Open chrome://extensions in Chrome",
      "  2. Enable 'Developer mode' (toggle, top right)",
      "  3. Find 'Transcriber for YouTube' — copy the ID under the name",
      "     (a 32-character string of lowercase letters)",
      "",
      "Then run:",
      "  npm run install-native-host -- --ext-id=PASTE_ID_HERE",
    ]);
  }

  const stateDir = getStateDir();
  if (path.resolve(stateDir) === path.resolve(resolveAppStateDir())) {
    fail([
      `Refusing to write the dev native host config into the app state dir (${tildify(stateDir)}).`,
      "Unset TRANSCRIBER_STATE_DIR and try again.",
    ]);
  }

  if (!configOnly) {
    try {
      readAllowlist(path.join(stateDir, EXTENSION_IDS_FILE));
    } catch (e) {
      fail([e.message]);
    }
  }

  try {
    applyProjectRoot(args, stateDir);
  } catch (e) {
    fail([`Invalid --project-root: ${e.message}`]);
  }

  if (configOnly) {
    console.log("");
    console.log(args.clearProjectRoot ? "Native host project root cleared." : "Native host project root saved.");
  } else if (args.remove) {
    removeHost(args, stateDir);
  } else {
    installHost(args, stateDir);
  }
  printProjectRoot(stateDir);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { parseArgs, UsageError };
