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
const { flipFuses, FuseV1Options, FuseVersion } = require("@electron/fuses");

module.exports = async function(context) {
  const { appOutDir, electronPlatformName } = context;
  
  console.log("Running afterPack hook...");
  console.log("  Platform:", electronPlatformName);
  console.log("  Output dir:", appOutDir);
  
  if (electronPlatformName === "darwin") {
    // electron-builder extraResources skips the source root node_modules
    // (createFilter returns false when relative === "node_modules"). Copy the
    // staging tree so @prisma/client and Next's standalone deps actually land.
    syncStandaloneFromStaging(
      path.join(appOutDir, "Transcriber.app"),
      path.join(process.cwd(), "electron", "resources", "standalone")
    );
    copyRebuiltSqliteIntoStandalone(context);
    copyLibJsIntoUnpacked(path.join(appOutDir, "Transcriber.app"));
    assertStandalonePayload(context);
    await applyElectronFuses(context);
    await adHocCodesign(context);
  }
};

function syncStandaloneFromStaging(appPath, stagingPath) {
  const dest = path.join(appPath, "Contents", "Resources", "standalone");
  if (!fs.existsSync(stagingPath)) {
    throw new Error(`Staging standalone missing: ${stagingPath}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(stagingPath, dest, { recursive: true, dereference: true });
  console.log("  copied staging standalone (including node_modules) into extraResources");
}

function copyLibJsIntoUnpacked(appPath) {
  const src = path.join(process.cwd(), "lib");
  const dest = path.join(
    appPath,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "lib"
  );
  if (!fs.existsSync(src)) {
    throw new Error(`lib/ missing at ${src}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (!name.endsWith(".js")) continue;
    fs.copyFileSync(path.join(src, name), path.join(dest, name));
  }
  console.log("  copied lib/*.js into app.asar.unpacked for native host");
}

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
  const addon = findSqliteAddon(rebuilt);
  if (!addon) {
    console.warn("  rebuilt better_sqlite3.node not found under", rebuilt);
    return;
  }
  const standalone = path.join(appPath, "Contents", "Resources", "standalone");
  const replaced = overlaySqliteNativeAddon(standalone, addon);
  console.log(`  overlaid Electron-ABI better_sqlite3.node onto ${replaced} cop(y/ies)`);
}

function findSqliteAddon(root) {
  const hits = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "better_sqlite3.node") hits.push(full);
    }
  };
  walk(root);
  return hits[0] || null;
}

function overlaySqliteNativeAddon(standaloneDir, rebuiltAddonPath) {
  if (!fs.existsSync(rebuiltAddonPath)) {
    throw new Error(`Rebuilt better_sqlite3.node missing: ${rebuiltAddonPath}`);
  }
  const targets = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "better_sqlite3.node") targets.push(full);
    }
  };
  walk(standaloneDir);
  for (const target of targets) {
    fs.copyFileSync(rebuiltAddonPath, target);
  }
  return targets.length;
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
    path.join(standalone, "prisma", "migrations"),
    path.join(standalone, "node_modules", "@prisma", "client"),
  ];
  for (const file of required) {
    if (!fs.existsSync(file)) {
      throw new Error(`Packaged standalone payload missing: ${file}`);
    }
  }
  const publicDir = path.join(standalone, "public");
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(path.join(publicDir, "keep"), "");
    console.log("  created empty standalone/public");
  }
  console.log("  standalone payload verified");
}

async function applyElectronFuses(context) {
  const { appOutDir } = context;
  const electronBinary = path.join(
    appOutDir,
    "Transcriber.app",
    "Contents",
    "MacOS",
    "Transcriber"
  );
  if (!fs.existsSync(electronBinary)) {
    throw new Error(`Electron binary missing for fuses: ${electronBinary}`);
  }
  console.log("  flipping Electron fuses on", electronBinary);
  await flipFuses(electronBinary, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: true,
    [FuseV1Options.RunAsNode]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
  });
  console.log("  fuses: RunAsNode ON, NODE_OPTIONS OFF, inspect args OFF");
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

module.exports.syncStandaloneFromStaging = syncStandaloneFromStaging;
module.exports.overlaySqliteNativeAddon = overlaySqliteNativeAddon;
module.exports.copyLibJsIntoUnpacked = copyLibJsIntoUnpacked;
module.exports.applyElectronFuses = applyElectronFuses;
