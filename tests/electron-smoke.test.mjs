/**
 * Basic smoke tests for Electron setup.
 * 
 * These tests verify the structure and basic functionality
 * without actually launching Electron (which requires a display).
 */

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

test("electron main file exists", () => {
  const mainPath = path.join(projectRoot, "electron", "main.js");
  assert.ok(fs.existsSync(mainPath), "electron/main.js should exist");
});

test("electron-builder config exists", () => {
  const configPath = path.join(projectRoot, "electron-builder.json");
  assert.ok(fs.existsSync(configPath), "electron-builder.json should exist");
});

test("package.json has electron main entry", () => {
  const pkgPath = path.join(projectRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  assert.strictEqual(pkg.main, "electron/main.js", "main field should point to electron/main.js");
});

test("package.json has electron scripts", () => {
  const pkgPath = path.join(projectRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  assert.ok(pkg.scripts["electron:dev"], "electron:dev script should exist");
  assert.ok(pkg.scripts["electron:build"], "electron:build script should exist");
});

test("entitlements file exists", () => {
  const entPath = path.join(projectRoot, "electron", "entitlements.mac.plist");
  assert.ok(fs.existsSync(entPath), "entitlements.mac.plist should exist");
});

test("ServerManager module loads", async () => {
  const ServerManager = (await import(path.join(projectRoot, "electron", "server-manager.js"))).default;
  assert.ok(typeof ServerManager === "function", "ServerManager should be a constructor");
});

test("NativeHostInstaller module loads", async () => {
  const NativeHostInstaller = (await import(path.join(projectRoot, "electron", "native-host-installer.js"))).default;
  assert.ok(typeof NativeHostInstaller === "function", "NativeHostInstaller should be a constructor");
});

test("utils module loads", async () => {
  const utils = await import(path.join(projectRoot, "electron", "utils.js"));
  assert.ok(typeof utils.checkIfTranslocated === "function", "checkIfTranslocated should be exported");
  assert.ok(typeof utils.isInApplications === "function", "isInApplications should be exported");
});

test("GitHub Actions workflow exists", () => {
  const workflowPath = path.join(projectRoot, ".github", "workflows", "electron-build-macos.yml");
  assert.ok(fs.existsSync(workflowPath), "electron-build-macos.yml workflow should exist");
});

test("CI bundles static ffmpeg not Homebrew", () => {
  const workflowPath = path.join(projectRoot, ".github", "workflows", "electron-build-macos.yml");
  const content = fs.readFileSync(workflowPath, "utf8");
  const lockPath = path.join(projectRoot, "electron", "ffmpeg.lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  assert.ok(lock.version, "ffmpeg.lock.json needs version");
  assert.match(lock.sha256, /^[a-f0-9]{64}$/);
  assert.ok(lock.url.includes("ffmpeg.martin-riedl.de"));
  assert.ok(!lock.url.includes("latest"), "lock URL must not use the latest redirect");
  assert.ok(content.includes("ffmpeg.lock.json"));
  assert.ok(!content.includes("/redirect/latest/"));
  assert.ok(!content.includes("brew install ffmpeg"));
  assert.ok(content.includes("otool -L"));
  assert.ok(content.includes("ffmpeg -version"));
  assert.ok(content.includes("sine=d=1"));
  assert.ok(lock.provenance.includes("Martin Riedl"));
  assert.ok(lock.provenance.includes("ad-hoc"));
  assert.ok(content.includes("yt-dlp") && content.includes("--version"));
});

test("CI pins yt-dlp by version and sha256", () => {
  const workflowPath = path.join(projectRoot, ".github", "workflows", "electron-build-macos.yml");
  const content = fs.readFileSync(workflowPath, "utf8");
  const lockPath = path.join(projectRoot, "electron", "yt-dlp.lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  assert.ok(lock.version, "yt-dlp.lock.json needs version");
  assert.match(lock.sha256, /^[a-f0-9]{64}$/);
  assert.ok(lock.url.includes(`/${lock.version}/`));
  assert.ok(!lock.url.includes("/latest/"), "lock URL must not use latest");
  assert.ok(lock.sumsUrl.includes("SHA2-256SUMS"));
  assert.equal(lock.asset, "yt-dlp_macos");
  assert.ok(content.includes("yt-dlp.lock.json"));
  assert.ok(content.includes("SHA2-256SUMS"));
  assert.ok(content.includes("set -euo pipefail"));
  assert.ok(content.includes("curl -L --fail"));
  assert.ok(!content.includes("releases/latest/download/yt-dlp"));
});

test("CI smoke test launches Electron with an absolute path after cd", () => {
  // Regression: the launch subshell cds into standalone, so a relative
  // APP_PATH ("dist-electron/.../Transcriber") becomes ENOENT.
  const workflowPath = path.join(projectRoot, ".github", "workflows", "electron-build-macos.yml");
  const content = fs.readFileSync(workflowPath, "utf8");
  assert.match(
    content,
    /APP_PATH="\$\{?(PWD|ROOT|GITHUB_WORKSPACE)\}?\//,
    "APP_PATH must be rooted at PWD/ROOT so it still works after cd standalone"
  );
  assert.ok(content.includes('cd "$STANDALONE"'));
});

test("beta install docs exist", () => {
  const docsPath = path.join(projectRoot, "docs", "beta-install-macos.md");
  assert.ok(fs.existsSync(docsPath), "beta-install-macos.md should exist");
});

test("Next.js config has standalone output", () => {
  // We need to check the TS file
  const configPath = path.join(projectRoot, "next.config.ts");
  const content = fs.readFileSync(configPath, "utf8");
  assert.ok(content.includes('output: "standalone"'), "next.config.ts should have standalone output");
});

test("electron-builder copies standalone outside asar", () => {
  const configPath = path.join(projectRoot, "electron-builder.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const extras = config.extraResources || [];
  const standalone = extras.find((entry) => entry.to === "standalone");
  assert.ok(standalone, "extraResources should include standalone payload");
  assert.equal(standalone.from, "electron/resources/standalone");
});

test("prepare-electron-standalone script exists", () => {
  const scriptPath = path.join(projectRoot, "scripts", "prepare-electron-standalone.js");
  assert.ok(fs.existsSync(scriptPath), "prepare-electron-standalone.js should exist");
});

test("packaged server path is extraResources/standalone", () => {
  const mainPath = path.join(projectRoot, "electron", "main.js");
  const content = fs.readFileSync(mainPath, "utf8");
  assert.ok(content.includes('path.join(process.resourcesPath, "standalone")'));
  assert.ok(content.includes('path.join(appRoot, "server.js")'));
});

test("afterPack restores standalone node_modules skipped by extraResources", () => {
  // electron-builder createFilter() returns false for extraResources root
  // node_modules, so @prisma/client never lands in the .app. afterPack must
  // copy the staging tree (including node_modules) on top of that copy.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "afterpack-"));
  const staging = path.join(tmp, "staging");
  const appPath = path.join(tmp, "Transcriber.app");
  const dest = path.join(appPath, "Contents", "Resources", "standalone");

  fs.mkdirSync(path.join(staging, "node_modules", "@prisma", "client"), { recursive: true });
  fs.mkdirSync(path.join(staging, "node_modules", "better-sqlite3"), { recursive: true });
  fs.mkdirSync(path.join(staging, ".next", "static"), { recursive: true });
  fs.mkdirSync(path.join(staging, "prisma", "migrations"), { recursive: true });
  fs.writeFileSync(path.join(staging, "server.js"), "ok");
  fs.writeFileSync(path.join(staging, "node_modules", "@prisma", "client", "index.js"), "ok");
  fs.writeFileSync(path.join(staging, "node_modules", "better-sqlite3", "package.json"), "{}");
  fs.writeFileSync(path.join(staging, ".next", "static", "chunk.js"), "ok");

  fs.mkdirSync(path.join(dest, "node_modules"), { recursive: true });
  fs.copyFileSync(path.join(staging, "server.js"), path.join(dest, "server.js"));
  fs.cpSync(path.join(staging, ".next"), path.join(dest, ".next"), { recursive: true });
  fs.cpSync(path.join(staging, "prisma"), path.join(dest, "prisma"), { recursive: true });
  fs.symlinkSync(
    path.join(staging, "node_modules", "better-sqlite3"),
    path.join(dest, "node_modules", "better-sqlite3")
  );

  assert.equal(
    fs.existsSync(path.join(dest, "node_modules", "@prisma", "client")),
    false,
    "precondition: extraResources-like copy omitted root node_modules"
  );

  const afterPack = require(path.join(projectRoot, "electron", "after-pack.js"));
  afterPack.syncStandaloneFromStaging(appPath, staging);

  assert.ok(
    fs.existsSync(path.join(dest, "node_modules", "@prisma", "client", "index.js")),
    "@prisma/client must be restored from staging"
  );
  assert.ok(
    fs.existsSync(path.join(dest, "node_modules", "better-sqlite3", "package.json")),
    "staging better-sqlite3 must land even if dest had a symlink to it"
  );

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("afterPack overlays Electron ABI sqlite onto hashed Next copies", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-overlay-"));
  const standalone = path.join(tmp, "standalone");
  const hashed = path.join(
    standalone,
    ".next",
    "node_modules",
    "better-sqlite3-deadbeef",
    "build",
    "Release"
  );
  const top = path.join(standalone, "node_modules", "better-sqlite3", "build", "Release");
  fs.mkdirSync(hashed, { recursive: true });
  fs.mkdirSync(top, { recursive: true });
  fs.writeFileSync(path.join(hashed, "better_sqlite3.node"), "node20");
  fs.writeFileSync(path.join(top, "better_sqlite3.node"), "node20");

  const rebuilt = path.join(tmp, "rebuilt-better_sqlite3.node");
  fs.writeFileSync(rebuilt, "electron-abi");

  const afterPack = require(path.join(projectRoot, "electron", "after-pack.js"));
  const n = afterPack.overlaySqliteNativeAddon(standalone, rebuilt);
  assert.equal(n, 2);
  assert.equal(fs.readFileSync(path.join(hashed, "better_sqlite3.node"), "utf8"), "electron-abi");
  assert.equal(fs.readFileSync(path.join(top, "better_sqlite3.node"), "utf8"), "electron-abi");

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("afterPack flattens symlinked hashed sqlite dirs then overlays", () => {
  // Next standalone keeps hashed better-sqlite3-* dirs as symlinks. Dirent.isDirectory()
  // is false for those, so a walk that only descends real dirs skips them and the
  // packaged server later loads the workspace Node-ABI .node.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-symlink-"));
  const workspacePkg = path.join(tmp, "workspace-better-sqlite3");
  fs.mkdirSync(path.join(workspacePkg, "build", "Release"), { recursive: true });
  fs.writeFileSync(path.join(workspacePkg, "package.json"), '{"name":"better-sqlite3"}');
  fs.writeFileSync(
    path.join(workspacePkg, "build", "Release", "better_sqlite3.node"),
    "node-abi-127"
  );

  const standalone = path.join(tmp, "standalone");
  const hashedParent = path.join(standalone, ".next", "node_modules");
  fs.mkdirSync(hashedParent, { recursive: true });
  const hashed = path.join(hashedParent, "better-sqlite3-deadbeef");
  fs.symlinkSync(workspacePkg, hashed);

  const top = path.join(standalone, "node_modules", "better-sqlite3", "build", "Release");
  fs.mkdirSync(top, { recursive: true });
  fs.writeFileSync(path.join(top, "better_sqlite3.node"), "node-abi-127");

  const rebuilt = path.join(tmp, "rebuilt-better_sqlite3.node");
  fs.writeFileSync(rebuilt, "electron-abi");

  const afterPack = require(path.join(projectRoot, "electron", "after-pack.js"));
  const n = afterPack.overlaySqliteNativeAddon(standalone, rebuilt);
  assert.equal(n, 2);
  assert.equal(fs.lstatSync(hashed).isSymbolicLink(), false);
  assert.equal(
    fs.readFileSync(path.join(hashed, "build", "Release", "better_sqlite3.node"), "utf8"),
    "electron-abi"
  );
  assert.equal(fs.readFileSync(path.join(top, "better_sqlite3.node"), "utf8"), "electron-abi");
  assert.equal(
    fs.readFileSync(path.join(workspacePkg, "build", "Release", "better_sqlite3.node"), "utf8"),
    "node-abi-127",
    "workspace Node-ABI addon must not be overwritten through the symlink"
  );

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("afterPack copies lib/*.js into app.asar.unpacked", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lib-unpacked-"));
  const appPath = path.join(tmp, "Transcriber.app");
  const afterPack = require(path.join(projectRoot, "electron", "after-pack.js"));
  afterPack.copyLibJsIntoUnpacked(appPath);
  const dest = path.join(
    appPath,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "lib",
    "local-api-token.js"
  );
  assert.ok(fs.existsSync(dest));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("tray template PNGs exist and are non-empty", () => {
  for (const name of ["trayTemplate.png", "trayTemplate@2x.png"]) {
    const pngPath = path.join(projectRoot, "electron", "resources", name);
    assert.ok(fs.existsSync(pngPath), `${name} should exist`);
    const buf = fs.readFileSync(pngPath);
    assert.ok(buf.length > 50, `${name} should not be empty`);
    assert.deepEqual(
      [...buf.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `${name} should be a PNG`
    );
  }
});

test("tray manager falls back to title T", () => {
  const trayPath = path.join(projectRoot, "electron", "tray-manager.js");
  const content = fs.readFileSync(trayPath, "utf8");
  assert.ok(content.includes("trayTemplate.png"));
  assert.ok(content.includes('setTitle("T")'));
  assert.ok(content.includes("Connect browser extension…"));
  assert.ok(content.includes("_openPairingWindow"));
  assert.ok(content.includes("Paired extensions…"));
  assert.ok(content.includes("Import existing library…"));
  assert.ok(content.includes("_showPairedExtensions"));
});

test("installer validates extension IDs when loading extension-ids.json", () => {
  const installerPath = path.join(projectRoot, "electron", "native-host-installer.js");
  const content = fs.readFileSync(installerPath, "utf8");
  assert.ok(content.includes("filterValidExtensionIds"));
});

test("extension manifest has no Chrome Web Store public key", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "extension", "manifest.json"), "utf8")
  );
  assert.equal(manifest.key, undefined);
});

test("Electron wrapper native host does not prepend Homebrew PATH", () => {
  const hostPath = path.join(projectRoot, "tools", "native-host", "transcriber-host.js");
  const content = fs.readFileSync(hostPath, "utf8");
  const brewIdx = content.indexOf('"/opt/homebrew/bin"');
  const guardIdx = content.indexOf("ELECTRON_RUN_AS_NODE");
  assert.ok(brewIdx > 0, "Homebrew prefix still listed for the dev path");
  assert.ok(guardIdx > 0 && guardIdx < brewIdx, "Homebrew prefixes must sit behind ELECTRON_RUN_AS_NODE");
});

test("packaged native host script path is app.asar.unpacked", () => {
  const { packagedNativeHostScriptPath } = require(path.join(
    projectRoot,
    "electron",
    "native-host-installer.js"
  ));
  const resolved = packagedNativeHostScriptPath("/App/Contents/Resources");
  assert.equal(
    resolved,
    "/App/Contents/Resources/app.asar.unpacked/tools/native-host/transcriber-host.js"
  );
  const installer = fs.readFileSync(
    path.join(projectRoot, "electron", "native-host-installer.js"),
    "utf8"
  );
  assert.ok(!installer.includes(', "app", "tools"'));
  const builder = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "electron-builder.json"), "utf8")
  );
  assert.ok(builder.asarUnpack.includes("tools/**/*"));
  assert.equal(builder.asarUnpack.includes("lib/**/*"), false);
  assert.equal(builder.asarUnpack.includes("node_modules/@prisma/**/*"), false);
  assert.ok(builder.files.includes("lib/**/*.js"));
});

test("CI launches the packaged Transcriber.app and checks asar requires", () => {
  const workflowPath = path.join(projectRoot, ".github", "workflows", "electron-build-macos.yml");
  const content = fs.readFileSync(workflowPath, "utf8");
  assert.match(content, /node-version:\s*['"]22['"]/);
  assert.ok(content.includes("asar list"));
  assert.ok(content.includes("assert-packaged-requires.js"));
  assert.ok(content.includes("Launch packaged Transcriber.app"));
  assert.ok(content.includes("Uncaught Exception"));
  assert.ok(content.includes("UnhandledPromiseRejectionWarning"));
  assert.ok(content.includes("packaged-launch health"));
  assert.ok(content.includes("@electron/fuses read"));
  assert.ok(content.includes("EnableNodeOptionsEnvironmentVariable"));
  assert.ok(content.includes("EnableNodeCliInspectArguments"));
  assert.ok(content.includes("fake Host header returns 421"));
  assert.ok(content.includes("Host: evil.example:19720"));
});

test("CI fails outbound app symlinks and non-Electron sqlite addons", () => {
  const workflowPath = path.join(projectRoot, ".github", "workflows", "electron-build-macos.yml");
  const content = fs.readFileSync(workflowPath, "utf8");
  assert.ok(content.includes("Assert no outbound app symlinks and Electron-ABI sqlite"));
  assert.ok(content.includes("symlink escapes Transcriber.app"));
  assert.ok(content.includes("no symlink resolves outside Transcriber.app"));
  assert.ok(content.includes("better_sqlite3.node Electron ABI"));
  assert.ok(content.includes("ELECTRON_RUN_AS_NODE=1"));
  assert.ok(content.includes("is not the Electron-ABI better_sqlite3.node"));
});

test("CI pings the packaged native host wrapper", () => {
  const workflowPath = path.join(projectRoot, ".github", "workflows", "electron-build-macos.yml");
  const content = fs.readFileSync(workflowPath, "utf8");
  assert.ok(content.includes("app.asar.unpacked/tools/native-host/transcriber-host.js"));
  assert.ok(content.includes("native-host ping"));
  assert.ok(content.includes('"cmd": "ping"'));
});

test("LOCAL background pairs via /api/native-host/pair then retries", () => {
  const bgPath = path.join(projectRoot, "extension", "background.js");
  const content = fs.readFileSync(bgPath, "utf8");
  assert.ok(content.includes("/api/native-host/pair"));
  assert.ok(content.includes("requestNativeHostPairOnce"));
});

test("packaged server is spawned with IPC for pairing", () => {
  const serverPath = path.join(projectRoot, "electron", "server-manager.js");
  const content = fs.readFileSync(serverPath, "utf8");
  assert.ok(content.includes('"ipc"'));
  assert.ok(content.includes('emit("spawned"'));
});

test("native host install uses Notification not displayBalloon on macOS", () => {
  const trayPath = path.join(projectRoot, "electron", "tray-manager.js");
  const content = fs.readFileSync(trayPath, "utf8");
  assert.ok(content.includes("new Notification"));
  assert.ok(content.includes("showMessageBox"));
  assert.match(content, /win32[\s\S]*displayBalloon/);
});
