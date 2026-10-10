import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helpers = require(path.join(root, "electron/helpers.js"));
const tokens = require(path.join(root, "lib/helper-tokens.js"));

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

test("signature mismatch kills the process group and revokes the token", () => {
  const dir = path.join(tmpdir(), `helper-pid-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const stateDir = path.join(dir, "state");
  mkdirSync(stateDir, { recursive: true });
  const helperDir = path.join(stateDir, "helpers", "notes");
  mkdirSync(path.join(helperDir, "bin"), { recursive: true });
  chmodSync(helperDir, 0o755);
  writeFileSync(path.join(helperDir, "bin", "helper"), "#!/bin/sh\n");
  chmodSync(path.join(helperDir, "bin", "helper"), 0o755);
  writeFileSync(
    path.join(helperDir, "manifest.json"),
    JSON.stringify({ id: "notes", displayName: "Notes", executable: "bin/helper", version: "1.0.0" })
  );
  const killed = [];
  let minted = "";
  const manager = helpers.createHelperManager({
    stateDir,
    helpersDir: path.join(stateDir, "helpers"),
    logDir: path.join(dir, "logs"),
    isPackaged: true,
    appExecPath: APP,
    uid: process.getuid(),
    run: (_bin, args) => {
      if (args.includes("--pid")) return { status: 1, stdout: "", stderr: "mismatch" };
      if (args[0] === "--verify") return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "TeamIdentifier=ABCD123456\n" };
    },
    killProcess: (pid, signal) => killed.push({ pid, signal }),
    spawn: (_exe, _args, opts) => {
      minted = opts.env.TRANSCRIBER_HELPER_TOKEN;
      return { pid: 7777, kill() {}, on() {} };
    },
  });
  try {
    manager.enable("notes");
    manager.start("notes");
    assert.equal(manager.listStatus()[0].state, "error");
    assert.equal(manager.listStatus()[0].error, "signature_mismatch");
    assert.deepEqual(killed, [{ pid: -7777, signal: "SIGTERM" }]);
    assert.equal(
      tokens.authorizeHelperFromStore(
        { authorization: `Bearer ${minted}` },
        { method: "GET", pathname: "/api/summaries", stateDir }
      ).ok,
      false
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
