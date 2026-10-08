/**
 * Utility functions for Electron app.
 */

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
  
  return appPath.startsWith("/Applications/");
}

module.exports = {
  checkIfTranslocated,
  isInApplications,
  writeFileAtomic,
};
