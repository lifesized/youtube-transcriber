#!/usr/bin/env node
/**
 * Chrome Native Messaging host for Transcriber.
 *
 * Protocol: stdin/stdout framed messages — 4-byte little-endian length prefix
 * followed by UTF-8 JSON. https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
 *
 * Commands accepted (one per request, response has matching `id`):
 *   { id, cmd: "ping" | "version" } → { pong, protocol, commands, target }
 *   { id, cmd: "probe" }    → { status: "ready"|"foreign"|"down", port, identity? }
 *   { id, cmd: "start" }    → { started: true, pid? } | { started: false, reason, detail? }
 *        Returns as soon as the launch is issued; callers poll health.
 *   { id, cmd: "stop" }     → { stopped: bool, reason? }  (dev host, own process group only)
 *   { id, cmd: "status" }   → { running: bool, pid?, uptimeMs?, projectRoot, projectRootOk, port }
 *   { id, cmd: "getLocalToken" } → { token }  (loopback API Bearer; never log value)
 *        | { ok: false, error: "unauthorized_caller" | "extension_not_allowed" | "no_token" }
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const net = require("net");
const { spawn, execFileSync, spawnSync } = require("child_process");
const {
  ensureLocalApiToken,
  ensureInEnv,
  getLocalApiTokenPath,
  getStateDir,
  getLogDir,
  ENV_NAME,
} = require("../../lib/local-api-token.js");
const {
  filterValidExtensionIds,
  KNOWN_STORE_EXTENSION_IDS,
} = require("../../lib/native-host-pair.js");
const { configuredPort } = require("../../lib/local-api-auth.js");
const { NATIVE_HOST_LAUNCH_ARG } = require("../../lib/launch-source.js");
const { readRecordedProjectRoot, resolveStartRoot } = require("./project-root.js");

function getPort() {
  return configuredPort();
}

function healthUrl() {
  return `http://127.0.0.1:${getPort()}/api/health`;
}
const IDENTITY_HEADER = "x-transcriber-service";
const ELECTRON_BUNDLE_ID = "com.transcribed.app";
const DEFAULT_APP_BUNDLE = "/Applications/Transcriber.app";
const MAX_NATIVE_HOST_MESSAGE = 1024 * 1024;
const LOG_FILE_MODE = 0o600;
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const HEALTH_TIMEOUT_MS = 3000;
const PROTOCOL_VERSION = 2;
const COMMANDS = Object.freeze([
  "ping",
  "version",
  "probe",
  "start",
  "stop",
  "status",
  "getLocalToken",
]);

function stateDir() {
  return getStateDir();
}

function logDir() {
  return getLogDir(stateDir());
}

function stateFile() {
  return path.join(stateDir(), "native-host-state.json");
}

function logFile() {
  return path.join(logDir(), "native-host.log");
}

function devServerLogFile() {
  return path.join(logDir(), "dev-server.log");
}

function mkdir0700(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* already exists with a tighter or equal mode */
  }
}

function ensureDirs() {
  mkdir0700(stateDir());
  mkdir0700(logDir());
}

/** Builds before 0600 created native-host.log 0644. */
function tightenLogMode(file = logFile()) {
  try {
    fs.chmodSync(file, LOG_FILE_MODE);
  } catch {
    // Not created yet; appendFileSync creates it 0600.
  }
}

function fchmodNoFollow(file, mode) {
  const flags = fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW;
  const fd = fs.openSync(file, flags);
  try {
    fs.fchmodSync(fd, mode);
  } finally {
    fs.closeSync(fd);
  }
}

/** Keep one previous file: native-host.log.1 is replaced each time. */
function rotateLogIfFull(file = logFile()) {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size < LOG_MAX_BYTES) return;
    fchmodNoFollow(file, LOG_FILE_MODE);
    const rotated = `${file}.1`;
    fs.renameSync(file, rotated);
    fchmodNoFollow(rotated, LOG_FILE_MODE);
  } catch {
    // No log yet / chmod or rename race; never throw.
  }
}

function log(...args) {
  try {
    ensureDirs();
    const file = logFile();
    rotateLogIfFull(file);
    const line = `[${new Date().toISOString()}] ${args.map((a) =>
      typeof a === "string" ? a : JSON.stringify(a)
    ).join(" ")}\n`;
    fs.appendFileSync(file, line, { mode: LOG_FILE_MODE });
    tightenLogMode(file);
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
  const file = stateFile();
  fs.writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best-effort 0600 */
  }
}

function recordedGroupIsOurs(rec) {
  if (!rec || !Number.isInteger(rec.pid) || rec.pid <= 1) return false;
  if (typeof rec.startTime !== "string" || !rec.startTime) return false;
  if (typeof rec.exe !== "string" || !rec.exe) return false;
  const live = inspectPid(rec.pid);
  if (!live || live.startTime !== rec.startTime || live.exe !== rec.exe) return false;
  return live.pgid === rec.pid;
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

/** Same identity shape Security accepted for tracked-child reaping: pid + lstart + exe. */
function inspectPid(pid, run = execFileSync) {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try {
    const startTime = run("/bin/ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    const exe = path.basename(
      run("/bin/ps", ["-o", "comm=", "-p", String(pid)], {
        encoding: "utf8",
        timeout: 2000,
      }).trim()
    );
    const command = run("/bin/ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    const pgid = Number(
      run("/bin/ps", ["-o", "pgid=", "-p", String(pid)], {
        encoding: "utf8",
        timeout: 2000,
      }).trim()
    );
    if (!startTime || !exe) return null;
    return { pid, startTime, exe, command, pgid };
  } catch {
    return null;
  }
}

function looksLikeOurNextDev(command, projectRoot) {
  const cmd = String(command || "");
  const root = String(projectRoot || "");
  if (!root || !cmd.includes(root)) return false;
  return /\bnext\b/.test(cmd) || /npm\s+run\s+dev/.test(cmd) || /run-with-local-token/.test(cmd);
}

function isOurRecordedServer(listenerPid, rec, projectRoot) {
  if (!rec || !Number.isInteger(rec.pid) || rec.pid <= 1) return false;
  if (typeof rec.startTime !== "string" || !rec.startTime) return false;
  if (typeof rec.exe !== "string" || !rec.exe) return false;
  const recordedLive = inspectPid(rec.pid);
  if (
    !recordedLive ||
    recordedLive.startTime !== rec.startTime ||
    recordedLive.exe !== rec.exe
  ) {
    return false;
  }
  const root = projectRoot || rec.projectRoot;
  const recordedCmdOurs =
    looksLikeOurNextDev(recordedLive.command, root) ||
    (root && String(recordedLive.command || "").includes(root));
  if (!recordedCmdOurs) return false;
  if (!Number.isInteger(listenerPid) || listenerPid <= 1) return false;
  if (listenerPid === rec.pid) return true;
  const listener = inspectPid(listenerPid);
  if (!listener) return false;
  if (!looksLikeOurNextDev(listener.command, root)) return false;
  return listener.pgid === rec.pid || listener.pgid === recordedLive.pgid;
}

function listenerPidsOnPort(port, run = execFileSync) {
  const args = ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"];
  for (const bin of ["/usr/sbin/lsof", "lsof"]) {
    try {
      const out = run(bin, args, { encoding: "utf8", timeout: 2000 });
      return String(out)
        .split(/\s+/)
        .map((s) => Number(s))
        .filter((n) => Number.isInteger(n) && n > 1);
    } catch {
      // try next binary
    }
  }
  return [];
}

function tcpListening(port, timeoutMs = HEALTH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port, timeout: timeoutMs });
    const done = (listening) => {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(listening);
    };
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(true));
    sock.once("error", (err) => {
      done(Boolean(err && err.code === "ETIMEDOUT"));
    });
  });
}

function authHeaders() {
  return { Authorization: `Bearer ${ensureLocalApiToken()}` };
}

function probeOnce(timeoutMs = HEALTH_TIMEOUT_MS) {
  let headers;
  try {
    headers = authHeaders();
  } catch {
    return Promise.resolve({ status: "down" });
  }
  return new Promise((resolve) => {
    const req = http.get(
      healthUrl(),
      { timeout: timeoutMs, headers },
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
    req.on("error", (err) => {
      if (err && err.code === "ECONNREFUSED") resolve({ status: "down" });
      else resolve({ status: "hung" });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: "hung" });
    });
  });
}

async function classifyPort(timeoutMs = HEALTH_TIMEOUT_MS) {
  const port = getPort();
  const listening = await tcpListening(port, timeoutMs);
  if (!listening) return { status: "closed", port };
  const health = await probeOnce(timeoutMs);
  const pids = listenerPidsOnPort(port);
  const listenerPid = pids[0];
  if (health.status === "ready") {
    return { status: "ready", port, listenerPid, identity: health.identity, statusCode: health.statusCode };
  }
  if (health.status === "foreign") {
    return { status: "foreign", port, listenerPid, statusCode: health.statusCode };
  }
  return { status: "hung", port, listenerPid };
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

function isElectronHost(env = process.env) {
  return !!env.ELECTRON_RUN_AS_NODE;
}

/** `<bundle>.app/Contents/MacOS/<binary>` → `<bundle>.app`, else null. */
function bundleFromExecPath(execPath) {
  if (typeof execPath !== "string" || !path.isAbsolute(execPath)) return null;
  const macos = path.dirname(execPath);
  const contents = path.dirname(macos);
  const bundle = path.dirname(contents);
  if (path.basename(macos) !== "MacOS" || path.basename(contents) !== "Contents") {
    return null;
  }
  return bundle.endsWith(".app") ? bundle : null;
}

function isTransientBundlePath(bundle) {
  return bundle.startsWith("/Volumes/") || bundle.includes("/AppTranslocation/");
}

function readInfoPlist(bundle) {
  const plistPath = path.join(bundle, "Contents", "Info.plist");
  const raw = fs.readFileSync(plistPath);
  if (raw.subarray(0, 6).toString("latin1") !== "bplist") return raw.toString("utf8");
  return execFileSync("/usr/bin/plutil", ["-convert", "xml1", "-o", "-", plistPath], {
    encoding: "utf8",
    timeout: 2000,
  });
}

const BUNDLE_ID_RE = new RegExp(
  `<key>CFBundleIdentifier</key>\\s*<string>${ELECTRON_BUNDLE_ID.replace(/\./g, "\\.")}</string>`
);

function teamIdFromCodesign(bundle, run = spawnSync) {
  const verify = run("/usr/bin/codesign", ["--verify", "--strict", bundle], {
    encoding: "utf8",
  });
  if (!verify || verify.status !== 0) return "";
  const dv = run("/usr/bin/codesign", ["-dv", "--verbose=4", bundle], {
    encoding: "utf8",
  });
  const text = `${(dv && dv.stderr) || ""}\n${(dv && dv.stdout) || ""}`;
  const team = (text.match(/^TeamIdentifier=(.+)$/m) || [])[1] || "";
  return team.trim() === "not set" ? "" : team.trim();
}

function isTranscriberBundle(bundle, run = spawnSync, hostExecPath = process.execPath) {
  try {
    if (!BUNDLE_ID_RE.test(readInfoPlist(bundle))) return false;
    // Expected Team ID comes from the host's own bundle signature, not
    // from a candidate signing-identity.json (that failed open).
    const hostBundle = bundleFromExecPath(hostExecPath);
    const hostTeam = hostBundle ? teamIdFromCodesign(hostBundle, run) : "";
    if (!/^[A-Z0-9]{10}$/.test(hostTeam)) return true;
    return teamIdFromCodesign(bundle, run) === hostTeam;
  } catch {
    return false;
  }
}

/**
 * The only bundles the app host will launch: the install its wrapper execs
 * from (recorded by the app's installer) and /Applications/Transcriber.app.
 */
function appBundleCandidates(execPath = process.execPath) {
  const recorded = bundleFromExecPath(execPath);
  const out = [];
  if (recorded && !isTransientBundlePath(recorded)) out.push(recorded);
  if (!out.includes(DEFAULT_APP_BUNDLE)) out.push(DEFAULT_APP_BUNDLE);
  return out;
}

function resolveAppBundle(execPath = process.execPath) {
  return appBundleCandidates(execPath).find(isTranscriberBundle) || null;
}

function getStartLaunch(env = process.env, execPath = process.execPath, target) {
  if (isElectronHost(env)) {
    return {
      command: "/usr/bin/open",
      args: ["-a", target, "--args", NATIVE_HOST_LAUNCH_ARG],
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
    cwd: target,
    extraBins: [nodeBinDir, "/opt/homebrew/bin", "/usr/local/bin"],
  };
}

/**
 * The app host launches an allowlisted bundle and needs no checkout. The dev
 * host only starts from a validated recorded root, never from its own folder.
 */
function resolveStartLaunch(env = process.env, execPath = process.execPath, dir = stateDir()) {
  if (isElectronHost(env)) {
    const bundle = resolveAppBundle(execPath);
    if (!bundle) {
      return {
        ok: false,
        reason: "app_not_found",
        detail: `No Transcriber.app at ${appBundleCandidates(execPath).join(" or ")}`,
      };
    }
    return { ok: true, bundle, launch: getStartLaunch(env, execPath, bundle) };
  }
  const root = resolveStartRoot(dir);
  if (!root.ok) return root;
  return {
    ok: true,
    projectRoot: root.projectRoot,
    launch: getStartLaunch(env, execPath, root.projectRoot),
  };
}

function spawnDetached(command, args, options) {
  const child = spawn(command, args, options);
  child.on("error", (err) => {
    log("spawn_error", { command, message: err && err.message });
  });
  return child;
}

function openDevServerLogFd() {
  ensureDirs();
  const logPath = devServerLogFile();
  rotateLogIfFull(logPath);
  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_APPEND |
    fs.constants.O_CREAT |
    fs.constants.O_NOFOLLOW;
  const fd = fs.openSync(logPath, flags, LOG_FILE_MODE);
  try {
    fs.fchmodSync(fd, LOG_FILE_MODE);
  } catch {
    try {
      fs.chmodSync(logPath, LOG_FILE_MODE);
    } catch {
      /* best-effort 0600 */
    }
  }
  return fd;
}

function spawnDevServer(launch, env) {
  const fd = openDevServerLogFd();
  const child = spawnDetached(launch.command, launch.args, {
    cwd: launch.cwd,
    detached: true,
    stdio: ["ignore", fd, fd],
    env,
  });
  child.unref();
  try {
    fs.closeSync(fd);
  } catch {
    /* fd stays with the child */
  }
  return child;
}

function inspectPidSoon(pid) {
  const first = inspectPid(pid);
  if (first) return first;
  const until = Date.now() + 150;
  while (Date.now() < until) {
    const live = inspectPid(pid);
    if (live) return live;
  }
  return null;
}

function recordSpawnedIdentity(child, projectRoot) {
  const live = inspectPidSoon(child.pid) || {};
  const rec = {
    pid: child.pid,
    startedAt: Date.now(),
    startTime: live.startTime || "",
    exe: live.exe || path.basename((child.spawnfile || launchName(child)) || "node"),
    command: live.command || "",
    projectRoot,
  };
  writeState(rec);
  return rec;
}

function launchName(child) {
  return (child && child.spawnargs && child.spawnargs[0]) || "";
}

function killOurRecordedServer() {
  const rec = readState();
  const pids = listenerPidsOnPort(getPort());
  if (pids.length === 0) return false;
  const listenerPid = pids[0];
  if (!isOurRecordedServer(listenerPid, rec)) return false;
  if (!recordedGroupIsOurs(rec)) return false;
  try {
    process.kill(-rec.pid, "SIGTERM");
  } catch (e) {
    log("hung_kill_failed", { pid: rec.pid, message: e && e.message });
    return false;
  }
  writeState({});
  log("killed hung recorded server", { pid: rec.pid, listenerPid });
  return true;
}

function waitForPortFree(timeoutMs = HEALTH_TIMEOUT_MS) {
  const port = getPort();
  const deadline = Date.now() + timeoutMs;
  const poll = () =>
    tcpListening(port, Math.min(200, Math.max(50, deadline - Date.now()))).then((listening) => {
      if (!listening) return true;
      if (Date.now() >= deadline) return false;
      return new Promise((resolve) => setTimeout(resolve, 50)).then(poll);
    });
  return poll();
}

async function startServer() {
  // closed | ready | foreign | hung. A healthy launchd listener is "ready".
  const probe = await classifyPort();
  if (probe.status === "ready") {
    return { started: false, reason: "already_running" };
  }
  if (probe.status === "foreign") {
    return { started: false, reason: "port_conflict" };
  }
  if (probe.status === "hung") {
    if (!killOurRecordedServer()) {
      return {
        started: false,
        reason: "port_stuck",
        pid: probe.listenerPid,
        detail: `port ${probe.port} is busy/stuck (pid ${probe.listenerPid || "?"})`,
      };
    }
    if (!(await waitForPortFree())) {
      return {
        started: false,
        reason: "port_stuck",
        pid: probe.listenerPid,
        detail: `port ${probe.port} is busy/stuck (pid ${probe.listenerPid || "?"})`,
      };
    }
  }

  const resolved = resolveStartLaunch(process.env, process.execPath);
  if (!resolved.ok) {
    log("start_refused", {
      reason: resolved.reason,
      detail: resolved.detail,
      projectRoot: resolved.projectRoot,
    });
    return { started: false, reason: resolved.reason, detail: resolved.detail };
  }
  const { launch, projectRoot, bundle } = resolved;
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

  const env = { ...process.env, PATH: extendedPath, ...tokenEnv };
  if (!bundle && launch.command && !fs.existsSync(launch.command)) {
    launch.command = process.platform === "win32" ? "npm.cmd" : "npm";
  }
  const child = bundle
    ? (() => {
        const launched = spawnDetached(launch.command, launch.args, {
          cwd: launch.cwd,
          detached: true,
          stdio: "ignore",
          env,
        });
        launched.unref();
        return launched;
      })()
    : spawnDevServer(launch, env);

  if (!child.pid) {
    log("spawn_failed", { command: launch.command, args: launch.args });
    return { started: false, reason: "spawn_failed" };
  }

  const startedAt = Date.now();
  log("spawned", { pid: child.pid, command: launch.command, args: launch.args, cwd: launch.cwd });
  // `open` exits once LaunchServices has the request, so its pid is not the app.
  if (bundle) return { started: true, startedAt };

  const rec = recordSpawnedIdentity(child, projectRoot);
  return { started: true, pid: rec.pid, startedAt: rec.startedAt };
}

function isProcessGroupAlive(pgid) {
  if (!Number.isInteger(pgid) || pgid <= 1) return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Only ever signals the process group this host spawned for `npm run dev`. */
function stopServer() {
  if (isElectronHost()) return { stopped: false, reason: "stop_unsupported" };
  const state = readState();
  if (!state.startTime || !state.exe) {
    const alive = isProcessGroupAlive(state.pid) || isPidAlive(state.pid);
    writeState({});
    if (!alive) return { stopped: false, reason: "not_running" };
    log("stop_refused_legacy", { pid: state.pid });
    return { stopped: false, reason: "not_ours" };
  }
  if (!recordedGroupIsOurs(state)) {
    const alive = isProcessGroupAlive(state.pid) || isPidAlive(state.pid);
    writeState({});
    if (!alive) return { stopped: false, reason: "not_running" };
    log("stop_refused_pgid", { pid: state.pid });
    return { stopped: false, reason: "not_ours" };
  }
  const pids = listenerPidsOnPort(getPort());
  if (pids.length > 0) {
    if (!isOurRecordedServer(pids[0], state)) {
      log("stop_refused_identity", { pid: state.pid, listenerPid: pids[0] });
      return { stopped: false, reason: "not_ours" };
    }
  } else {
    const live = inspectPid(state.pid);
    if (!live || !looksLikeOurNextDev(live.command, state.projectRoot)) {
      log("stop_refused_identity", { pid: state.pid, listenerPid: null });
      return { stopped: false, reason: "not_ours" };
    }
  }
  try {
    process.kill(-state.pid, "SIGTERM");
  } catch (e) {
    log("stop_failed", { pid: state.pid, message: e && e.message });
    return { stopped: false, reason: "stop_failed" };
  }
  writeState({});
  log("stopped dev server", { pid: state.pid });
  return { stopped: true, pid: state.pid };
}

function getStatus() {
  const state = readState();
  const running = isPidAlive(state.pid);
  const out = {
    running,
    pid: running ? state.pid : undefined,
    uptimeMs: running && state.startedAt ? Date.now() - state.startedAt : undefined,
    port: getPort(),
  };
  if (!isElectronHost()) {
    const recorded = readRecordedProjectRoot(stateDir());
    out.projectRoot = typeof recorded === "string" ? recorded : null;
    out.projectRootOk = resolveStartRoot(stateDir()).ok;
  }
  return out;
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
  return { ok: false, error: "extension_not_allowed", extensionId };
}

function replyGetLocalToken(id, argv = process.argv, options = {}) {
  const auth = authorizeNativeHostCaller(argv, options);
  if (!auth.ok) {
    log("getLocalToken_denied", { error: auth.error, extensionId: auth.extensionId });
    return { id, ok: false, error: auth.error, _exit: true };
  }
  let token;
  try {
    token = ensureLocalApiToken();
  } catch (e) {
    log("getLocalToken_failed", { path: getLocalApiTokenPath(), message: e && e.message });
    return { id, ok: false, error: "no_token" };
  }
  log("getLocalToken", { path: getLocalApiTokenPath() });
  return { id, ok: true, token };
}

function versionReply(id, env = process.env) {
  return {
    id,
    ok: true,
    pong: true,
    protocol: PROTOCOL_VERSION,
    commands: [...COMMANDS],
    target: isElectronHost(env) ? "app" : "dev",
  };
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
      case "version":
        return versionReply(id);
      case "probe": {
        const r = await probeWithRetry(1, 0);
        return { id, ok: true, ...r, port: getPort() };
      }
      case "start": {
        const r = await startServer();
        if (!r.started) return { id, ok: false, ...r, port: getPort() };
        return { id, ok: true, ...r };
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

  log("native host started", {
    node: process.version,
    script: __filename,
    projectRoot: isElectronHost() ? undefined : readRecordedProjectRoot(stateDir()),
  });
}

if (require.main === module) {
  listen();
}

module.exports = {
  ELECTRON_BUNDLE_ID,
  DEFAULT_APP_BUNDLE,
  MAX_NATIVE_HOST_MESSAGE,
  LOG_FILE_MODE,
  LOG_MAX_BYTES,
  PROTOCOL_VERSION,
  COMMANDS,
  electronResourcesBin,
  bundleFromExecPath,
  appBundleCandidates,
  isTranscriberBundle,
  resolveAppBundle,
  getStartLaunch,
  resolveStartLaunch,
  startServer,
  stopServer,
  getStatus,
  versionReply,
  handleMessage,
  spawnDetached,
  spawnDevServer,
  inspectPid,
  inspectPidSoon,
  looksLikeOurNextDev,
  isOurRecordedServer,
  listenerPidsOnPort,
  tcpListening,
  classifyPort,
  probeOnce,
  killOurRecordedServer,
  recordedGroupIsOurs,
  waitForPortFree,
  openDevServerLogFd,
  writeState,
  HEALTH_TIMEOUT_MS,
  devServerLogFile,
  parseCallerExtensionId,
  findCallerOriginArg,
  loadAllowedExtensionIds,
  authorizeNativeHostCaller,
  replyGetLocalToken,
  listen,
  getPort,
  healthUrl,
  stateDir,
  logDir,
  logFile,
  rotateLogIfFull,
  log,
  authHeaders,
  stateFile,
};
