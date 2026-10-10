"use strict";

/**
 * Per-helper scoped tokens on disk (0600). Never log values.
 */

const fs = require("fs");
const path = require("path");
const { getStateDir, generateToken } = require("./local-api-token.js");
const { writeFileAtomic } = require("./write-file-atomic.js");
const { parseHelperTokensEnv } = require("./helper-scope.js");

const FILE_NAME = "helper-tokens.json";
const ENV_NAME = "TRANSCRIBER_HELPER_TOKENS";

function tokensPath(dir) {
  return path.join(dir || getStateDir(), FILE_NAME);
}

function emptyStore() {
  return { version: 1, helpers: {} };
}

function loadStore(dir) {
  const file = tokensPath(dir);
  if (!fs.existsSync(file)) return emptyStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.version !== 1) {
      return emptyStore();
    }
    const helpers =
      parsed.helpers && typeof parsed.helpers === "object" && !Array.isArray(parsed.helpers)
        ? parsed.helpers
        : {};
    return { version: 1, helpers };
  } catch {
    return emptyStore();
  }
}

function saveStore(dir, store) {
  writeFileAtomic(tokensPath(dir), JSON.stringify(store, null, 2) + "\n", 0o600);
}

function issueToken(id, dir) {
  const key = String(id || "").trim();
  if (!key) throw new Error("helper_id_required");
  const store = loadStore(dir);
  const token = generateToken();
  store.helpers[key] = { token, revoked: false };
  saveStore(dir, store);
  return token;
}

function revokeToken(id, dir) {
  const key = String(id || "").trim();
  if (!key) return;
  const store = loadStore(dir);
  if (!store.helpers[key]) return;
  store.helpers[key] = { ...store.helpers[key], token: "", revoked: true };
  saveStore(dir, store);
}

function listActiveRecords(dir) {
  const store = loadStore(dir);
  const out = [];
  for (const [id, row] of Object.entries(store.helpers)) {
    if (!row || row.revoked || typeof row.token !== "string" || !row.token) continue;
    out.push({ id, token: row.token });
  }
  return out;
}

function recordsFromEnv(env = process.env) {
  return parseHelperTokensEnv(env && env[ENV_NAME]);
}

function loadHelperRecords(dir, env = process.env) {
  const fromFile = listActiveRecords(dir);
  if (fromFile.length) return fromFile;
  return recordsFromEnv(env);
}

function serializeHelperTokensEnv(records) {
  return JSON.stringify(
    (records || []).map((row) => ({ id: row.id, token: row.token }))
  );
}

module.exports = {
  FILE_NAME,
  ENV_NAME,
  tokensPath,
  loadStore,
  issueToken,
  revokeToken,
  listActiveRecords,
  loadHelperRecords,
  serializeHelperTokensEnv,
  recordsFromEnv,
};
