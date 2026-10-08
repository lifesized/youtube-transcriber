import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const installer = path.join(repoRoot, "scripts/install-native-host.js");

function makeTmp(prefix = "nh-install-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeProject() {
  const dir = path.join(makeTmp(), "app");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture" }) + "\n");
  return dir;
}

function runInstaller(args, { home } = {}) {
  const homeDir = home || makeTmp("nh-home-");
  const xdg = path.join(homeDir, "xdg");
  fs.mkdirSync(xdg, { recursive: true });
  const result = spawnSync(process.execPath, [installer, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: homeDir,
      XDG_CONFIG_HOME: xdg,
      EXTENSION_ID: "",
    },
  });
  return {
    ...result,
    homeDir,
    xdg,
    configPath: path.join(xdg, "transcriber", "native-host.json"),
  };
}

test("installer --project-root writes native-host.json and prints the root", () => {
  const project = makeProject();
  const result = runInstaller(["--project-root", project]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Native host project root saved/);
  assert.match(result.stdout, /Project root in effect:/);
  assert.match(result.stdout, /from config/);
  const parsed = JSON.parse(fs.readFileSync(result.configPath, "utf8"));
  assert.deepEqual(parsed, { projectRoot: path.resolve(project) });
  assert.equal(fs.statSync(result.configPath).mode & 0o777, 0o600);
  assert.equal(
    fs.existsSync(path.join(result.homeDir, ".config", "google-chrome", "NativeMessagingHosts")),
    false,
    "config-only install must not write the Chrome manifest"
  );
});

test("installer without --project-root leaves existing native-host.json untouched", () => {
  const project = makeProject();
  const first = runInstaller(["--project-root", project]);
  const before = fs.readFileSync(first.configPath, "utf8");
  const second = runInstaller([], { home: first.homeDir });
  assert.notEqual(second.status, 0);
  assert.equal(fs.readFileSync(first.configPath, "utf8"), before);
});

test("installer --clear-project-root removes native-host.json", () => {
  const project = makeProject();
  const first = runInstaller(["--project-root", project]);
  assert.equal(fs.existsSync(first.configPath), true);
  const cleared = runInstaller(["--clear-project-root"], { home: first.homeDir });
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.match(cleared.stdout, /Native host project root cleared/);
  assert.match(cleared.stdout, /default \(this checkout\)/);
  assert.equal(fs.existsSync(first.configPath), false);
});

test("installer --project-root rejects a relative path and writes nothing", () => {
  const result = runInstaller(["--project-root", "relative/checkout"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /absolute/i);
  assert.equal(fs.existsSync(result.configPath), false);
});
