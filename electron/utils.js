/**
 * Utility functions for Electron app.
 */

const fs = require("fs");
const path = require("path");

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
  
  return appPath.startsWith("/Applications/");
}

function writeFileAtomic(filePath, contents, mode = 0o600) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, contents, { encoding: "utf8", mode });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // Windows may ignore chmod
  }
  return filePath;
}

module.exports = {
  checkIfTranslocated,
  isInApplications,
  writeFileAtomic,
};
