"use strict";

/**
 * Per-helper scoped tokens on disk (0600). Re-read on every check.
 * Never log values. Never put tokens in process.env.
 */

const fs = require("fs");
const path = require("path");
const { getStateDir, generateToken } = require("./local-api-token.js");
const { writeFileAtomic } = require("./write-file-atomic.js");
const { authorizeHelperBearer } = require("./helper-scope.js");

const FILE_NAME = "helper-tokens.json";

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
  const prev = store.helpers[key] || {};
  const token = generateToken();
  store.helpers[key] = {
    token,
    revoked: false,
    enabled: Boolean(prev.enabled),
  };
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

function setEnabled(id, enabled, dir) {
  const key = String(id || "").trim();
  if (!key) return false;
  const store = loadStore(dir);
  const prev = store.helpers[key] || { token: "", revoked: true };
  store.helpers[key] = { ...prev, enabled: Boolean(enabled) };
  saveStore(dir, store);
  return Boolean(enabled);
}

function isEnabled(id, dir) {
  const key = String(id || "").trim();
  const row = loadStore(dir).helpers[key];
  return Boolean(row && row.enabled);
}

function listActiveRecords(dir) {
  const store = loadStore(dir);
  const out = [];
  for (const [id, row] of Object.entries(store.helpers)) {
    if (!row || row.revoked || typeof row.token !== "string" || !row.token) continue;
    out.push({ id, token: row.token, enabled: Boolean(row.enabled) });
  }
  return out;
}

function authorizeHelperFromStore(headers, options = {}) {
  return authorizeHelperBearer(headers, {
    method: options.method,
    pathname: options.pathname,
    records: listActiveRecords(options.stateDir).filter((row) => row.enabled),
    equalFn: options.equalFn,
  });
}

module.exports = {
  FILE_NAME,
  tokensPath,
  loadStore,
  issueToken,
  revokeToken,
  setEnabled,
  isEnabled,
  listActiveRecords,
  authorizeHelperFromStore,
};
