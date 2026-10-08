/**
 * Dev native host Start runs `npm run dev` from the recorded project root,
 * never from the checkout the host script lives in, and refuses with
 * bad_project_root when that root is unset or not a usable Transcriber tree.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hostScript = path.join(repoRoot, "tools/native-host/transcriber-host.js");
const host = require(hostScript);
const projectRoot = require(path.join(repoRoot, "tools/native-host/project-root.js"));

const MARKER = "started-cwd.txt";

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeProject({
  name = "youtube-transcriber",
  dev = `node -e "require('fs').writeFileSync('${MARKER}', process.cwd())"`,
  nodeModules = true,
  prisma = true,
} = {}) {
  const root = path.join(tmp("ytt-root-"), "transcriber-local");
  fs.mkdirSync(root, { recursive: true });
  const scripts = dev === null ? {} : { dev };
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name, scripts }));
  if (nodeModules) fs.mkdirSync(path.join(root, "node_modules"));
  if (nodeModules && prisma) {
    fs.mkdirSync(path.join(root, "node_modules", "@prisma", "client"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules", ".prisma", "client"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules", "@prisma", "client", "package.json"), "{}");
    fs.writeFileSync(path.join(root, "node_modules", ".prisma", "client", "schema.prisma"), "");
  }
  return fs.realpathSync(root);
}

function recordRoot(stateDir, value) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "native-host.json"),
    JSON.stringify({ projectRoot: value })
  );
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function withHostEnv(fn) {
  const keys = ["TRANSCRIBER_STATE_DIR", "TRANSCRIBER_LOG_DIR", "TRANSCRIBER_LOCAL_TOKEN", "PORT", "ELECTRON_RUN_AS_NODE"];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const stateDir = tmp("ytt-state-");
  process.env.TRANSCRIBER_STATE_DIR = stateDir;
  process.env.TRANSCRIBER_LOG_DIR = path.join(stateDir, "logs");
  process.env.PORT = String(await freePort());
  delete process.env.TRANSCRIBER_LOCAL_TOKEN;
  delete process.env.ELECTRON_RUN_AS_NODE;
  try {
    return await fn(stateDir);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function waitForFile(p, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (fs.existsSync(p) && fs.readFileSync(p, "utf8").length > 0) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function readState(stateDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir, "native-host-state.json"), "utf8"));
  } catch {
    return {};
  }
}

test("Start runs npm run dev from the recorded root, not the host's checkout", async () => {
  const root = makeProject();
  await withHostEnv(async (stateDir) => {
    recordRoot(stateDir, root);
    const r = await host.startServer();
    assert.equal(r.started, true, JSON.stringify(r));
    assert.ok(await waitForFile(path.join(root, MARKER)), "dev script did not run in the root");
    assert.equal(fs.realpathSync(fs.readFileSync(path.join(root, MARKER), "utf8")), root);
    assert.equal(fs.existsSync(path.join(repoRoot, MARKER)), false);
    assert.equal(readState(stateDir).projectRoot, root);
  });
});

test("resolveStartLaunch uses the recorded root as cwd", async () => {
  const root = makeProject();
  await withHostEnv(async (stateDir) => {
    recordRoot(stateDir, root);
    const r = host.resolveStartLaunch({}, "/opt/node/bin/node", stateDir);
    assert.equal(r.ok, true);
    assert.equal(r.launch.cwd, root);
    assert.equal(r.launch.command, path.join("/opt/node/bin", "npm"));
    assert.deepEqual(r.launch.args, ["run", "dev"]);
  });
});

const refusals = [
  ["not set", () => null, "not_set"],
  ["empty", () => "", "empty"],
  ["whitespace", () => "   ", "empty"],
  ["relative", () => "transcriber-local", "not_absolute"],
  ["missing", () => path.join(tmp("ytt-gone-"), "nope"), "not_a_directory"],
  ["no package.json", () => tmp("ytt-empty-"), "no_package_json"],
  ["wrong package", () => makeProject({ name: "transcriber-beta-ext" }), "wrong_package"],
  ["no dev script", () => makeProject({ dev: null }), "no_dev_script"],
  ["no node_modules", () => makeProject({ nodeModules: false }), "no_node_modules"],
  ["no prisma client", () => makeProject({ prisma: false }), "no_prisma_client"],
];

for (const [label, makeValue, detail] of refusals) {
  test(`Start refuses a ${label} root with bad_project_root and spawns nothing`, async () => {
    await withHostEnv(async (stateDir) => {
      const value = makeValue();
      if (value !== null) recordRoot(stateDir, value);
      const r = await host.startServer();
      assert.deepEqual(r, { started: false, reason: "bad_project_root", detail });
      assert.equal(readState(stateDir).pid, undefined);
      if (value && fs.existsSync(path.join(String(value), "package.json"))) {
        await new Promise((res) => setTimeout(res, 300));
        assert.equal(fs.existsSync(path.join(value, MARKER)), false);
      }
    });
  });
}

test("a corrupt native-host.json is refused, never treated as the host's checkout", async () => {
  await withHostEnv(async (stateDir) => {
    fs.writeFileSync(path.join(stateDir, "native-host.json"), "{oops");
    const r = await host.startServer();
    assert.equal(r.reason, "bad_project_root");
    assert.equal(r.detail, "empty");
  });
});

test("the wire start command returns bad_project_root without waiting for health", async () => {
  const stateDir = tmp("ytt-state-");
  recordRoot(stateDir, "");
  const env = {
    ...process.env,
    TRANSCRIBER_STATE_DIR: stateDir,
    TRANSCRIBER_LOG_DIR: path.join(stateDir, "logs"),
    PORT: String(await freePort()),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(process.execPath, [hostScript], { env, stdio: ["pipe", "pipe", "pipe"] });
  const json = Buffer.from(JSON.stringify({ id: "s1", cmd: "start" }));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  child.stdin.write(Buffer.concat([len, json]));
  child.stdin.end();
  const chunks = [];
  child.stdout.on("data", (c) => chunks.push(c));
  const started = Date.now();
  await new Promise((resolve) => child.on("close", resolve));
  const buf = Buffer.concat(chunks);
  const msg = JSON.parse(buf.subarray(4, 4 + buf.readUInt32LE(0)).toString("utf8"));
  assert.equal(msg.id, "s1");
  assert.equal(msg.ok, false);
  assert.equal(msg.reason, "bad_project_root");
  assert.equal(msg.detail, "empty");
  assert.ok(Date.now() - started < 5000, "refusal must not wait for health polling");
});

test("status reports the recorded root and whether Start can use it", async () => {
  const root = makeProject();
  const stateDir = tmp("ytt-state-");
  recordRoot(stateDir, root);
  const prev = process.env.TRANSCRIBER_STATE_DIR;
  process.env.TRANSCRIBER_STATE_DIR = stateDir;
  try {
    const status = host.getStatus();
    assert.equal(status.projectRoot, root);
    assert.equal(status.projectRootOk, true);
    recordRoot(stateDir, "/definitely/not/here");
    assert.equal(host.getStatus().projectRootOk, false);
  } finally {
    if (prev === undefined) delete process.env.TRANSCRIBER_STATE_DIR;
    else process.env.TRANSCRIBER_STATE_DIR = prev;
  }
});

test("the app host ignores any recorded root and still launches the bundle", () => {
  const stateDir = tmp("ytt-app-state-");
  recordRoot(stateDir, "");
  const bundle = path.join(tmp("ytt-app-"), "Transcriber.app");
  fs.mkdirSync(path.join(bundle, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(
    path.join(bundle, "Contents", "Info.plist"),
    "<plist><dict><key>CFBundleIdentifier</key><string>com.transcribed.app</string></dict></plist>"
  );
  const r = host.resolveStartLaunch(
    { ELECTRON_RUN_AS_NODE: "1" },
    path.join(bundle, "Contents", "MacOS", "Transcriber"),
    stateDir
  );
  assert.equal(r.ok, true);
  assert.equal(r.launch.command, "/usr/bin/open");
  assert.deepEqual(r.launch.args, ["-a", bundle]);
  assert.equal(r.launch.cwd, undefined);
});

test("validateProjectRoot accepts this checkout once npm ci has run", () => {
  const r = projectRoot.validateProjectRoot(repoRoot);
  assert.equal(r.ok, true, JSON.stringify(r));
});
