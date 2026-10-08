import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const launch = require(path.join(root, "lib", "launch-source.js"));
const host = require(path.join(root, "tools", "native-host", "transcriber-host.js"));

const EXE = "/Applications/Transcriber.app/Contents/MacOS/Transcriber";

test("a manual launch pops; Start at Login and native-host starts do not", () => {
  const manual = [EXE];
  const fromHost = [EXE, launch.NATIVE_HOST_LAUNCH_ARG];
  assert.equal(launch.shouldRevealOnLaunch({ openedAtLogin: false, argv: manual }), true);
  assert.equal(launch.shouldRevealOnLaunch({ openedAtLogin: true, argv: manual }), false);
  assert.equal(launch.shouldRevealOnLaunch({ openedAtLogin: false, argv: fromHost }), false);
  assert.equal(launch.shouldRevealOnLaunch({ openedAtLogin: true, argv: fromHost }), false);
});

test("the install helper's plain open counts as a manual launch", () => {
  const helper = fs.readFileSync(path.join(root, "electron", "dmg", "Install Transcriber.command"), "utf8");
  assert.match(helper, /open "\$dest"\n/);
  assert.equal(helper.includes(launch.NATIVE_HOST_LAUNCH_ARG), false);
  assert.equal(launch.shouldRevealOnLaunch({ openedAtLogin: false, argv: [EXE] }), true);
});

test("launchedByNativeHost only matches the exact argument", () => {
  assert.equal(launch.NATIVE_HOST_LAUNCH_ARG, "--launched-by=native-host");
  assert.equal(launch.launchedByNativeHost([EXE, "--launched-by=native-host"]), true);
  assert.equal(launch.launchedByNativeHost([EXE, "--launched-by=native-hostx"]), false);
  assert.equal(launch.launchedByNativeHost([EXE]), false);
  assert.equal(launch.launchedByNativeHost(undefined), false);
});

test("the app host's Start passes the native-host argument to open", () => {
  const l = host.getStartLaunch({ ELECTRON_RUN_AS_NODE: "1" }, EXE, "/Applications/Transcriber.app");
  assert.equal(l.command, "/usr/bin/open");
  assert.deepEqual(l.args, ["-a", "/Applications/Transcriber.app", "--args", "--launched-by=native-host"]);
});

test("main.js gates the launch pop and skips a native-host second instance", () => {
  const main = fs.readFileSync(path.join(root, "electron", "main.js"), "utf8");
  assert.ok(main.includes("app.getLoginItemSettings().wasOpenedAtLogin"));
  assert.match(main, /shouldRevealOnLaunch\(\{ openedAtLogin, argv: process\.argv \}\)/);
  assert.match(main, /if \(reveal\) \{\s*setImmediate\(\(\) => trayManager\.revealInMenuBar\(revealReason\)\);/);
  assert.ok(main.includes("launch reveal skipped"));
  assert.match(main, /app\.on\("second-instance", \(_event, argv\) => \{\s*if \(launchedByNativeHost\(argv\)\)/);
});
