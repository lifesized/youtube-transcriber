"use strict";

/**
 * Resolve and validate the Transcriber checkout the native host should start.
 *
 * The host only ever uses this path as `cwd` for `npm run dev`. Nothing from
 * native-host.json is executed or interpolated.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const CONFIG_FILE_NAME = "native-host.json";

function getStateDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Transcriber");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || os.homedir(), "Transcriber");
  }
  return path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
    "transcriber"
  );
}

function getConfigPath(stateDir = getStateDir()) {
  return path.join(stateDir, CONFIG_FILE_NAME);
}

function defaultProjectRoot() {
  return path.resolve(__dirname, "..", "..");
}

function hasDotDotSegment(p) {
  return String(p)
    .split(/[\\/]/)
    .includes("..");
}

/**
 * Strict validation: absolute, no `..` after resolve, real directory with package.json.
 * @returns {{ ok: true, projectRoot: string } | { ok: false, reason: string }}
 */
function validateProjectRoot(candidate) {
  if (typeof candidate !== "string") {
    return { ok: false, reason: "not_a_string" };
  }
  const trimmed = candidate.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }
  if (trimmed.includes("\0")) {
    return { ok: false, reason: "not_absolute" };
  }
  if (!path.isAbsolute(trimmed)) {
    return { ok: false, reason: "not_absolute" };
  }

  const resolved = path.resolve(trimmed);
  if (hasDotDotSegment(resolved)) {
    return { ok: false, reason: "dotdot" };
  }

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, reason: "not_a_directory" };
  }
  if (!stat.isDirectory()) {
    return { ok: false, reason: "not_a_directory" };
  }

  const packageJson = path.join(resolved, "package.json");
  try {
    if (!fs.statSync(packageJson).isFile()) {
      return { ok: false, reason: "no_package_json" };
    }
  } catch {
    return { ok: false, reason: "no_package_json" };
  }

  return { ok: true, projectRoot: resolved };
}

/**
 * Read optional native-host.json. Invalid or missing → default checkout root.
 * Only `projectRoot` is consulted; any other key is ignored.
 */
function resolveProjectRoot({
  stateDir = getStateDir(),
  defaultRoot = defaultProjectRoot(),
  configPath = getConfigPath(stateDir),
} = {}) {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    const candidate = parsed && parsed.projectRoot;
    const validated = validateProjectRoot(candidate);
    if (validated.ok) {
      return { projectRoot: validated.projectRoot, projectRootSource: "config" };
    }
  } catch {
    // Missing or unreadable/invalid JSON — fall through to default.
  }
  return { projectRoot: defaultRoot, projectRootSource: "default" };
}

function writeProjectRootConfig(projectRoot, stateDir = getStateDir()) {
  const validated = validateProjectRoot(projectRoot);
  if (!validated.ok) {
    const hint =
      validated.reason === "not_absolute"
        ? "Path must be absolute."
        : validated.reason === "dotdot"
          ? "Path must not contain '..' after resolving."
          : validated.reason === "not_a_directory"
            ? "Path must be an existing directory."
            : validated.reason === "no_package_json"
              ? "Directory must contain package.json."
              : "Invalid project root.";
    const err = new Error(hint);
    err.reason = validated.reason;
    throw err;
  }

  fs.mkdirSync(stateDir, { recursive: true });
  const dest = getConfigPath(stateDir);
  const tmp = path.join(
    stateDir,
    `.${CONFIG_FILE_NAME}.${process.pid}.${Date.now()}.tmp`
  );
  const body = JSON.stringify({ projectRoot: validated.projectRoot }, null, 2) + "\n";
  try {
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, dest);
    fs.chmodSync(dest, 0o600);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // temp may already be gone
    }
    throw e;
  }
  return { projectRoot: validated.projectRoot, configPath: dest };
}

function clearProjectRootConfig(stateDir = getStateDir()) {
  const dest = getConfigPath(stateDir);
  try {
    fs.unlinkSync(dest);
    return { cleared: true, configPath: dest };
  } catch (e) {
    if (e && e.code === "ENOENT") {
      return { cleared: false, configPath: dest };
    }
    throw e;
  }
}

/** Parse KEY=VALUE lines. No interpolation or command expansion. */
function parseEnvFile(contents) {
  const out = {};
  if (typeof contents !== "string") return out;
  for (const rawLine of contents.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    const quoted =
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2);
    if (quoted) {
      val = val.slice(1, -1);
    } else {
      const hash = val.indexOf(" #");
      if (hash !== -1) val = val.slice(0, hash).trim();
    }
    out[key] = val;
  }
  return out;
}

function readProjectEnv(projectRoot) {
  const env = {};
  const found = [];
  for (const name of [".env", ".env.local"]) {
    const filePath = path.join(projectRoot, name);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      Object.assign(env, parseEnvFile(fs.readFileSync(filePath, "utf8")));
      found.push(name);
    } catch {
      // file absent
    }
  }
  return { env, found };
}

/**
 * Resolve a Prisma `file:` SQLite URL the same way the server does: relative
 * to cwd (see lib/prisma.ts — the adapter opens the path relative to process cwd).
 */
function resolveSqliteFilePath(databaseUrl, cwd) {
  if (typeof databaseUrl !== "string" || !databaseUrl.startsWith("file:")) {
    return null;
  }
  let rest = databaseUrl.slice("file:".length);
  const q = rest.indexOf("?");
  if (q !== -1) rest = rest.slice(0, q);

  if (rest.startsWith("//")) {
    try {
      rest = new URL("file:" + rest).pathname;
    } catch {
      rest = rest.replace(/^\/\/+/, "/");
    }
  }

  if (!rest) return null;
  if (path.isAbsolute(rest)) return path.normalize(rest);
  return path.resolve(cwd, rest);
}

/**
 * Existence-only checks. Never opens SQLite, never migrates, never writes.
 * @returns {{ ok: true } | { ok: false, started: false, reason: "project_not_configured", missing: string[] }}
 */
function precheckProjectRoot(projectRoot) {
  const missing = [];
  const { env, found } = readProjectEnv(projectRoot);

  if (found.length === 0) {
    missing.push(".env");
  } else if (!String(env.DATABASE_URL || "").trim()) {
    missing.push("DATABASE_URL");
  } else {
    const url = env.DATABASE_URL.trim();
    if (url.startsWith("file:")) {
      const sqlitePath = resolveSqliteFilePath(url, projectRoot);
      if (!sqlitePath) {
        missing.push("sqlite");
      } else {
        try {
          if (!fs.statSync(sqlitePath).isFile()) missing.push("sqlite");
        } catch {
          missing.push("sqlite");
        }
      }
    }
  }

  try {
    if (!fs.statSync(path.join(projectRoot, "node_modules")).isDirectory()) {
      missing.push("node_modules");
    }
  } catch {
    missing.push("node_modules");
  }

  if (missing.length > 0) {
    return {
      ok: false,
      started: false,
      reason: "project_not_configured",
      missing,
    };
  }
  return { ok: true };
}

module.exports = {
  CONFIG_FILE_NAME,
  getStateDir,
  getConfigPath,
  defaultProjectRoot,
  validateProjectRoot,
  resolveProjectRoot,
  writeProjectRootConfig,
  clearProjectRootConfig,
  parseEnvFile,
  readProjectEnv,
  resolveSqliteFilePath,
  precheckProjectRoot,
};
