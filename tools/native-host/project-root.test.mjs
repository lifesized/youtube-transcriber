import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  validateProjectRoot,
  resolveProjectRoot,
  writeProjectRootConfig,
  clearProjectRootConfig,
  precheckProjectRoot,
  resolveSqliteFilePath,
  getConfigPath,
} = require("./project-root.js");

function makeTmp(prefix = "nh-root-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeProject(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture" }) + "\n");
  return dir;
}

test("validateProjectRoot accepts an absolute dir with package.json", () => {
  const dir = makeProject(path.join(makeTmp(), "app"));
  const result = validateProjectRoot(dir);
  assert.equal(result.ok, true);
  assert.equal(result.projectRoot, path.resolve(dir));
});

test("validateProjectRoot rejects a relative path", () => {
  const result = validateProjectRoot("relative/checkout");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_absolute");
});

test("validateProjectRoot rejects a missing directory", () => {
  const missing = path.join(makeTmp(), "does-not-exist");
  const result = validateProjectRoot(missing);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_a_directory");
});

test("validateProjectRoot rejects a file that is not a directory", () => {
  const dir = makeTmp();
  const file = path.join(dir, "not-a-dir");
  fs.writeFileSync(file, "nope");
  const result = validateProjectRoot(file);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_a_directory");
});

test("validateProjectRoot rejects a directory without package.json", () => {
  const dir = makeTmp();
  const result = validateProjectRoot(dir);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_package_json");
});

test("resolveProjectRoot uses config when valid", () => {
  const stateDir = makeTmp();
  const project = makeProject(path.join(makeTmp(), "real"));
  const defaultRoot = makeProject(path.join(makeTmp(), "default"));
  writeProjectRootConfig(project, stateDir);
  const resolved = resolveProjectRoot({ stateDir, defaultRoot });
  assert.equal(resolved.projectRoot, path.resolve(project));
  assert.equal(resolved.projectRootSource, "config");
});

test("resolveProjectRoot falls back when config is relative", () => {
  const stateDir = makeTmp();
  const defaultRoot = makeProject(path.join(makeTmp(), "default"));
  fs.writeFileSync(
    getConfigPath(stateDir),
    JSON.stringify({ projectRoot: "./not-absolute" }) + "\n"
  );
  const resolved = resolveProjectRoot({ stateDir, defaultRoot });
  assert.equal(resolved.projectRoot, defaultRoot);
  assert.equal(resolved.projectRootSource, "default");
});

test("resolveProjectRoot falls back when config dir is missing", () => {
  const stateDir = makeTmp();
  const defaultRoot = makeProject(path.join(makeTmp(), "default"));
  fs.writeFileSync(
    getConfigPath(stateDir),
    JSON.stringify({ projectRoot: path.join(makeTmp(), "gone") }) + "\n"
  );
  const resolved = resolveProjectRoot({ stateDir, defaultRoot });
  assert.equal(resolved.projectRootSource, "default");
  assert.equal(resolved.projectRoot, defaultRoot);
});

test("resolveProjectRoot falls back when config file is missing", () => {
  const stateDir = makeTmp();
  const defaultRoot = "/default/checkout";
  const resolved = resolveProjectRoot({ stateDir, defaultRoot });
  assert.equal(resolved.projectRoot, defaultRoot);
  assert.equal(resolved.projectRootSource, "default");
});

test("resolveProjectRoot ignores extra keys and never treats them as a path", () => {
  const stateDir = makeTmp();
  const project = makeProject(path.join(makeTmp(), "real"));
  const defaultRoot = makeProject(path.join(makeTmp(), "default"));
  fs.writeFileSync(
    getConfigPath(stateDir),
    JSON.stringify({
      projectRoot: project,
      evil: "$(rm -rf /)",
      spawn: "curl http://evil.test",
    }) + "\n"
  );
  const resolved = resolveProjectRoot({ stateDir, defaultRoot });
  assert.equal(resolved.projectRoot, path.resolve(project));
  assert.equal(resolved.projectRootSource, "config");
});

test("precheck reports missing .env when neither env file exists", () => {
  const project = makeProject(path.join(makeTmp(), "app"));
  fs.mkdirSync(path.join(project, "node_modules"));
  const result = precheckProjectRoot(project);
  assert.equal(result.ok, false);
  assert.equal(result.started, false);
  assert.equal(result.reason, "project_not_configured");
  assert.deepEqual(result.missing, [".env"]);
});

test("precheck reports missing DATABASE_URL when .env has no key", () => {
  const project = makeProject(path.join(makeTmp(), "app"));
  fs.writeFileSync(path.join(project, ".env"), "WHISPER_CLI=/bin/true\n");
  fs.mkdirSync(path.join(project, "node_modules"));
  const result = precheckProjectRoot(project);
  assert.equal(result.reason, "project_not_configured");
  assert.deepEqual(result.missing, ["DATABASE_URL"]);
});

test("precheck reports missing sqlite file for file: DATABASE_URL", () => {
  const project = makeProject(path.join(makeTmp(), "app"));
  fs.writeFileSync(path.join(project, ".env"), 'DATABASE_URL="file:./prisma/dev.db"\n');
  fs.mkdirSync(path.join(project, "node_modules"));
  const result = precheckProjectRoot(project);
  assert.equal(result.reason, "project_not_configured");
  assert.deepEqual(result.missing, ["sqlite"]);
});

test("precheck ok when .env, sqlite file, and node_modules exist", () => {
  const project = makeProject(path.join(makeTmp(), "app"));
  fs.mkdirSync(path.join(project, "prisma"));
  fs.writeFileSync(path.join(project, "prisma", "dev.db"), "");
  fs.writeFileSync(path.join(project, ".env"), 'DATABASE_URL="file:./prisma/dev.db"\n');
  fs.mkdirSync(path.join(project, "node_modules"));
  const result = precheckProjectRoot(project);
  assert.deepEqual(result, { ok: true });
});

test("precheck accepts DATABASE_URL from .env.local and resolves sqlite relative to cwd", () => {
  const project = makeProject(path.join(makeTmp(), "app"));
  fs.writeFileSync(path.join(project, "library.db"), "");
  fs.writeFileSync(path.join(project, ".env.local"), "DATABASE_URL=file:./library.db\n");
  fs.mkdirSync(path.join(project, "node_modules"));
  const result = precheckProjectRoot(project);
  assert.deepEqual(result, { ok: true });
});

test("resolveSqliteFilePath matches cwd-relative Prisma file URLs", () => {
  const cwd = "/Users/james/Transcriber";
  assert.equal(
    resolveSqliteFilePath("file:./prisma/dev.db", cwd),
    path.resolve(cwd, "./prisma/dev.db")
  );
  assert.equal(
    resolveSqliteFilePath("file:./dev.db", cwd),
    path.resolve(cwd, "./dev.db")
  );
  assert.equal(resolveSqliteFilePath("file:/abs/lib.db", cwd), path.normalize("/abs/lib.db"));
  assert.equal(resolveSqliteFilePath("postgres://localhost/db", cwd), null);
});

test("writeProjectRootConfig writes atomically with mode 0600; clear removes it", () => {
  const stateDir = makeTmp();
  const project = makeProject(path.join(makeTmp(), "app"));
  const { configPath } = writeProjectRootConfig(project, stateDir);
  assert.equal(configPath, getConfigPath(stateDir));
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.deepEqual(parsed, { projectRoot: path.resolve(project) });
  assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
  assert.equal(fs.readdirSync(stateDir).filter((n) => n.includes(".tmp")).length, 0);

  const cleared = clearProjectRootConfig(stateDir);
  assert.equal(cleared.cleared, true);
  assert.equal(fs.existsSync(configPath), false);
});
