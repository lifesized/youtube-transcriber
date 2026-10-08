/**
 * Utility functions for Electron app.
 */

const path = require("path");
const { execFileSync } = require("child_process");
const { writeFileAtomic } = require("../lib/write-file-atomic.js");

/**
 * Check if the app is running from a translocated/quarantined path on macOS.
 * 
 * macOS Gatekeeper may "translocate" apps downloaded from the internet
 * to a randomized path like /private/var/folders/...
 * This breaks absolute paths in native host manifests.
 * 
 * Returns true if the path contains typical translocation patterns.
 */
function checkIfTranslocated(appPath) {
  if (process.platform !== "darwin") {
    return false;
  }
  
  // Translocated paths typically look like:
  // /private/var/folders/xx/xxxxxxxxxx/T/AppTranslocation/...
  const patterns = [
    "/private/var/folders",
    "/AppTranslocation/",
    "/TemporaryItems/",
  ];
  
  return patterns.some((pattern) => appPath.includes(pattern));
}

/**
 * Check if the app is in /Applications on macOS.
 */
function isInApplications(appPath) {
  if (process.platform !== "darwin") {
    return true; // Not applicable on other platforms
  }
  
  return String(appPath || "").replace(/\\/g, "/").startsWith("/Applications/");
}

/**
 * Bundle path already written into transcriber-app-host.sh (`exec '…/Foo.app/Contents/MacOS/…'`).
 */
function recordedBundleFromWrapper(wrapperText) {
  const match = String(wrapperText || "").match(/^exec '((?:\\'|[^'])*)'/m);
  if (!match) return "";
  const execPath = match[1].replace(/'\\''/g, "'");
  const marker = ".app/Contents/MacOS/";
  const at = execPath.lastIndexOf(marker);
  if (at === -1) return "";
  return execPath.slice(0, at + 4);
}

/**
 * Re-point native-host manifests only from /Applications or the already-recorded
 * install. Never from ~/Downloads, a mounted DMG, or App Translocation.
 */
function shouldRepointNativeHost(appPath, recordedBundlePath) {
  const candidate = String(appPath || "").replace(/\\/g, "/");
  if (!candidate) return false;
  if (checkIfTranslocated(candidate)) return false;
  if (candidate.startsWith("/Volumes/")) return false;
  if (/(^|\/)Downloads\//.test(candidate)) return false;
  if (candidate.startsWith("/Applications/")) return true;
  const recorded = String(recordedBundlePath || "").replace(/\\/g, "/");
  if (!recorded) return false;
  try {
    return path.resolve(candidate) === path.resolve(recorded);
  } catch {
    return false;
  }
}

/**
 * Parse `lsof -Fpc` output into { process, pid } or null.
 */
function parseLsofListen(output) {
  let pid = "";
  let name = "";
  for (const line of String(output || "").split(/\n/)) {
    if (line.startsWith("p")) pid = line.slice(1).trim();
    else if (line.startsWith("c")) name = line.slice(1).trim();
  }
  if (!pid || !name) return null;
  return { process: name, pid };
}

/**
 * Who is listening on TCP `port`. Never kills the process.
 * Spec: lsof -nP -iTCP:<port> -sTCP:LISTEN -Fpc
 */
function findPortHolder(port, run = execFileSync) {
  try {
    const out = run(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"],
      { encoding: "utf8", timeout: 2000 }
    );
    return parseLsofListen(out);
  } catch {
    return null;
  }
}

module.exports = {
  checkIfTranslocated,
  isInApplications,
  recordedBundleFromWrapper,
  shouldRepointNativeHost,
  writeFileAtomic,
  parseLsofListen,
  findPortHolder,
};
