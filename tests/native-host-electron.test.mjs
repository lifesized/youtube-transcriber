import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const host = require("../tools/native-host/transcriber-host.js");

test("Electron mode start launches the app by bundle id", () => {
  const launch = host.getStartLaunch(
    { ELECTRON_RUN_AS_NODE: "1" },
    "/App/Contents/MacOS/Transcriber"
  );
  assert.equal(launch.command, "open");
  assert.deepEqual(launch.args, ["-b", "com.transcribed.app"]);
  assert.equal(host.ELECTRON_BUNDLE_ID, "com.transcribed.app");
  assert.equal(
    launch.path,
    [
      path.join("/App/Contents/MacOS", "..", "Resources", "bin"),
      "/usr/bin",
      "/bin",
    ].join(path.delimiter)
  );
});

test("native host messages are capped at 1 MiB", () => {
  assert.equal(host.MAX_NATIVE_HOST_MESSAGE, 1024 * 1024);
});

test("non-Electron start still uses npm run dev next to execPath", () => {
  const launch = host.getStartLaunch({}, "/usr/local/bin/node");
  assert.equal(launch.command, path.join("/usr/local/bin", "npm"));
  assert.deepEqual(launch.args, ["run", "dev"]);
  assert.ok(launch.extraBins.includes("/opt/homebrew/bin"));
});

test("getLocalToken requires a paired caller origin on argv[1]", () => {
  const dir = require("node:fs").mkdtempSync(
    require("node:os").tmpdir() + "/ytt-nmh-ids-"
  );
  const idsPath = require("node:path").join(dir, "extension-ids.json");
  const paired = "abcdefghijklmnopabcdefghijklmnop";
  require("node:fs").writeFileSync(idsPath, JSON.stringify([paired]));
  try {
    assert.equal(
      host.parseCallerExtensionId(`chrome-extension://${paired}/`),
      paired
    );
    assert.equal(host.parseCallerExtensionId(`chrome-extension://${paired}`), paired);
    assert.equal(host.parseCallerExtensionId("/tmp/transcriber-host.js"), null);

    const allowed = host.authorizeNativeHostCaller(
      ["host", `chrome-extension://${paired}/`],
      { idsPath }
    );
    assert.equal(allowed.ok, true);

    const denied = host.replyGetLocalToken(
      "tok",
      ["host", "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"],
      { idsPath }
    );
    assert.equal(denied.ok, false);
    assert.equal(denied.error, "unauthorized_caller");
    assert.equal(denied._exit, true);

    const missing = host.replyGetLocalToken("tok", ["host", "/tmp/foo.js"], {
      idsPath,
    });
    assert.equal(missing.ok, false);
    assert.equal(missing._exit, true);

    const known = host.authorizeNativeHostCaller(
      ["host", "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/"],
      { idsPath, knownIds: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"] }
    );
    assert.equal(known.ok, true);
  } finally {
    require("node:fs").rmSync(dir, { recursive: true, force: true });
  }
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
