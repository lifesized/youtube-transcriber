#!/usr/bin/env node
/**
 * Chrome Native Messaging host for Transcriber.
 *
 * Protocol: stdin/stdout framed messages — 4-byte little-endian length prefix
 * followed by UTF-8 JSON. https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
 *
 * Commands accepted (one per request, response has matching `id`):
 *   { id, cmd: "ping" }
 *   { id, cmd: "probe" }    → { status: "ready"|"foreign"|"down", port, identity? }
 *   { id, cmd: "start" }    → { started: true, pid } | { started: false, reason }
 *   { id, cmd: "stop" }     → { stopped: bool }
 *   { id, cmd: "status" }   → { running: bool, pid?, uptimeMs?, projectRoot, port }
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");

const PORT = 19720;
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;
const IDENTITY_HEADER = "x-transcriber-service";

// Project root is two levels up from this file (tools/native-host/ → repo root).
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const STATE_DIR = (() => {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Transcriber");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || os.homedir(), "Transcriber");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "transcriber");
})();

const LOG_DIR = (() => {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Logs", "Transcriber");
  }
  return STATE_DIR;
})();

const STATE_FILE = path.join(STATE_DIR, "native-host-state.json");
const LOG_FILE = path.join(LOG_DIR, "native-host.log");

function ensureDirs() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(...args) {
  try {
    ensureDirs();
    const line = `[${new Date().toISOString()}] ${args.map((a) =>
      typeof a === "string" ? a : JSON.stringify(a)
    ).join(" ")}\n`;
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // Logging must never throw — Chrome treats stderr writes as errors.
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  ensureDirs();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function probeOnce(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: timeoutMs }, (res) => {
      const identity = res.headers[IDENTITY_HEADER];
      // Drain body so the socket closes cleanly.
      res.on("data", () => {});
      res.on("end", () => {
        if (identity) resolve({ status: "ready", identity, statusCode: res.statusCode });
        else resolve({ status: "foreign", statusCode: res.statusCode });
      });
    });
    req.on("error", () => resolve({ status: "down" }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: "down" });
    });
  });
}

async function probeWithRetry(attempts, intervalMs) {
  for (let i = 0; i < attempts; i++) {
    const r = await probeOnce();
    if (r.status === "ready") return r;
    if (r.status === "foreign") return r;
    if (i < attempts - 1) await new Promise((r2) => setTimeout(r2, intervalMs));
  }
  return { status: "down" };
}

async function startServer() {
  // First check if something is already on the port.
  const probe = await probeOnce(800);
  if (probe.status === "ready") {
    return { started: false, reason: "already_running" };
  }
  if (probe.status === "foreign") {
    return { started: false, reason: "port_conflict" };
  }

  // Launch detached so the server keeps running after the host exits.
  // Use shell to resolve `npm` from PATH the same way a Terminal would.
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npmCmd, ["run", "dev"], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();

  const startedAt = Date.now();
  writeState({ pid: child.pid, startedAt, projectRoot: PROJECT_ROOT });
  log("spawned dev server", { pid: child.pid, cwd: PROJECT_ROOT });

  return { started: true, pid: child.pid, startedAt };
}

function stopServer() {
  const state = readState();
  if (!state.pid || !isPidAlive(state.pid)) {
    writeState({});
    return { stopped: false, reason: "not_running" };
  }
  try {
    // Negative PID kills the whole process group (npm + next).
    process.kill(-state.pid, "SIGTERM");
  } catch (e) {
    try { process.kill(state.pid, "SIGTERM"); } catch {}
  }
  writeState({});
  log("stopped dev server", { pid: state.pid });
  return { stopped: true, pid: state.pid };
}

function getStatus() {
  const state = readState();
  const running = isPidAlive(state.pid);
  return {
    running,
    pid: running ? state.pid : undefined,
    uptimeMs: running && state.startedAt ? Date.now() - state.startedAt : undefined,
    projectRoot: PROJECT_ROOT,
    port: PORT,
  };
}

// --- Native messaging framing ---------------------------------------------

function writeMessage(obj) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([len, json]));
}

let inBuf = Buffer.alloc(0);

async function handleMessage(msg) {
  const id = msg && msg.id;
  const cmd = msg && msg.cmd;
  log("recv", { id, cmd });
  try {
    switch (cmd) {
      case "ping":
        return { id, ok: true, pong: true };
      case "probe": {
        const r = await probeWithRetry(1, 0);
        return { id, ok: true, ...r, port: PORT };
      }
      case "start": {
        const r = await startServer();
        if (!r.started) return { id, ok: false, ...r };
        // Wait briefly for the server to come up so the UI can transition.
        const ready = await probeWithRetry(20, 750);
        return { id, ok: ready.status === "ready", ...r, probe: ready };
      }
      case "stop":
        return { id, ok: true, ...stopServer() };
      case "status":
        return { id, ok: true, ...getStatus() };
      default:
        return { id, ok: false, error: "unknown_cmd", cmd };
    }
  } catch (e) {
    log("error", { cmd, message: e.message });
    return { id, ok: false, error: e.message };
  }
}

process.stdin.on("data", async (chunk) => {
  inBuf = Buffer.concat([inBuf, chunk]);
  while (inBuf.length >= 4) {
    const len = inBuf.readUInt32LE(0);
    if (inBuf.length < 4 + len) break;
    const json = inBuf.slice(4, 4 + len).toString("utf8");
    inBuf = inBuf.slice(4 + len);
    let msg;
    try {
      msg = JSON.parse(json);
    } catch (e) {
      writeMessage({ ok: false, error: "bad_json" });
      continue;
    }
    const reply = await handleMessage(msg);
    writeMessage(reply);
  }
});

process.stdin.on("end", () => {
  log("stdin closed, exiting");
  process.exit(0);
});

process.on("uncaughtException", (e) => {
  log("uncaughtException", e.stack || e.message);
  process.exit(1);
});

log("native host started", { node: process.version, root: PROJECT_ROOT });
