import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, closeSync, mkdirSync, symlinkSync, writeFileSync, rmSync, statSync } from "node:fs";
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
    assert.equal(helpers.validateExecutable(helperDir, "bin/helper", uid).error, "writable");
    chmodSync(exe, 0o775);
    assert.equal(helpers.validateExecutable(helperDir, "bin/helper", uid).error, "writable");
    chmodSync(exe, 0o755);
    assert.equal(helpers.validateExecutable(helperDir, "bin/helper", uid + 1).error, "bad_owner");
    const alias = path.join(dir, "alias-notes");
    symlinkSync(helperDir, alias);
    assert.equal(helpers.validateExecutable(alias, "bin/helper", uid).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discoverHelpers skips invalid dirs and helperEnv never puts the token on argv", () => {
  const dir = tmp();
  try {
    const helperDir = path.join(dir, "notes");
    mkdirSync(path.join(helperDir, "bin"), { recursive: true });
    chmodSync(helperDir, 0o755);
    writeFileSync(path.join(helperDir, "bin", "helper"), "#!/bin/sh\n");
    chmodSync(path.join(helperDir, "bin", "helper"), 0o755);
    writeFileSync(
      path.join(helperDir, "manifest.json"),
      JSON.stringify({ id: "notes", displayName: "Notes", executable: "bin/helper", version: "1.2.3" })
    );
    mkdirSync(path.join(dir, "broken"), { recursive: true });
    chmodSync(path.join(dir, "broken"), 0o775);
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
  chmodSync(helperDir, 0o755);
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
    assert.equal(manager.start("notes").error, "disabled");
    manager.enable("notes");
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

test("helper dirs that are group- or world-writable are refused", () => {
  const dir = tmp();
  try {
    const helperDir = path.join(dir, "notes");
    mkdirSync(helperDir, { recursive: true });
    chmodSync(helperDir, 0o775);
    assert.equal(helpers.validateHelperDir(helperDir, process.getuid()).error, "dir_writable");
    chmodSync(helperDir, 0o757);
    assert.equal(helpers.validateHelperDir(helperDir, process.getuid()).error, "dir_writable");
    chmodSync(helperDir, 0o755);
    assert.equal(helpers.validateHelperDir(helperDir, process.getuid()).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("manifest size and helper count are capped", () => {
  const dir = tmp();
  try {
    const big = path.join(dir, "notes");
    mkdirSync(big, { recursive: true });
    chmodSync(big, 0o755);
    writeFileSync(path.join(big, "manifest.json"), `${"x".repeat(helpers.MAX_MANIFEST_BYTES + 1)}`);
    assert.equal(helpers.readHelperDir(big, { uid: process.getuid(), isPackaged: false }).error, "manifest_too_large");

    const many = path.join(dir, "many");
    for (let i = 0; i < helpers.MAX_HELPERS + 2; i += 1) {
      const id = `h${i}`;
      const helperDir = path.join(many, id);
      mkdirSync(path.join(helperDir, "bin"), { recursive: true });
      chmodSync(helperDir, 0o755);
      writeFileSync(path.join(helperDir, "bin", "helper"), "#!/bin/sh\n");
      chmodSync(path.join(helperDir, "bin", "helper"), 0o755);
      writeFileSync(
        path.join(helperDir, "manifest.json"),
        JSON.stringify({ id, displayName: id, executable: "bin/helper", version: "1" })
      );
    }
    const found = helpers.discoverHelpers({ helpersDir: many, isPackaged: false, uid: process.getuid() });
    assert.equal(found.filter((row) => row.ok).length, helpers.MAX_HELPERS);
    assert.ok(found.some((row) => row.error === "helper_cap"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unpackaged autostart requires an explicit flag", () => {
  const dir = tmp();
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
  let spawned = 0;
  const child = { pid: 9, kill() {}, on() {} };
  try {
    const blocked = helpers.createHelperManager({
      stateDir,
      helpersDir: path.join(stateDir, "helpers"),
      logDir: path.join(dir, "logs-a"),
      isPackaged: false,
      autostart: false,
      uid: process.getuid(),
      spawn: () => {
        spawned += 1;
        return child;
      },
    });
    blocked.enable("notes");
    blocked.startEnabled();
    assert.equal(spawned, 0);
    const allowed = helpers.createHelperManager({
      stateDir,
      helpersDir: path.join(stateDir, "helpers"),
      logDir: path.join(dir, "logs-b"),
      isPackaged: false,
      autostart: true,
      uid: process.getuid(),
      spawn: () => {
        spawned += 1;
        return child;
      },
    });
    allowed.enable("notes");
    allowed.startEnabled();
    assert.equal(spawned, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("helper logs use a 0700 dir, skip symlinks, and rotate", () => {
  const dir = tmp();
  try {
    const logDir = path.join(dir, "logs");
    const file = helpers.helperLogPath("notes", logDir);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "x".repeat(1024 * 1024));
    const opened = helpers.openHelperLog("notes", logDir);
    assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
    assert.ok(statSync(`${file}.1`).isFile());
    assert.ok(statSync(file).isFile());
    closeSync(opened.fd);
    rmSync(file, { force: true });
    symlinkSync(path.join(dir, "elsewhere"), file);
    helpers.rotateHelperLog(file);
    try {
      statSync(file);
      assert.fail("symlink should be removed");
    } catch (error) {
      assert.equal(error.code, "ENOENT");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
