/**
 * Packaged app state must never land on the checkout host's paths.
 * James's Mac runs `npm run dev` (main) beside this app; both default
 * product/state names would otherwise share ~/Library/Application Support/Transcriber.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = require(path.join(repoRoot, "electron/config.js"));
const NativeHostInstaller = require(
  path.join(repoRoot, "electron/native-host-installer.js")
);
const tokenMod = require(path.join(repoRoot, "lib/local-api-token.js"));
const host = require(path.join(repoRoot, "tools/native-host/transcriber-host.js"));

const CHECKOUT_MANIFEST = "com.transcribed.host.json";
const HOME = "/Users/james";

function stringValues(obj) {
  return Object.entries(obj).filter(([, v]) => typeof v === "string");
}

function isInsideOrEqual(parent, child) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

test("app state paths never equal the checkout host's state paths", () => {
  const app = config.appStatePaths(HOME, "darwin");
  const checkout = config.checkoutStatePaths(HOME, "darwin");

  assert.equal(
    app.stateDir,
    path.join(HOME, "Library", "Application Support", "Transcriber App")
  );
  assert.equal(
    checkout.stateDir,
    path.join(HOME, "Library", "Application Support", "Transcriber")
  );
  assert.equal(app.userData, app.stateDir);
  assert.equal(app.nmhManifestFileName, "com.transcribed.app.host.json");
  assert.equal(checkout.nmhManifestFileName, CHECKOUT_MANIFEST);
  assert.notEqual(app.nmhManifestFileName, CHECKOUT_MANIFEST);
  assert.notEqual(config.nativeHostName, config.checkoutNativeHostName);

  for (const [appKey, appPath] of stringValues(app)) {
    for (const [devKey, devPath] of stringValues(checkout)) {
      assert.notEqual(
        appPath,
        devPath,
        `app.${appKey} must not equal checkout.${devKey} (${appPath})`
      );
    }
  }

  assert.equal(isInsideOrEqual(checkout.stateDir, app.stateDir), false);
  assert.equal(isInsideOrEqual(checkout.logDir, app.logDir), false);
  assert.equal(isInsideOrEqual(checkout.stateDir, app.token), false);
  assert.equal(isInsideOrEqual(checkout.stateDir, app.extensionIds), false);
  assert.equal(isInsideOrEqual(checkout.stateDir, app.nativeHostState), false);
  assert.equal(isInsideOrEqual(checkout.stateDir, app.nativeHostJson), false);
  assert.equal(isInsideOrEqual(checkout.stateDir, app.db), false);
  assert.equal(isInsideOrEqual(checkout.stateDir, app.backups), false);
  assert.equal(isInsideOrEqual(checkout.stateDir, app.secrets), false);
  assert.equal(isInsideOrEqual(checkout.stateDir, app.wrapper), false);
  assert.equal(isInsideOrEqual(checkout.logDir, app.nativeHostLog), false);
  assert.equal(isInsideOrEqual(checkout.stateDir, app.crashDumps), false);

  // Sibling names: "Transcriber App".startsWith("Transcriber") is true as a
  // string, but the directories are not nested.
  assert.ok(path.basename(app.stateDir).startsWith(path.basename(checkout.stateDir)));
  assert.equal(
    app.stateDir.startsWith(checkout.stateDir + path.sep),
    false
  );
});

test("getLogDir with Transcriber App state is not the checkout log dir", () => {
  const prevLog = process.env.TRANSCRIBER_LOG_DIR;
  try {
    delete process.env.TRANSCRIBER_LOG_DIR;
    const home = homedir();
    const plat = process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
    const appState = config.resolveAppStateDir(home, plat);
    const checkoutState = config.resolveCheckoutStateDir(home, plat);
    const appLog = tokenMod.getLogDir(appState);
    const checkoutLog = tokenMod.getLogDir(checkoutState);
    assert.notEqual(appState, checkoutState);
    assert.notEqual(appLog, checkoutLog);
    assert.equal(isInsideOrEqual(checkoutState, appState), false);
    assert.equal(isInsideOrEqual(checkoutLog, appLog), false);
    if (process.platform === "darwin") {
      assert.equal(checkoutLog, config.resolveCheckoutLogDir(home, "darwin"));
      assert.equal(appLog, config.resolveAppLogDir(home, "darwin"));
      assert.equal(typeof host.logDir, "function");
      assert.equal(typeof host.logFile, "function");
      assert.equal(typeof host.stateFile, "function");
      assert.equal(
        tokenMod.getLogDir(appState),
        path.join(home, "Library", "Logs", "Transcriber App")
      );
      assert.equal(
        tokenMod.getLogDir(checkoutState),
        path.join(home, "Library", "Logs", "Transcriber")
      );
    }
  } finally {
    if (prevLog === undefined) delete process.env.TRANSCRIBER_LOG_DIR;
    else process.env.TRANSCRIBER_LOG_DIR = prevLog;
  }
});

test("app installer never writes or unlinks com.transcribed.host.json", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ytt-nmh-manifest-"));
  const checkoutManifest = path.join(dir, CHECKOUT_MANIFEST);
  const appManifest = path.join(dir, "com.transcribed.app.host.json");
  const checkoutBody = '{"name":"com.transcribed.host","keep":true}\n';
  writeFileSync(checkoutManifest, checkoutBody);
  writeFileSync(appManifest, '{"name":"com.transcribed.app.host"}\n');
  try {
    const installer = new NativeHostInstaller({
      idsPath: path.join(dir, "extension-ids.json"),
      stateDir: dir,
      browsers: [{ name: "Chrome", manifestDir: dir }],
    });
    assert.equal(installer.hostName, "com.transcribed.app.host");
    assert.equal(
      installer._getManifestPath({ manifestDir: dir }),
      appManifest
    );
    assert.notEqual(path.basename(appManifest), CHECKOUT_MANIFEST);

    await installer.uninstall();
    assert.equal(readFileSync(checkoutManifest, "utf8"), checkoutBody);
    assert.equal(existsSync(appManifest), false);

    const hijack = new NativeHostInstaller({
      idsPath: path.join(dir, "extension-ids.json"),
      stateDir: dir,
      hostName: "com.transcribed.host",
      browsers: [{ name: "Chrome", manifestDir: dir }],
    });
    assert.throws(
      () => hijack._getManifestPath({ manifestDir: dir }),
      /checkout native-host manifest/
    );
    assert.throws(
      () => hijack._writeManifest(checkoutManifest, path.join(dir, "x.sh")),
      /checkout native-host manifest/
    );
    assert.equal(readFileSync(checkoutManifest, "utf8"), checkoutBody);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("electron main pins userData/logs off the checkout Transcriber dirs", () => {
  const main = readFileSync(path.join(repoRoot, "electron/main.js"), "utf8");
  assert.match(main, /function pinAppPaths\(/);
  assert.match(main, /app\.setPath\("userData", APP_STATE_DIR\)/);
  assert.match(main, /app\.setPath\("sessionData", APP_STATE_DIR\)/);
  assert.match(main, /app\.setPath\("logs", APP_LOG_DIR\)/);
  assert.match(main, /app\.setPath\("crashDumps"/);
  assert.match(main, /TRANSCRIBER_STATE_DIR = APP_STATE_DIR/);
  assert.match(main, /TRANSCRIBER_LOG_DIR = APP_LOG_DIR/);
  assert.match(main, /pinAppPaths\(\)/);
  assert.equal((main.match(/^\s*pinAppPaths\(\);$/gm) || []).length, 2);

  const pairing = readFileSync(
    path.join(repoRoot, "electron/pairing-bridge.js"),
    "utf8"
  );
  assert.doesNotMatch(pairing, /writeFile|mkdirSync|getStateDir/);

  const installerSrc = readFileSync(
    path.join(repoRoot, "electron/native-host-installer.js"),
    "utf8"
  );
  assert.doesNotMatch(installerSrc, /com\.transcribed\.host\.json/);
  assert.match(installerSrc, /\$\{this\.hostName\}\.json/);
  assert.match(installerSrc, /export TRANSCRIBER_LOG_DIR=/);
});

test("app-log creates ~/Library/Logs/Transcriber App/main.log and tees console", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ytt-app-log-"));
  const prevHome = process.env.HOME;
  process.env.HOME = dir;
  try {
    const appLog = require(path.join(repoRoot, "electron/app-log.js"));
    const expectedDir = config.resolveAppLogDir(dir);
    assert.equal(appLog.resolveLogDir(), expectedDir);
    const fake = {
      log: () => {},
      warn: () => {},
      error: () => {},
    };
    const file = appLog.install(fake);
    assert.equal(file, path.join(expectedDir, "main.log"));
    assert.equal(existsSync(file), true);
    fake.log("second-instance: revealing tray");
    const body = readFileSync(file, "utf8");
    assert.match(body, /file log opened/);
    assert.match(body, /second-instance: revealing tray/);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(dir, { recursive: true, force: true });
  }
});
