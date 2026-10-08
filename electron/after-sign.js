/**
 * electron-builder afterSign hook.
 *
 * afterPack copies sqlite, flips fuses, and may re-sign nested binaries.
 * Those steps invalidate the app seal. This hook is the last thing that
 * touches Transcriber.app before electron-builder writes the DMG.
 *
 * Ad-hoc only (`--sign -`). Do not modify the .app after this.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

function adHocResignApp(appPath) {
  if (!fs.existsSync(appPath)) {
    throw new Error(`afterSign: missing ${appPath}`);
  }
  console.log(`afterSign: ad-hoc re-sign ${appPath}`);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "inherit" });
  execSync(`codesign --verify --deep --strict "${appPath}"`, { stdio: "inherit" });
  console.log("afterSign: codesign --verify --deep --strict passed");
}

module.exports = async function (context) {
  const { appOutDir, electronPlatformName } = context;

  console.log("Running afterSign hook...");
  console.log("  Platform:", electronPlatformName);
  console.log("  Output dir:", appOutDir);

  if (electronPlatformName !== "darwin") {
    return;
  }

  adHocResignApp(path.join(appOutDir, "Transcriber.app"));
};

module.exports.adHocResignApp = adHocResignApp;
