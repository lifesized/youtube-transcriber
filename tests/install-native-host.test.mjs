/**
 * Dev native host installer (com.transcribed.host): strict flags, the
 * recorded project root, and the getLocalToken allowlist in
 * Transcriber/extension-ids.json kept in sync with the manifest.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(repoRoot, "scripts/install-native-host.js");
const { parseArgs } = require(installer);
const config = require(path.join(repoRoot, "electron/config.js"));
const NativeHostInstaller = require(path.join(repoRoot, "electron/native-host-installer.js"));

const ID_A = "anljcbphpklbdpafhjmnceblbabnhdjh";
const ID_B = "abcdefghijklmnopabcdefghijklmnop";

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function devStateDir(home) {
  return process.platform === "darwin"
    ? path.join(home, "Library", "Application Support", "Transcriber")
    : path.join(home, ".config", "transcriber");
}

function appStateDir(home) {
  return process.platform === "darwin"
    ? path.join(home, "Library", "Application Support", "Transcriber App")
    : path.join(home, ".config", "transcriber-app");
}

function manifestPath(home) {
  const dir =
    process.platform === "darwin"
      ? path.join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts")
      : path.join(home, ".config", "google-chrome", "NativeMessagingHosts");
  return path.join(dir, "com.transcribed.host.json");
}

function makeProject(name = "youtube-transcriber") {
  const root = path.join(tmp("ytt-root-"), "transcriber-local");
  fs.mkdirSync(path.join(root, "node_modules", "@prisma", "client"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules", ".prisma", "client"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name, scripts: { dev: "next dev" } })
  );
  fs.writeFileSync(path.join(root, "node_modules", "@prisma", "client", "package.json"), "{}");
  fs.writeFileSync(path.join(root, "node_modules", ".prisma", "client", "schema.prisma"), "");
  return root;
}

function run(args, { home = tmp("ytt-home-"), env = {} } = {}) {
  const childEnv = { ...process.env, HOME: home, ...env };
  delete childEnv.XDG_CONFIG_HOME;
  delete childEnv.EXTENSION_ID;
  if (!("TRANSCRIBER_STATE_DIR" in env)) delete childEnv.TRANSCRIBER_STATE_DIR;
  const r = spawnSync(process.execPath, [installer, ...args], { env: childEnv, encoding: "utf8" });
  const stateDir = devStateDir(home);
  return {
    ...r,
    home,
    stateDir,
    rootConfig: path.join(stateDir, "native-host.json"),
    idsPath: path.join(stateDir, "extension-ids.json"),
    manifest: manifestPath(home),
  };
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function origins(manifestFile) {
  return readJson(manifestFile).allowed_origins;
}

// --- flags ----------------------------------------------------------------

test("parseArgs reads --project-root in both forms and --clear-project-root", () => {
  assert.equal(parseArgs(["--project-root=/a/b"], {}).projectRoot, "/a/b");
  assert.equal(parseArgs(["--project-root", "/a/b"], {}).projectRoot, "/a/b");
  assert.equal(parseArgs(["--clear-project-root"], {}).clearProjectRoot, true);
  const full = parseArgs([`--ext-id=${ID_A}`, "--project-root", "/x", "--replace"], {});
  assert.deepEqual(full.ids, [ID_A]);
  assert.equal(full.projectRoot, "/x");
  assert.equal(full.replace, true);
});

test("unknown flags, positional args and missing values error instead of being ignored", () => {
  assert.throws(() => parseArgs(["--projectroot=/x"], {}), /Unknown option: --projectroot=\/x/);
  assert.throws(() => parseArgs(["--root", "/x"], {}), /Unknown option: --root/);
  assert.throws(() => parseArgs(["/x"], {}), /Unknown option: \/x/);
  assert.throws(() => parseArgs(["--project-root"], {}), /Missing value for --project-root/);
  assert.throws(() => parseArgs(["--project-root="], {}), /Missing value for --project-root/);
  assert.throws(() => parseArgs(["--ext-id", "--remove"], {}), /Missing value for --ext-id/);
  assert.throws(
    () => parseArgs(["--project-root=/a", "--clear-project-root"], {}),
    /not both/
  );
});

test("CLI exits non-zero on an unknown flag and writes nothing", () => {
  const project = makeProject();
  const r = run([`--ext-id=${ID_A}`, `--projectroot=${project}`]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Unknown option: --projectroot=/);
  assert.equal(fs.existsSync(r.stateDir), false);
  assert.equal(fs.existsSync(r.manifest), false);
});

// --- project root ---------------------------------------------------------

test("--project-root is persisted to native-host.json with mode 0600", () => {
  const project = makeProject();
  const r = run([`--ext-id=${ID_A}`, `--project-root=${project}`]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readJson(r.rootConfig), { projectRoot: project });
  assert.equal(fs.statSync(r.rootConfig).mode & 0o777, 0o600);
  assert.match(r.stdout, /Start runs npm run dev from: /);
  assert.ok(r.stdout.includes("transcriber-local"));
  const manifest = readJson(r.manifest);
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${ID_A}/`]);
});

test("--project-root alone saves the root without touching the manifest", () => {
  const project = makeProject();
  const r = run(["--project-root", project]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Native host project root saved/);
  assert.deepEqual(readJson(r.rootConfig), { projectRoot: project });
  assert.equal(fs.existsSync(r.manifest), false);
});

test("--clear-project-root removes the recorded root", () => {
  const project = makeProject();
  const first = run(["--project-root", project]);
  assert.equal(fs.existsSync(first.rootConfig), true);
  const cleared = run(["--clear-project-root"], { home: first.home });
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.match(cleared.stdout, /Native host project root cleared/);
  assert.match(cleared.stdout, /Start is disabled: No project root is recorded/);
  assert.equal(fs.existsSync(first.rootConfig), false);
});

test("installer refuses empty, relative, missing and wrong-package roots", () => {
  const cases = [
    ["--project-root=   ", /empty/],
    ["--project-root=relative/checkout", /absolute/],
    [`--project-root=${path.join(tmp("ytt-gone-"), "nope")}`, /not an existing directory/],
    [`--project-root=${makeProject("some-other-app")}`, /package\.json name/],
  ];
  for (const [flag, message] of cases) {
    const r = run([flag]);
    assert.notEqual(r.status, 0, flag);
    assert.match(r.stderr, message, flag);
    assert.equal(fs.existsSync(r.rootConfig), false, flag);
  }
});

test("plain install keeps an existing recorded root", () => {
  const project = makeProject();
  const first = run(["--project-root", project]);
  const again = run([`--ext-id=${ID_A}`], { home: first.home });
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(readJson(first.rootConfig), { projectRoot: project });
});

// --- extension-ids.json allowlist -----------------------------------------

test("fresh install creates extension-ids.json with the ID, mode 0600", () => {
  const r = run([`--ext-id=${ID_A}`]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readJson(r.idsPath), [ID_A]);
  assert.equal(fs.statSync(r.idsPath).mode & 0o777, 0o600);
  assert.deepEqual(origins(r.manifest), [`chrome-extension://${ID_A}/`]);
  assert.deepEqual(
    fs.readdirSync(r.stateDir).filter((n) => n.endsWith(".tmp")),
    [],
    "no temp files left behind"
  );
});

test("re-running the same install is idempotent", () => {
  const first = run([`--ext-id=${ID_A}`]);
  const before = fs.readFileSync(first.idsPath, "utf8");
  const again = run([`--ext-id=${ID_A}`], { home: first.home });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(fs.readFileSync(first.idsPath, "utf8"), before);
  assert.deepEqual(origins(first.manifest), [`chrome-extension://${ID_A}/`]);
});

test("a second ID is appended to both the allowlist and the manifest", () => {
  const first = run([`--ext-id=${ID_A}`]);
  const second = run([`--ext-id=${ID_B}`], { home: first.home });
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(readJson(first.idsPath), [ID_A, ID_B]);
  assert.deepEqual(origins(first.manifest), [
    `chrome-extension://${ID_A}/`,
    `chrome-extension://${ID_B}/`,
  ]);
});

test("existing hand-made allowlist entries are kept and synced into the manifest", () => {
  const home = tmp("ytt-home-");
  fs.mkdirSync(devStateDir(home), { recursive: true });
  fs.writeFileSync(path.join(devStateDir(home), "extension-ids.json"), JSON.stringify([ID_B]));
  const r = run([`--ext-id=${ID_A}`], { home });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readJson(r.idsPath), [ID_B, ID_A]);
  assert.deepEqual(origins(r.manifest), [
    `chrome-extension://${ID_B}/`,
    `chrome-extension://${ID_A}/`,
  ]);
});

test("--remove --ext-id takes only that ID out of both", () => {
  const first = run([`--ext-id=${ID_A}`, `--ext-id=${ID_B}`]);
  const removed = run(["--remove", `--ext-id=${ID_B}`], { home: first.home });
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(readJson(first.idsPath), [ID_A]);
  assert.deepEqual(origins(first.manifest), [`chrome-extension://${ID_A}/`]);
  assert.equal(fs.statSync(first.idsPath).mode & 0o777, 0o600);

  const last = run(["--remove", `--ext-id=${ID_A}`], { home: first.home });
  assert.equal(last.status, 0, last.stderr);
  assert.deepEqual(readJson(first.idsPath), []);
  assert.equal(fs.existsSync(first.manifest), false);
});

test("--remove without an ID removes the manifest and its IDs from the allowlist", () => {
  const first = run([`--ext-id=${ID_A}`]);
  const removed = run(["--remove"], { home: first.home });
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(first.manifest), false);
  assert.deepEqual(readJson(first.idsPath), []);
});

test("an invalid extension ID is rejected and nothing is written", () => {
  for (const bad of ["ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP", "abc", "zbcdefghijklmnopabcdefghijklmnop"]) {
    const r = run([`--ext-id=${bad}`]);
    assert.notEqual(r.status, 0, bad);
    assert.match(r.stderr, /Invalid extension ID/, bad);
    assert.equal(fs.existsSync(r.idsPath), false, bad);
    assert.equal(fs.existsSync(r.manifest), false, bad);
  }
});

test("a damaged allowlist is never overwritten", () => {
  const home = tmp("ytt-home-");
  fs.mkdirSync(devStateDir(home), { recursive: true });
  const idsPath = path.join(devStateDir(home), "extension-ids.json");
  fs.writeFileSync(idsPath, "{not json");
  const r = run([`--ext-id=${ID_A}`], { home });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not a JSON array of extension IDs/);
  assert.equal(fs.readFileSync(idsPath, "utf8"), "{not json");
  assert.equal(fs.existsSync(r.manifest), false);
});

// --- dev vs app separation ------------------------------------------------

test("dev installer never writes the app's Transcriber App state", () => {
  const r = run([`--ext-id=${ID_A}`]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(appStateDir(r.home)), false);

  const home = tmp("ytt-home-");
  const pinned = run([`--ext-id=${ID_A}`], {
    home,
    env: { TRANSCRIBER_STATE_DIR: appStateDir(home) },
  });
  assert.notEqual(pinned.status, 0);
  assert.match(pinned.stderr, /Refusing to write the dev native host config into the app state dir/);
  assert.equal(fs.existsSync(appStateDir(home)), false);
  assert.equal(fs.existsSync(pinned.manifest), false);
});

test("app installer writes Transcriber App/extension-ids.json and never the dev file", () => {
  const home = tmp("ytt-home-");
  const prev = {
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    TRANSCRIBER_STATE_DIR: process.env.TRANSCRIBER_STATE_DIR,
  };
  try {
    process.env.HOME = home;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.TRANSCRIBER_STATE_DIR;

    const app = new NativeHostInstaller({ browsers: [] });
    assert.equal(app.stateDir, config.resolveAppStateDir());
    assert.equal(app.stateDir, appStateDir(home));
    app.appendExtensionId(ID_A);
    const appIds = path.join(appStateDir(home), "extension-ids.json");
    assert.deepEqual(readJson(appIds), [ID_A]);
    assert.equal(fs.statSync(appIds).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(path.join(devStateDir(home), "extension-ids.json")), false);

    const hijack = new NativeHostInstaller({ browsers: [], stateDir: devStateDir(home) });
    assert.throws(() => hijack.appendExtensionId(ID_B), /checkout state dir/);
    assert.equal(fs.existsSync(path.join(devStateDir(home), "extension-ids.json")), false);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
