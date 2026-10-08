import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const host = require("../tools/native-host/transcriber-host.js");

test("Electron mode start launches the app by bundle id", () => {
  const launch = host.getStartLaunch({ ELECTRON_RUN_AS_NODE: "1" }, "/App/Transcriber");
  assert.equal(launch.command, "open");
  assert.deepEqual(launch.args, ["-b", "com.transcribed.app"]);
  assert.equal(host.ELECTRON_BUNDLE_ID, "com.transcribed.app");
});

test("non-Electron start still uses npm run dev next to execPath", () => {
  const launch = host.getStartLaunch({}, "/usr/local/bin/node");
  assert.equal(launch.command, path.join("/usr/local/bin", "npm"));
  assert.deepEqual(launch.args, ["run", "dev"]);
  assert.ok(launch.extraBins.includes("/opt/homebrew/bin"));
});

test("spawnDetached error handler keeps the process alive", async () => {
  const child = host.spawnDetached("definitely-not-a-binary-zzzz", [], {
    stdio: "ignore",
  });
  assert.ok(child.listenerCount("error") >= 1);
  const err = await new Promise((resolve) => {
    child.on("error", resolve);
  });
  assert.equal(err.code, "ENOENT");
});
