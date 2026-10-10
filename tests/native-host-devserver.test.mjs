/**
 * Dev-server Start: closed vs hung vs healthy, identity-checked kill,
 * and a detached spawn that outlives the host.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = require(path.join(repoRoot, "tools/native-host/transcriber-host.js"));

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

async function withHostEnv(fn, port) {
  const keys = ["TRANSCRIBER_STATE_DIR", "TRANSCRIBER_LOG_DIR", "TRANSCRIBER_LOCAL_TOKEN", "PORT", "ELECTRON_RUN_AS_NODE"];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const stateDir = tmp("ytt-ds-state-");
  process.env.TRANSCRIBER_STATE_DIR = stateDir;
  process.env.TRANSCRIBER_LOG_DIR = path.join(stateDir, "logs");
  process.env.PORT = String(port ?? (await freePort()));
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

function listenHung(port) {
  const srv = net.createServer(() => {
    /* accept TCP, never speak HTTP */
  });
  return new Promise((resolve, reject) => {
    srv.listen(port, "127.0.0.1", () => resolve(srv));
    srv.on("error", reject);
  });
}

function listenHealthy(port) {
  const srv = http.createServer((_req, res) => {
    res.writeHead(200, { "X-Transcriber-Service": "1" });
    res.end(JSON.stringify({ status: "ok" }));
  });
  return new Promise((resolve, reject) => {
    srv.listen(port, "127.0.0.1", () => resolve(srv));
    srv.on("error", reject);
  });
}

test("looksLikeOurNextDev requires this repo path plus next/npm", () => {
  const root = "/Users/james/transcriber-local";
  assert.equal(host.looksLikeOurNextDev(`node ${root}/node_modules/next/dist/bin/next dev`, root), true);
  assert.equal(host.looksLikeOurNextDev(`npm run dev`, "/other"), false);
  assert.equal(host.looksLikeOurNextDev(`node /other/node_modules/next/dist/bin/next dev`, root), false);
  assert.equal(
    host.looksLikeOurNextDev(`${root}/scripts/run-with-local-token.js next dev -p 19720`, root),
    true
  );
});

test("isOurRecordedServer requires pid + lstart + exe; launchd-like pids fail", () => {
  const live = host.inspectPid(process.pid);
  assert.ok(live, "can inspect this test process");
  assert.equal(
    host.isOurRecordedServer(process.pid, {
      pid: process.pid,
      startTime: "Thu Jan  1 00:00:00 1970",
      exe: live.exe,
      projectRoot: process.cwd(),
    }),
    false,
    "startTime mismatch"
  );
  assert.equal(
    host.isOurRecordedServer(process.pid, {
      pid: process.pid,
      startTime: live.startTime,
      exe: "not-this-exe",
      projectRoot: process.cwd(),
    }),
    false,
    "exe mismatch"
  );
  assert.equal(
    host.isOurRecordedServer(process.pid, null),
    false,
    "no recorded state (launchd / someone else)"
  );
  assert.equal(host.killOurRecordedServer(), false, "never kill without a verified record");
});

test("classifyPort tells closed, ready, and hung apart", async () => {
  assert.equal(host.HEALTH_TIMEOUT_MS, 3000);
  await withHostEnv(async () => {
    const closed = await host.classifyPort(200);
    assert.equal(closed.status, "closed");
  });
  const readyPort = await freePort();
  const healthy = await listenHealthy(readyPort);
  try {
    await withHostEnv(async () => {
      const r = await host.classifyPort(500);
      assert.equal(r.status, "ready");
    }, readyPort);
  } finally {
    healthy.close();
  }
  const hungPort = await freePort();
  const hung = await listenHung(hungPort);
  try {
    await withHostEnv(async () => {
      const started = Date.now();
      const r = await host.classifyPort(300);
      assert.equal(r.status, "hung");
      assert.ok(Date.now() - started < 2000, "hung classify must use the hard timeout");
      assert.ok(r.listenerPid === process.pid || r.listenerPid > 1);
    }, hungPort);
  } finally {
    hung.close();
  }
});

test("Start leaves a healthy listener alone (launchd / already running)", async () => {
  const port = await freePort();
  const healthy = await listenHealthy(port);
  try {
    await withHostEnv(async () => {
      const r = await host.startServer();
      assert.deepEqual(r, { started: false, reason: "already_running" });
    }, port);
  } finally {
    healthy.close();
  }
});

test("Start on a hung foreign listener returns port_stuck and does not kill", async () => {
  const port = await freePort();
  const hung = await listenHung(port);
  try {
    await withHostEnv(async () => {
      const r = await host.startServer();
      assert.equal(r.started, false);
      assert.equal(r.reason, "port_stuck");
      assert.match(String(r.detail), /busy\/stuck/);
      assert.ok(r.pid === process.pid || Number.isInteger(r.pid));
      assert.equal(hung.listening, true, "must not kill a listener we did not spawn");
    }, port);
  } finally {
    hung.close();
  }
});

test("detached Start records pid/startTime/exe and writes a 0600 log", async () => {
  const root = path.join(tmp("ytt-ds-root-"), "transcriber-local");
  fs.mkdirSync(path.join(root, "node_modules", "@prisma", "client"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules", ".prisma", "client"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "@prisma", "client", "package.json"), "{}");
  fs.writeFileSync(path.join(root, "node_modules", ".prisma", "client", "schema.prisma"), "");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "youtube-transcriber",
      scripts: { dev: "node -e \"setTimeout(()=>{},30000)\"" },
    })
  );
  await withHostEnv(async (stateDir) => {
    fs.writeFileSync(
      path.join(stateDir, "native-host.json"),
      JSON.stringify({ projectRoot: root })
    );
    const r = await host.startServer();
    try {
      assert.equal(r.started, true, JSON.stringify(r));
      const state = JSON.parse(fs.readFileSync(path.join(stateDir, "native-host-state.json"), "utf8"));
      assert.equal(state.pid, r.pid);
      assert.ok(state.startTime, "ps lstart");
      assert.ok(state.exe, "ps comm");
      assert.equal(state.projectRoot, root);
      const log = host.devServerLogFile();
      assert.equal(fs.existsSync(log), true);
      assert.equal(fs.statSync(log).mode & 0o777, 0o600);
      const src = fs.readFileSync(
        path.join(repoRoot, "tools/native-host/transcriber-host.js"),
        "utf8"
      );
      assert.match(src, /detached:\s*true/);
      assert.match(src, /child\.unref\(\)/);
      assert.match(src, /dev-server\.log/);
    } finally {
      if (r.pid) {
        try {
          process.kill(-r.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
  });
});
