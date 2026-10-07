/**
 * electron-builder afterPack hook.
 * 
 * Responsibilities:
 * - Rebuild better-sqlite3 for Electron's ABI
 * - Ad-hoc codesign bundled binaries (ffmpeg, yt-dlp) for macOS
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

module.exports = async function(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  
  console.log("Running afterPack hook...");
  console.log("  Platform:", electronPlatformName);
  console.log("  Output dir:", appOutDir);
  
  if (electronPlatformName === "darwin") {
    await rebuildNativeModules(context);
    await adHocCodesign(context);
  }
};

async function rebuildNativeModules(context) {
  const { appOutDir } = context;
  
  console.log("Rebuilding native modules for Electron...");
  
  try {
    // Find the app bundle
    const appName = "Transcriber.app";
    const appPath = path.join(appOutDir, appName);
    const resourcesPath = path.join(appPath, "Contents", "Resources");
    
    // Use electron-rebuild to rebuild better-sqlite3
    const electronVersion = require("electron/package.json").version;
    
    execSync(
      `npx electron-rebuild --version=${electronVersion} --force --types=prod,optional --module-dir="${resourcesPath}/app.asar.unpacked"`,
      {
        cwd: process.cwd(),
        stdio: "inherit",
      }
    );
    
    console.log("Native modules rebuilt successfully");
  } catch (error) {
    console.error("Failed to rebuild native modules:", error);
    throw error;
  }
}

async function adHocCodesign(context) {
  const { appOutDir } = context;
  
  console.log("Ad-hoc codesigning bundled binaries...");
  
  try {
    const appName = "Transcriber.app";
    const appPath = path.join(appOutDir, appName);
    const resourcesPath = path.join(appPath, "Contents", "Resources");
    const binPath = path.join(resourcesPath, "bin");
    
    // Ad-hoc codesign the entire app with entitlements
    const entitlementsPath = path.join(process.cwd(), "electron", "entitlements.mac.plist");
    
    console.log(`  Codesigning app: ${appPath}`);
    execSync(
      `codesign --sign - --force --deep --entitlements "${entitlementsPath}" "${appPath}"`,
      { stdio: "inherit" }
    );
    
    // Codesign bundled binaries if they exist
    if (fs.existsSync(binPath)) {
      const binaries = ["ffmpeg", "yt-dlp"];
      for (const binary of binaries) {
        const binaryPath = path.join(binPath, binary);
        if (fs.existsSync(binaryPath)) {
          console.log(`  Codesigning binary: ${binary}`);
          execSync(`codesign --sign - --force "${binaryPath}"`, { stdio: "inherit" });
        }
      }
    }
    
    console.log("Ad-hoc codesigning completed");
  } catch (error) {
    console.error("Failed to ad-hoc codesign:", error);
    // Don't throw - this is a best-effort operation
  }
}
