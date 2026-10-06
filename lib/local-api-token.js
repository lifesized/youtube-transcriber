/**
 * Loopback API token for the local Transcriber server.
 *
 * The token lives in the Transcriber state directory (mode 0600).
 * TRANSCRIBER_LOCAL_TOKEN overrides the file when set; the file is then
 * updated to match so the extension, MCP server, and curl share one value.
 *
 * This module must never log the token.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const MAX_TOKEN_LENGTH = 512;

function stateDir() {
  if (process.env.TRANSCRIBER_STATE_DIR) {
    return process.env.TRANSCRIBER_STATE_DIR;
  }
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

function tokenFilePath() {
  return path.join(stateDir(), "local-api.token");
}

function chmodQuiet(target, mode) {
  try {
    fs.chmodSync(target, mode);
  } catch {
    // Windows does not honor POSIX modes.
  }
}

function prepareStateDir() {
  const dir = stateDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodQuiet(dir, 0o700);
  return dir;
}

function readTokenFile() {
  const file = tokenFilePath();
  let st;
  try {
    st = fs.lstatSync(file);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw new Error("Couldn't access the local API token file");
  }
  if (st.isSymbolicLink()) {
    throw new Error("Refusing to read a symlinked local API token file");
  }
  const raw = fs.readFileSync(file, "utf8").trim();
  return raw || null;
}

function writeTokenFile(token) {
  prepareStateDir();
  const file = tokenFilePath();
  try {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink()) fs.unlinkSync(file);
  } catch (err) {
    if (!err || err.code !== "ENOENT") {
      throw new Error("Couldn't access the local API token file");
    }
  }
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, `${token}\n`);
  } finally {
    fs.closeSync(fd);
  }
  chmodQuiet(tmp, 0o600);
  fs.renameSync(tmp, file);
  chmodQuiet(file, 0o600);
}

function createTokenFileExclusive(token) {
  prepareStateDir();
  const file = tokenFilePath();
  let fd;
  try {
    fd = fs.openSync(file, "wx", 0o600);
  } catch (err) {
    if (err && err.code === "EEXIST") {
      const existing = readTokenFile();
      if (existing) return existing;
    }
    throw new Error("Couldn't access the local API token file");
  }
  try {
    fs.writeFileSync(fd, `${token}\n`);
  } finally {
    fs.closeSync(fd);
  }
  chmodQuiet(file, 0o600);
  return token;
}

function envToken() {
  const fromEnv = (process.env.TRANSCRIBER_LOCAL_TOKEN || "").trim();
  if (!fromEnv) return null;
  if (fromEnv.length > MAX_TOKEN_LENGTH || /\s/.test(fromEnv)) {
    throw new Error("TRANSCRIBER_LOCAL_TOKEN must be a single token without whitespace");
  }
  return fromEnv;
}

function ensureLocalApiToken() {
  // `next build` evaluates server modules. Do not mint a real token then.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return envToken() || "";
  }
  const fromEnv = envToken();
  if (fromEnv) {
    let existing = null;
    try {
      existing = readTokenFile();
    } catch (err) {
      if (!err || !/symlink/i.test(err.message)) throw err;
    }
    if (existing !== fromEnv) writeTokenFile(fromEnv);
    return fromEnv;
  }
  const existing = readTokenFile();
  if (existing) {
    chmodQuiet(tokenFilePath(), 0o600);
    return existing;
  }
  return createTokenFileExclusive(crypto.randomBytes(32).toString("base64url"));
}

function tokensEqual(presented, expected) {
  const left = crypto.createHash("sha256").update(String(presented), "utf8").digest();
  const right = crypto.createHash("sha256").update(String(expected), "utf8").digest();
  return crypto.timingSafeEqual(left, right);
}

function bearerToken(authorization) {
  if (typeof authorization !== "string") return null;
  const trimmed = authorization.trim();
  const prefix = "bearer ";
  if (trimmed.length <= prefix.length) return null;
  if (trimmed.slice(0, prefix.length).toLowerCase() !== prefix) return null;
  const token = trimmed.slice(prefix.length).trim();
  if (!token || token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) return null;
  return token;
}

function localApiAuthDecision(authorization) {
  let expected;
  try {
    expected = ensureLocalApiToken();
  } catch {
    return { ok: false, status: 401 };
  }
  if (!expected) return { ok: false, status: 401 };
  const presented = bearerToken(authorization);
  if (!presented || !tokensEqual(presented, expected)) {
    return { ok: false, status: 401 };
  }
  return { ok: true, status: 200 };
}

module.exports = {
  ensureLocalApiToken,
  localApiAuthDecision,
  stateDir,
  tokenFilePath,
};

if (require.main === module) {
  if (process.argv[2] === "--path") {
    process.stdout.write(tokenFilePath());
  } else {
    process.stderr.write("Usage: node lib/local-api-token.js --path\n");
    process.exit(1);
  }
}
