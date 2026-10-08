/**
 * electron-builder afterPack hook.
 *
 * Responsibilities:
 * - Copy Electron-ABI better-sqlite3 into the extraResources standalone tree
 * - Verify the packaged server payload (standalone, static, prisma, engines)
 * - Ad-hoc codesign bundled binaries (ffmpeg, yt-dlp) for macOS
 *
 * Note: electron-builder already rebuilds better-sqlite3 before this hook.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

module.exports = async function(context) {
  const { appOutDir, electronPlatformName } = context;
  
  console.log("Running afterPack hook...");
  console.log("  Platform:", electronPlatformName);
  console.log("  Output dir:", appOutDir);
  
  if (electronPlatformName === "darwin") {
    copyRebuiltSqliteIntoStandalone(context);
    assertStandalonePayload(context);
    await adHocCodesign(context);
  }
};

function copyRebuiltSqliteIntoStandalone(context) {
  const { appOutDir } = context;
  const appPath = path.join(appOutDir, "Transcriber.app");
  const rebuilt = path.join(
    appPath,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "better-sqlite3"
  );
  const dest = path.join(
    appPath,
    "Contents",
    "Resources",
    "standalone",
    "node_modules",
    "better-sqlite3"
  );
  if (!fs.existsSync(rebuilt)) {
    console.warn("  rebuilt better-sqlite3 not found at", rebuilt);
    return;
  }
  fs.cpSync(rebuilt, dest, { recursive: true });
  console.log("  copied Electron-ABI better-sqlite3 into standalone");
}

function assertStandalonePayload(context) {
  const { appOutDir } = context;
  const standalone = path.join(
    appOutDir,
    "Transcriber.app",
    "Contents",
    "Resources",
    "standalone"
  );
  const required = [
    path.join(standalone, "server.js"),
    path.join(standalone, "node_modules"),
    path.join(standalone, ".next", "static"),
    path.join(standalone, "public"),
    path.join(standalone, "prisma", "migrations"),
    path.join(standalone, "node_modules", "@prisma", "client"),
  ];
  for (const file of required) {
    if (!fs.existsSync(file)) {
      throw new Error(`Packaged standalone payload missing: ${file}`);
    }
  }
  console.log("  standalone payload verified");
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
