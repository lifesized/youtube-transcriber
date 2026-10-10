import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helpers = require(path.join(root, "electron/helpers.js"));

const APP = "/Applications/Transcriber.app/Contents/MacOS/Transcriber";
const EXE = "/Users/me/Library/Application Support/Transcriber/helpers/notes/bin/helper";

function stub(appTeam, helperTeam, helperVerify = 0) {
  return (_bin, args) => {
    const target = args[args.length - 1];
    const isApp = String(target).includes("Transcriber.app");
    if (args[0] === "--verify") {
      if (isApp) return { status: appTeam ? 0 : 1, stdout: "", stderr: "" };
      return { status: helperVerify, stdout: "", stderr: helperVerify ? "unsigned" : "" };
    }
    if (isApp) {
      return { status: 0, stdout: "", stderr: appTeam ? `TeamIdentifier=${appTeam}\n` : "TeamIdentifier=not set\n" };
    }
    return {
      status: 0,
      stdout: "",
      stderr: helperTeam ? `TeamIdentifier=${helperTeam}\n` : "TeamIdentifier=not set\n",
    };
  };
}

test("unpackaged builds skip the Team ID gate", () => {
  assert.equal(
    helpers.signatureAllowed({
      isPackaged: false,
      appExecPath: APP,
      executable: EXE,
      run: stub("ABCD123456", "ZZZZZZZZZZ"),
    }).ok,
    true
  );
});

test("packaged builds fail closed unless the helper Team ID matches the app", () => {
  assert.equal(
    helpers.signatureAllowed({
      isPackaged: true,
      appExecPath: APP,
      executable: EXE,
      run: stub("ABCD123456", "ABCD123456"),
    }).ok,
    true
  );
  assert.equal(
    helpers.signatureAllowed({
      isPackaged: true,
      appExecPath: APP,
      executable: EXE,
      run: stub("ABCD123456", "ZZZZZZZZZZ"),
    }).error,
    "signature_mismatch"
  );
  assert.equal(
    helpers.signatureAllowed({
      isPackaged: true,
      appExecPath: APP,
      executable: EXE,
      run: stub("ABCD123456", "ABCD123456", 1),
    }).error,
    "signature_mismatch"
  );
  assert.equal(
    helpers.signatureAllowed({
      isPackaged: true,
      appExecPath: APP,
      executable: EXE,
      run: stub("", "ABCD123456"),
    }).error,
    "app_unsigned"
  );
  assert.equal(
    helpers.signatureAllowed({
      isPackaged: true,
      appExecPath: "/usr/local/bin/electron",
      executable: EXE,
      run: stub("ABCD123456", "ABCD123456"),
    }).error,
    "app_unsigned"
  );
});

test("running PID must satisfy codesign --verify --strict -R for the Team ID", () => {
  const ok = helpers.verifyRunningPid(4242, "ABCD123456", (_bin, args) => {
    assert.deepEqual(args.slice(0, 4), ["--verify", "--strict", "-R", helpers.teamIdRequirement("ABCD123456")]);
    assert.equal(args.includes("--pid"), true);
    assert.equal(args.at(-1), "4242");
    return { status: 0, stdout: "", stderr: "" };
  });
  assert.equal(ok, true);
  assert.equal(
    helpers.verifyRunningPid(4242, "ABCD123456", () => ({ status: 1, stdout: "", stderr: "mismatch" })),
    false
  );
});
