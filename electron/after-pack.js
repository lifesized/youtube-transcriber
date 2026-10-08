/**
 * electron-builder afterPack hook.
 *
 * Responsibilities:
 * - Copy Electron-ABI better-sqlite3 into the extraResources standalone tree
 * - Verify the packaged server payload (standalone, static, prisma client)
 * - Ad-hoc codesign bundled binaries (ffmpeg, yt-dlp) for macOS
 *
 * Note: electron/before-build.js rebuilds better-sqlite3 for the Electron ABI.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { flipFuses, FuseV1Options, FuseVersion } = require("@electron/fuses");
const {
  pruneStandaloneTree,
  pruneElectronLocales,
  pruneAsarUnpackedModules,
  logPrune,
} = require("../scripts/prune-electron-payload.js");

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
    copyMainProcessNativeModules(path.join(appOutDir, "Transcriber.app"));
    copyUpdaterModules(path.join(appOutDir, "Transcriber.app"));
    copyRebuiltSqliteIntoStandalone(context);
    copyLibJsIntoUnpacked(path.join(appOutDir, "Transcriber.app"));
    prunePackagedApp(path.join(appOutDir, "Transcriber.app"));
    assertStandalonePayload(context);
    assertAsarHasNoServerTree(path.join(appOutDir, "Transcriber.app"));
    await applyElectronFuses(context);
    // Sign nested binaries only. The app seal is applied last in afterSign
    // (`codesign --force --deep --sign -`). Signing the .app here, then
    // touching ffmpeg/yt-dlp, is what made `codesign --verify --strict` fail.
    adHocCodesignNestedBinaries(context);
  }
};

function syncStandaloneFromStaging(appPath, stagingPath) {
  const dest = path.join(appPath, "Contents", "Resources", "standalone");
  if (!fs.existsSync(stagingPath)) {
    throw new Error(`Staging standalone missing: ${stagingPath}`);
  }
  // Replace the extraResources copy. Merging with dereference:true can
  // throw on Node 22 when dest already holds a symlink to the same tree
  // ("cannot overwrite X with X").
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(stagingPath, dest, { recursive: true, dereference: true, force: true });
  console.log("  copied staging standalone (including node_modules) into extraResources");
}

const MAIN_PROCESS_NATIVE_MODULES = [
  "better-sqlite3",
  "bindings",
  "file-uri-to-path",
];

// electron-builder's files filter does not copy these into asar (same
// as better-sqlite3). Unpack so the gated updater can require them.
const UPDATER_MODULES = [
  "electron-updater",
  "builder-util-runtime",
  "fs-extra",
  "jsonfile",
  "universalify",
  "graceful-fs",
  "js-yaml",
  "argparse",
  "lazy-val",
  "lodash.escaperegexp",
  "lodash.isequal",
  "semver",
  "tiny-typed-emitter",
  "sax",
  "debug",
  "ms",
];

function copyNodeModuleIntoUnpacked(appPath, name) {
  const destNm = path.join(
    appPath,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules"
  );
  fs.mkdirSync(destNm, { recursive: true });
  const src = path.join(process.cwd(), "node_modules", name);
  if (!fs.existsSync(src)) {
    throw new Error(`main-process module missing in workspace: ${name}`);
  }
  const dest = path.join(destNm, name);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`  copied ${name} into app.asar.unpacked`);
}

function copyUpdaterModules(appPath) {
  for (const name of UPDATER_MODULES) {
    copyNodeModuleIntoUnpacked(appPath, name);
  }
}

function copyMainProcessNativeModules(appPath) {
  for (const name of MAIN_PROCESS_NATIVE_MODULES) {
    copyNodeModuleIntoUnpacked(appPath, name);
  }
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
    throw new Error(`rebuilt better-sqlite3 not found at ${rebuilt}`);
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

function replaceSymlinkDirWithCopy(linkPath) {
  const real = fs.realpathSync(linkPath);
  const tmp = `${linkPath}.deref-${process.pid}`;
  fs.cpSync(real, tmp, { recursive: true, dereference: true, force: true });
  fs.rmSync(linkPath, { force: true });
  fs.renameSync(tmp, linkPath);
}

/**
 * Dirent.isDirectory() is false for symlink-to-dir entries, so a naive walk
 * skips Next's hashed `better-sqlite3-*` copies and they keep pointing at the
 * workspace Node-ABI build. Replace those link dirs with real copies first.
 */
function flattenStandaloneDirSymlinks(root) {
  let flattened = 0;
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let st;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        if (!st.isDirectory()) continue;
        // Flatten every dir symlink so overlay never writes through a link
        // back to the workspace (parents of better-sqlite3-* can be links too).
        replaceSymlinkDirWithCopy(full);
        flattened += 1;
        visit(full);
      } else if (entry.isDirectory()) {
        visit(full);
      }
    }
  };
  visit(root);
  return flattened;
}

function overlaySqliteNativeAddon(standaloneDir, rebuiltAddonPath) {
  if (!fs.existsSync(rebuiltAddonPath)) {
    throw new Error(`Rebuilt better_sqlite3.node missing: ${rebuiltAddonPath}`);
  }
  const flattened = flattenStandaloneDirSymlinks(standaloneDir);
  if (flattened > 0) {
    console.log(`  flattened ${flattened} standalone symlink dir(s)`);
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
    if (fs.lstatSync(target).isSymbolicLink()) {
      fs.rmSync(target);
    }
    fs.copyFileSync(rebuiltAddonPath, target);
  }
  return targets.length;
}

function prunePackagedApp(appPath) {
  const standalone = path.join(appPath, "Contents", "Resources", "standalone");
  const pruned = pruneStandaloneTree(standalone);
  logPrune("packaged standalone", pruned);
  const locales = pruneElectronLocales(appPath);
  logPrune("electron locales", locales);
  const unpacked = pruneAsarUnpackedModules(appPath, UPDATER_MODULES);
  logPrune("asar unpacked modules", unpacked);
}

function assertAsarHasNoServerTree(appPath) {
  const unpackedNm = path.join(
    appPath,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules"
  );
  const banned = ["next", "@next", "@prisma", "prisma", "sharp", "@img"];
  if (!fs.existsSync(unpackedNm)) return;
  for (const name of banned) {
    const hit = path.join(unpackedNm, name);
    if (fs.existsSync(hit)) {
      throw new Error(`asar.unpacked must not contain server package ${name}: ${hit}`);
    }
  }
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
    path.join(
      standalone,
      "node_modules",
      ".prisma",
      "client",
      "query_compiler_fast_bg.wasm-base64.js"
    ),
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

function adHocCodesignNestedBinaries(context) {
  const { appOutDir } = context;
  const binPath = path.join(
    appOutDir,
    "Transcriber.app",
    "Contents",
    "Resources",
    "bin"
  );
  if (!fs.existsSync(binPath)) return;
  console.log("Ad-hoc codesigning nested binaries (app seal is afterSign)...");
  for (const binary of ["ffmpeg", "yt-dlp"]) {
    const binaryPath = path.join(binPath, binary);
    if (!fs.existsSync(binaryPath)) continue;
    console.log(`  Codesigning binary: ${binary}`);
    execSync(`codesign --sign - --force "${binaryPath}"`, { stdio: "inherit" });
  }
}

module.exports.syncStandaloneFromStaging = syncStandaloneFromStaging;
module.exports.flattenStandaloneDirSymlinks = flattenStandaloneDirSymlinks;
module.exports.overlaySqliteNativeAddon = overlaySqliteNativeAddon;
module.exports.copyLibJsIntoUnpacked = copyLibJsIntoUnpacked;
module.exports.copyMainProcessNativeModules = copyMainProcessNativeModules;
module.exports.copyUpdaterModules = copyUpdaterModules;
module.exports.UPDATER_MODULES = UPDATER_MODULES;
module.exports.prunePackagedApp = prunePackagedApp;
module.exports.assertAsarHasNoServerTree = assertAsarHasNoServerTree;
module.exports.applyElectronFuses = applyElectronFuses;
module.exports.adHocCodesignNestedBinaries = adHocCodesignNestedBinaries;
