/**
 * Basic smoke tests for Electron setup.
 * 
 * These tests verify the structure and basic functionality
 * without actually launching Electron (which requires a display).
 */

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  assert.ok(content.includes("ffmpeg.martin-riedl.de"));
  assert.ok(!content.includes("brew install ffmpeg"));
  assert.ok(content.includes("otool -L"));
  assert.ok(content.includes("/opt/homebrew"));
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
