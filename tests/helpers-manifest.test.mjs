import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helpers = require(path.join(root, "electron/helpers.js"));

function tmp() {
  const dir = path.join(tmpdir(), `helpers-manifest-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("validateManifest accepts a strict relative executable and rejects traversal", () => {
  const ok = helpers.validateManifest(
    { id: "notes", displayName: "Notes", executable: "bin/helper", version: "1.0.0" },
    "notes"
  );
  assert.equal(ok.ok, true);
  assert.equal(helpers.validateManifest({ id: "notes", displayName: "Notes", executable: "../evil", version: "1" }, "notes").ok, false);
  assert.equal(helpers.validateManifest({ id: "notes", displayName: "Notes", executable: "/bin/sh", version: "1" }, "notes").ok, false);
  assert.equal(helpers.validateManifest({ id: "other", displayName: "Notes", executable: "bin/helper", version: "1" }, "notes").ok, false);
  assert.equal(helpers.validateManifest({ id: "NOTES", displayName: "Notes", executable: "bin/helper", version: "1" }, "NOTES").ok, false);
  assert.equal(
    helpers.validateManifest({ id: "notes", displayName: "Notes\nBad", executable: "bin/helper", version: "1" }, "notes").ok,
    false
  );
});

test("validateExecutable requires a user-owned, non-world-writable file inside the helper dir", () => {
  const dir = tmp();
  try {
    const helperDir = path.join(dir, "notes");
    mkdirSync(path.join(helperDir, "bin"), { recursive: true });
    const exe = path.join(helperDir, "bin", "helper");
    writeFileSync(exe, "#!/bin/sh\n");
    chmodSync(exe, 0o755);
    const uid = process.getuid();
    assert.equal(helpers.validateExecutable(helperDir, "bin/helper", uid).ok, true);
    assert.equal(helpers.validateExecutable(helperDir, "../escape", uid).ok, false);
    chmodSync(exe, 0o757);
    assert.equal(helpers.validateExecutable(helperDir, "bin/helper", uid).error, "world_writable");
    chmodSync(exe, 0o755);
    assert.equal(helpers.validateExecutable(helperDir, "bin/helper", uid + 1).error, "bad_owner");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discoverHelpers skips invalid dirs and helperEnv never puts the token on argv", () => {
  const dir = tmp();
  try {
    const helperDir = path.join(dir, "notes");
    mkdirSync(path.join(helperDir, "bin"), { recursive: true });
    writeFileSync(path.join(helperDir, "bin", "helper"), "#!/bin/sh\n");
    chmodSync(path.join(helperDir, "bin", "helper"), 0o755);
    writeFileSync(
      path.join(helperDir, "manifest.json"),
      JSON.stringify({ id: "notes", displayName: "Notes", executable: "bin/helper", version: "1.2.3" })
    );
    mkdirSync(path.join(dir, "broken"), { recursive: true });
    const found = helpers.discoverHelpers({ helpersDir: dir, isPackaged: false, uid: process.getuid() });
    assert.equal(found.filter((row) => row.ok).length, 1);
    assert.equal(found.find((row) => row.ok).displayName, "Notes");
    const env = helpers.helperEnv("notes", "abc123token", "http://127.0.0.1:19721");
    assert.equal(env.TRANSCRIBER_HELPER_TOKEN, "abc123token");
    assert.equal(env.TRANSCRIBER_LOCAL_URL, "http://127.0.0.1:19721");
    assert.equal(env.TRANSCRIBER_LOCAL_TOKEN, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createHelperManager spawns with empty argv and stops without restart", () => {
  const dir = tmp();
  const stateDir = path.join(dir, "state");
  mkdirSync(stateDir, { recursive: true });
  const helperDir = path.join(stateDir, "helpers", "notes");
  mkdirSync(path.join(helperDir, "bin"), { recursive: true });
  writeFileSync(path.join(helperDir, "bin", "helper"), "#!/bin/sh\n");
  chmodSync(path.join(helperDir, "bin", "helper"), 0o755);
  writeFileSync(
    path.join(helperDir, "manifest.json"),
    JSON.stringify({ id: "notes", displayName: "Notes", executable: "bin/helper", version: "1.0.0" })
  );
  const spawned = [];
  const child = { kill() { this.killed = true; }, on() {} };
  const manager = helpers.createHelperManager({
    stateDir,
    helpersDir: path.join(stateDir, "helpers"),
    logDir: path.join(dir, "logs"),
    port: 19721,
    isPackaged: false,
    uid: process.getuid(),
    spawn: (exe, args, opts) => {
      spawned.push({ exe, args, env: opts.env, detached: opts.detached });
      return child;
    },
  });
  try {
    manager.start("notes");
    assert.equal(spawned.length, 1);
    assert.deepEqual(spawned[0].args, []);
    assert.equal(spawned[0].detached, true);
    assert.equal(spawned[0].env.TRANSCRIBER_HELPER_TOKEN.length >= 32, true);
    assert.equal(spawned[0].env.TRANSCRIBER_LOCAL_TOKEN, undefined);
    assert.equal(manager.listStatus()[0].state, "running");
    manager.stop("notes");
    assert.equal(child.killed, true);
    assert.equal(manager.listStatus()[0].state, "stopped");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
