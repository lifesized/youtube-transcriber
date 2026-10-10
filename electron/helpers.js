"use strict";

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { getStateDir, getLogDir } = require("../lib/local-api-token.js");
const {
  issueToken,
  revokeToken,
  listActiveRecords,
  serializeHelperTokensEnv,
  ENV_NAME: HELPER_TOKENS_ENV,
} = require("../lib/helper-tokens.js");
const { parseCodesignVerbose, appBundleFromExecPath } = require("./code-signature.js");

const HELPERS_DIR_NAME = "helpers";
const MANIFEST_NAME = "manifest.json";
const ID_RE = /^[a-z][a-z0-9-]{0,62}$/;
const VERSION_RE = /^[A-Za-z0-9._+-]{1,32}$/;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

function helpersRoot(stateDir) {
  return path.join(stateDir || getStateDir(), HELPERS_DIR_NAME);
}

function helperLogPath(id, logDir) {
  return path.join(logDir || getLogDir(), "helpers", `${id}.log`);
}

function isInsideDir(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  return target === base || target.startsWith(prefix);
}

function validateManifest(raw, dirName) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "invalid_manifest" };
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!ID_RE.test(id) || id !== dirName) {
    return { ok: false, error: "invalid_id" };
  }
  const displayName = typeof raw.displayName === "string" ? raw.displayName.trim() : "";
  if (!displayName || displayName.length > 80 || /[\u0000-\u001F\u007F]/.test(displayName)) {
    return { ok: false, error: "invalid_display_name" };
  }
  const version = typeof raw.version === "string" ? raw.version.trim() : "";
  if (!VERSION_RE.test(version)) {
    return { ok: false, error: "invalid_version" };
  }
  const executable = typeof raw.executable === "string" ? raw.executable : "";
  if (!executable || path.isAbsolute(executable) || executable.split(/[\\/]/).includes("..")) {
    return { ok: false, error: "invalid_executable" };
  }
  if (path.normalize(executable).startsWith("..")) {
    return { ok: false, error: "invalid_executable" };
  }
  return { ok: true, id, displayName, version, executable };
}

function validateExecutable(helperDir, relative, uid = process.getuid && process.getuid()) {
  const resolved = path.resolve(helperDir, relative);
  let real;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    return { ok: false, error: "missing_executable" };
  }
  if (!isInsideDir(helperDir, real)) {
    return { ok: false, error: "path_traversal" };
  }
  let st;
  try {
    st = fs.statSync(real);
  } catch {
    return { ok: false, error: "missing_executable" };
  }
  if (!st.isFile()) return { ok: false, error: "not_a_file" };
  if (typeof uid === "number" && st.uid !== uid) {
    return { ok: false, error: "bad_owner" };
  }
  if (st.mode & 0o002) return { ok: false, error: "world_writable" };
  return { ok: true, executable: real };
}

function teamIdFromPath(target, run) {
  const verify = run("/usr/bin/codesign", ["--verify", "--strict", target], {
    encoding: "utf8",
  });
  if (!verify || verify.status !== 0) return "";
  const dv = run("/usr/bin/codesign", ["-dv", "--verbose=4", target], {
    encoding: "utf8",
  });
  const text = `${(dv && dv.stderr) || ""}\n${(dv && dv.stdout) || ""}`;
  return parseCodesignVerbose(text).teamId || "";
}

function signatureAllowed(options = {}) {
  if (!options.isPackaged) return { ok: true };
  const run = options.run || spawnSync;
  const appBundle = appBundleFromExecPath(options.appExecPath || "");
  if (!appBundle) return { ok: false, error: "app_unsigned" };
  const appTeam = teamIdFromPath(appBundle, run);
  if (!/^[A-Z0-9]{10}$/.test(appTeam)) return { ok: false, error: "app_unsigned" };
  const helperTeam = teamIdFromPath(options.executable, run);
  if (!helperTeam || helperTeam !== appTeam) return { ok: false, error: "signature_mismatch" };
  return { ok: true };
}

function readHelperDir(dirPath, options = {}) {
  const dirName = path.basename(dirPath);
  const manifestPath = path.join(dirPath, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return { ok: false, error: "missing_manifest", dirName };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return { ok: false, error: "invalid_manifest", dirName };
  }
  const manifest = validateManifest(parsed, dirName);
  if (!manifest.ok) return { ...manifest, dirName };
  const exe = validateExecutable(dirPath, manifest.executable, options.uid);
  if (!exe.ok) return { ...exe, id: manifest.id, displayName: manifest.displayName, dirName };
  const sig = signatureAllowed({
    isPackaged: Boolean(options.isPackaged),
    appExecPath: options.appExecPath,
    executable: exe.executable,
    run: options.run,
  });
  if (!sig.ok) return { ...sig, id: manifest.id, displayName: manifest.displayName, dirName };
  return {
    ok: true,
    id: manifest.id,
    displayName: manifest.displayName,
    version: manifest.version,
    executable: exe.executable,
    dir: dirPath,
  };
}

function discoverHelpers(options = {}) {
  const root = options.helpersDir || helpersRoot(options.stateDir);
  if (!fs.existsSync(root)) return [];
  let names;
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const found = [];
  for (const name of names) {
    const dirPath = path.join(root, name);
    let st;
    try {
      st = fs.statSync(dirPath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    found.push(readHelperDir(dirPath, options));
  }
  return found;
}

function openHelperLog(id, logDir) {
  const file = helperLogPath(id, logDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, "a", 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
  } catch {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Windows may ignore chmod
    }
  }
  return { fd, file };
}

function helperEnv(id, token, localUrl) {
  const keep = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "USER", "LOGNAME"];
  const env = {};
  for (const key of keep) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.TRANSCRIBER_LOCAL_URL = localUrl;
  env.TRANSCRIBER_HELPER_TOKEN = token;
  env.TRANSCRIBER_HELPER_ID = id;
  return env;
}

function createHelperManager(options = {}) {
  const stateDir = options.stateDir || getStateDir();
  const logDir = options.logDir || getLogDir(stateDir);
  const port = options.port || 19721;
  const localUrl = options.localUrl || `http://127.0.0.1:${port}`;
  const spawnImpl = options.spawn || spawn;
  const isPackaged = Boolean(options.isPackaged);
  const appExecPath = options.appExecPath || process.execPath;
  const run = options.run || spawnSync;
  const timers = options.timers || {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  const uid = options.uid;
  const running = new Map();
  let statusListener = options.onStatus || null;

  function emit() {
    if (typeof statusListener === "function") statusListener(listStatus());
  }

  function listDiscovered() {
    return discoverHelpers({
      stateDir,
      helpersDir: options.helpersDir,
      isPackaged,
      appExecPath,
      run,
      uid,
    });
  }

  function listStatus() {
    return listDiscovered()
      .filter((row) => row.ok)
      .map((row) => {
        const live = running.get(row.id);
        return {
          id: row.id,
          displayName: row.displayName,
          version: row.version,
          state: live ? live.state : "stopped",
          error: live && live.error ? live.error : "",
        };
      });
  }

  function clearRestart(entry) {
    if (entry && entry.restartTimer != null) {
      timers.clearTimeout(entry.restartTimer);
      entry.restartTimer = null;
    }
  }

  function stopEntry(entry, { restart = false } = {}) {
    if (!entry) return;
    entry.wanted = Boolean(restart);
    clearRestart(entry);
    if (entry.child && typeof entry.child.kill === "function") {
      try {
        entry.child.kill("SIGTERM");
      } catch {
        // already gone
      }
    }
    if (entry.logFd != null) {
      try {
        fs.closeSync(entry.logFd);
      } catch {
        // already closed
      }
      entry.logFd = null;
    }
    entry.child = null;
    entry.state = "stopped";
  }

  function spawnOne(helper, entry) {
    const token = issueToken(helper.id, stateDir);
    const log = openHelperLog(helper.id, logDir);
    entry.logFd = log.fd;
    entry.state = "starting";
    entry.error = "";
    const child = spawnImpl(helper.executable, [], {
      cwd: helper.dir,
      env: helperEnv(helper.id, token, localUrl),
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    entry.child = child;
    entry.state = "running";
    emit();
    const onExit = (code, signal) => {
      if (entry.child !== child) return;
      entry.child = null;
      if (entry.logFd != null) {
        try {
          fs.closeSync(entry.logFd);
        } catch {
          // already closed
        }
        entry.logFd = null;
      }
      if (!entry.wanted) {
        entry.state = "stopped";
        emit();
        return;
      }
      entry.state = "error";
      entry.error = signal || (code == null ? "exited" : `exit_${code}`);
      const delay = BACKOFF_MS[Math.min(entry.fails, BACKOFF_MS.length - 1)];
      entry.fails += 1;
      entry.restartTimer = timers.setTimeout(() => {
        entry.restartTimer = null;
        const latest = listDiscovered().find((row) => row.ok && row.id === helper.id);
        if (!latest || !entry.wanted) return;
        spawnOne(latest, entry);
      }, delay);
      emit();
    };
    if (typeof child.on === "function") child.on("exit", onExit);
    if (typeof child.on === "function") {
      child.on("error", () => {
        onExit(1, null);
      });
    }
  }

  function start(id) {
    const helper = listDiscovered().find((row) => row.ok && row.id === id);
    if (!helper) return { ok: false, error: "not_found" };
    let entry = running.get(id);
    if (entry && entry.state === "running") return { ok: true, state: "running" };
    if (!entry) {
      entry = { id, wanted: true, fails: 0, child: null, state: "stopped", error: "", restartTimer: null, logFd: null };
      running.set(id, entry);
    }
    entry.wanted = true;
    entry.fails = 0;
    clearRestart(entry);
    spawnOne(helper, entry);
    syncEnv();
    return { ok: true, state: entry.state };
  }

  function stop(id) {
    const entry = running.get(id);
    if (entry) stopEntry(entry, { restart: false });
    emit();
    return { ok: true, state: "stopped" };
  }

  function startAll() {
    for (const row of listDiscovered()) {
      if (row.ok) start(row.id);
    }
    return listStatus();
  }

  function stopAll() {
    for (const id of [...running.keys()]) stop(id);
    return listStatus();
  }

  function syncEnv() {
    process.env[HELPER_TOKENS_ENV] = serializeHelperTokensEnv(listActiveRecords(stateDir));
  }

  function publicView() {
    return { helpers: listStatus() };
  }

  function attachIpc(child) {
    if (!child || typeof child.on !== "function") return;
    child.on("message", (msg) => {
      if (!msg || !msg.requestId) return;
      if (msg.type === "helpers-get") {
        child.send({ type: "helpers-get-result", requestId: msg.requestId, payload: publicView() });
        return;
      }
      if (msg.type === "helpers-set") {
        const id = msg.payload && msg.payload.id;
        const action = msg.payload && msg.payload.action;
        try {
          if (action === "stop") stop(id);
          else if (action === "start") start(id);
          else if (action === "revoke") {
            stop(id);
            revokeToken(id, stateDir);
            syncEnv();
          }
          syncEnv();
          child.send({ type: "helpers-set-result", requestId: msg.requestId, payload: publicView() });
        } catch (error) {
          child.send({
            type: "helpers-set-result",
            requestId: msg.requestId,
            error: error && error.message ? error.message : "helper_failed",
          });
        }
      }
    });
  }

  return {
    discover: listDiscovered,
    listStatus,
    start,
    stop,
    startAll,
    stopAll,
    syncEnv,
    attachIpc,
    getPublic: publicView,
    setOnStatus(fn) {
      statusListener = fn;
    },
  };
}

module.exports = {
  HELPERS_DIR_NAME,
  MANIFEST_NAME,
  helpersRoot,
  helperLogPath,
  validateManifest,
  validateExecutable,
  signatureAllowed,
  teamIdFromPath,
  readHelperDir,
  discoverHelpers,
  helperEnv,
  createHelperManager,
};
