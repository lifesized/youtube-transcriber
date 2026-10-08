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
 *   { id, cmd: "getLocalToken" } → { token }  (loopback API Bearer; never log value)
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");
const {
  ensureLocalApiToken,
  ensureInEnv,
  getLocalApiTokenPath,
  getStateDir,
  ENV_NAME,
} = require("../../lib/local-api-token.js");
const {
  filterValidExtensionIds,
  KNOWN_STORE_EXTENSION_IDS,
} = require("../../lib/native-host-pair.js");
const { configuredPort } = require("../../lib/local-api-auth.js");

function getPort() {
  return configuredPort();
}

function healthUrl() {
  return `http://127.0.0.1:${getPort()}/api/health`;
}
const IDENTITY_HEADER = "x-transcriber-service";
const ELECTRON_BUNDLE_ID = "com.transcribed.app";
const MAX_NATIVE_HOST_MESSAGE = 1024 * 1024;

// Project root is two levels up from this file (tools/native-host/ → repo root).
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function stateDir() {
  return getStateDir();
}

function logDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Logs", "Transcriber");
  }
  return stateDir();
}

function stateFile() {
  return path.join(stateDir(), "native-host-state.json");
}

function logFile() {
  return path.join(logDir(), "native-host.log");
}

function ensureDirs() {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.mkdirSync(logDir(), { recursive: true });
}

function log(...args) {
  try {
    ensureDirs();
    const line = `[${new Date().toISOString()}] ${args.map((a) =>
      typeof a === "string" ? a : JSON.stringify(a)
    ).join(" ")}\n`;
    fs.appendFileSync(logFile(), line);
  } catch {
    // Logging must never throw — Chrome treats stderr writes as errors.
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  ensureDirs();
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
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

function authHeaders() {
  try {
    const token = ensureLocalApiToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

function probeOnce(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      healthUrl(),
      { timeout: timeoutMs, headers: authHeaders() },
      (res) => {
        const identity = res.headers[IDENTITY_HEADER];
        // Drain body so the socket closes cleanly.
        res.on("data", () => {});
        res.on("end", () => {
          // 401 with our identity header still means "our server" (auth misconfig).
          if (identity) resolve({ status: "ready", identity, statusCode: res.statusCode });
          else if (res.statusCode === 401) {
            // Server up but token mismatch / middleware without env — treat as ready
            // only if we can distinguish; without identity, call it foreign/auth.
            resolve({ status: "foreign", statusCode: res.statusCode });
          } else resolve({ status: "foreign", statusCode: res.statusCode });
        });
      }
    );
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

function electronResourcesBin(execPath) {
  return path.join(path.dirname(execPath), "..", "Resources", "bin");
}

function getStartLaunch(env = process.env, execPath = process.execPath) {
  if (env.ELECTRON_RUN_AS_NODE) {
    return {
      command: "open",
      args: ["-b", ELECTRON_BUNDLE_ID],
      cwd: undefined,
      extraBins: [],
      path: [electronResourcesBin(execPath), "/usr/bin", "/bin"].join(
        path.delimiter
      ),
    };
  }
  // Chrome's inherited PATH is minimal (no Homebrew, no nvm), so we can't
  // rely on `npm` being resolvable. Use the absolute path next to the node
  // binary that's running this script, and extend PATH so nested children
  // (next, prisma, ffmpeg) can also resolve.
  const nodeBinDir = path.dirname(execPath);
  const npmCmd =
    process.platform === "win32"
      ? path.join(nodeBinDir, "npm.cmd")
      : path.join(nodeBinDir, "npm");
  return {
    command: npmCmd,
    args: ["run", "dev"],
    cwd: PROJECT_ROOT,
    extraBins: [nodeBinDir, "/opt/homebrew/bin", "/usr/local/bin"],
  };
}

function spawnDetached(command, args, options) {
  const child = spawn(command, args, options);
  child.on("error", (err) => {
    log("spawn_error", { command, message: err && err.message });
  });
  return child;
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

  const launch = getStartLaunch(process.env, process.execPath);
  const extraBins = launch.extraBins || [];
  const extendedPath =
    launch.path ||
    [
      ...extraBins,
      path.join(os.homedir(), ".local", "bin"), // Linux per-user binaries
      path.join(os.homedir(), "bin"),           // BSD/Linux per-user binaries
      "/snap/bin",                   // Linux Snap
      "/usr/bin",
      "/bin",
      process.env.PATH || "",
    ]
      .filter(Boolean)
      .join(path.delimiter);

  // Ensure loopback token exists and is passed to Next (middleware reads env).
  let tokenEnv = {};
  try {
    const token = ensureInEnv();
    tokenEnv = { [ENV_NAME]: token };
  } catch (e) {
    log("token_ensure_failed", { message: e && e.message });
  }

  const child = spawnDetached(launch.command, launch.args, {
    cwd: launch.cwd,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PATH: extendedPath, ...tokenEnv },
  });
  child.unref();

  const startedAt = Date.now();
  writeState({ pid: child.pid, startedAt, projectRoot: PROJECT_ROOT });
  log("spawned", { pid: child.pid, command: launch.command, args: launch.args });

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
    port: getPort(),
  };
}

const CALLER_ORIGIN_RE = /^chrome-extension:\/\/([a-p]{32})\/$/;

function parseCallerExtensionId(originArg) {
  if (typeof originArg !== "string") return null;
  const match = originArg.trim().match(CALLER_ORIGIN_RE);
  return match ? match[1] : null;
}

function findCallerOriginArg(argv = process.argv) {
  for (const arg of argv.slice(2)) {
    if (typeof arg === "string" && CALLER_ORIGIN_RE.test(arg.trim())) {
      return arg.trim();
    }
  }
  return null;
}

function loadAllowedExtensionIds(idsPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(idsPath, "utf8"));
    return filterValidExtensionIds(parsed);
  } catch {
    return [];
  }
}

function authorizeNativeHostCaller(argv = process.argv, options = {}) {
  const originArg = findCallerOriginArg(argv);
  const extensionId = parseCallerExtensionId(originArg);
  if (!extensionId) {
    return { ok: false, error: "unauthorized_caller" };
  }
  const idsPath =
    options.idsPath || path.join(getStateDir(), "extension-ids.json");
  const allowed = loadAllowedExtensionIds(idsPath);
  const known = options.knownIds || KNOWN_STORE_EXTENSION_IDS;
  if (allowed.includes(extensionId) || known.includes(extensionId)) {
    return { ok: true, extensionId };
  }
  return { ok: false, error: "unauthorized_caller" };
}

function replyGetLocalToken(id, argv = process.argv, options = {}) {
  const auth = authorizeNativeHostCaller(argv, options);
  if (!auth.ok) {
    log("getLocalToken_denied");
    return { id, ok: false, error: auth.error, _exit: true };
  }
  const token = ensureLocalApiToken();
  log("getLocalToken", { path: getLocalApiTokenPath() });
  return { id, ok: true, token };
}

// --- Native messaging framing ---------------------------------------------

function encodeMessage(obj) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  return Buffer.concat([len, json]);
}

function writeMessage(obj) {
  fs.writeSync(1, encodeMessage(obj));
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
        return { id, ok: true, ...r, port: getPort() };
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
      case "getLocalToken":
        return replyGetLocalToken(id);
      default:
        return { id, ok: false, error: "unknown_cmd", cmd };
    }
  } catch (e) {
    log("error", { cmd, message: e.message });
    return { id, ok: false, error: e.message };
  }
}

function listen() {
  let inflight = 0;
  let stdinEnded = false;
  const maybeExitOnStdinEnd = () => {
    if (stdinEnded && inflight === 0) {
      log("stdin closed, exiting");
      process.exit(0);
    }
  };

  process.stdin.on("data", async (chunk) => {
    inflight += 1;
    try {
      inBuf = Buffer.concat([inBuf, chunk]);
      if (inBuf.length > 4 + MAX_NATIVE_HOST_MESSAGE) {
        log("input_too_large", { length: inBuf.length });
        process.exit(1);
      }
      while (inBuf.length >= 4) {
        const len = inBuf.readUInt32LE(0);
        if (len > MAX_NATIVE_HOST_MESSAGE) {
          log("message_too_large", { len });
          process.exit(1);
        }
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
        const reply = (await handleMessage(msg)) || {};
        const exitAfter = reply._exit;
        const wire = { ...reply };
        delete wire._exit;
        writeMessage(wire);
        if (exitAfter) {
          process.exit(1);
        }
      }
    } finally {
      inflight -= 1;
      maybeExitOnStdinEnd();
    }
  });

  process.stdin.on("end", () => {
    stdinEnded = true;
    maybeExitOnStdinEnd();
  });

  process.on("uncaughtException", (e) => {
    log("uncaughtException", e.stack || e.message);
    process.exit(1);
  });

  log("native host started", { node: process.version, root: PROJECT_ROOT });
}

if (require.main === module) {
  listen();
}

module.exports = {
  ELECTRON_BUNDLE_ID,
  MAX_NATIVE_HOST_MESSAGE,
  electronResourcesBin,
  getStartLaunch,
  spawnDetached,
  parseCallerExtensionId,
  findCallerOriginArg,
  loadAllowedExtensionIds,
  authorizeNativeHostCaller,
  replyGetLocalToken,
  listen,
  getPort,
  healthUrl,
};
