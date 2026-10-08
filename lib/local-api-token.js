"use strict";

/**
 * Shared local API loopback token (YTT-435).
 *
 * Token sources (in order):
 *   1. process.env.TRANSCRIBER_LOCAL_TOKEN (if set)
 *   2. Token file under the Transcriber state dir (created on first need)
 *
 * Never log the token value. Compare with tokensEqual() (timing-safe).
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  COOKIE_NAME,
  ENV_NAME,
  tokensEqualNode,
  parseBearerToken,
  parseCookieToken,
  isAuthorizedRequest: isAuthorizedRequestBase,
  unauthorizedJson,
} = require("./local-api-auth.js");
const { writeFileAtomic } = require("./write-file-atomic.js");

const TOKEN_FILE_NAME = "local-api.token";
const MIN_BYTES = 32;

function tokensEqual(a, b) {
  return tokensEqualNode(a, b);
}

function getStateDir() {
  const override = process.env.TRANSCRIBER_STATE_DIR;
  if (typeof override === "string" && override.trim()) {
    return override.trim();
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

/**
 * Native-host / Electron log directory.
 *
 * Checkout default on macOS is ~/Library/Logs/Transcriber. The packaged app
 * pins TRANSCRIBER_STATE_DIR to ".../Transcriber App" (a sibling, not a
 * child), so logs follow that basename under ~/Library/Logs/Transcriber App.
 */
function getLogDir(state = getStateDir()) {
  const override = process.env.TRANSCRIBER_LOG_DIR;
  if (typeof override === "string" && override.trim()) {
    return override.trim();
  }
  if (process.platform === "darwin") {
    const appSupport = path.join(os.homedir(), "Library", "Application Support");
    if (path.dirname(state) === appSupport) {
      return path.join(os.homedir(), "Library", "Logs", path.basename(state));
    }
    return path.join(state, "logs");
  }
  return state;
}

function getLocalApiTokenPath() {
  return path.join(getStateDir(), TOKEN_FILE_NAME);
}

function generateToken() {
  return crypto.randomBytes(MIN_BYTES).toString("hex");
}

function writeTokenFile(token) {
  const filePath = getLocalApiTokenPath();
  writeFileAtomic(filePath, token, 0o600);
  return filePath;
}

function ensureLocalApiToken(opts = {}) {
  const writeEnvToFile = opts.writeEnvToFile !== false;
  const fromEnv = process.env[ENV_NAME];
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    if (writeEnvToFile) {
      try {
        const existing = fs.readFileSync(getLocalApiTokenPath(), "utf8").trim();
        if (!tokensEqual(existing, fromEnv)) {
          writeTokenFile(fromEnv);
        }
      } catch {
        writeTokenFile(fromEnv);
      }
    }
    return fromEnv;
  }

  const filePath = getLocalApiTokenPath();
  try {
    const existing = fs.readFileSync(filePath, "utf8").trim();
    if (existing.length >= MIN_BYTES) {
      return existing;
    }
  } catch {
    // create below
  }

  const token = generateToken();
  writeTokenFile(token);
  return token;
}

function ensureInEnv(opts) {
  const token = ensureLocalApiToken(opts);
  process.env[ENV_NAME] = token;
  return token;
}

function rotateLocalApiToken() {
  const token = generateToken();
  writeTokenFile(token);
  process.env[ENV_NAME] = token;
  return token;
}

function getExpectedToken() {
  const fromEnv = process.env[ENV_NAME];
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  try {
    return ensureLocalApiToken({ writeEnvToFile: false });
  } catch {
    return null;
  }
}

function isAuthorizedRequest(headers, expected) {
  return isAuthorizedRequestBase(headers, expected, tokensEqual);
}

module.exports = {
  TOKEN_FILE_NAME,
  COOKIE_NAME,
  ENV_NAME,
  getStateDir,
  getLogDir,
  getLocalApiTokenPath,
  tokensEqual,
  ensureLocalApiToken,
  ensureInEnv,
  rotateLocalApiToken,
  getExpectedToken,
  parseBearerToken,
  parseCookieToken,
  isAuthorizedRequest,
  unauthorizedJson,
  generateToken,
  writeTokenFile,
};
