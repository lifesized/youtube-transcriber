"use strict";

/**
 * One-time startup cleanup of leftover legacy integration state.
 * Never decrypts leftover ciphertext. Never logs field values.
 */

const fs = require("fs");
const path = require("path");
const { getStateDir } = require("../lib/local-api-token.js");
const { writeFileAtomic } = require("./utils.js");

const SECRETS_FILE = "electron-secrets.json";
const MARKER_FILE = "legacy-integration-state.migrated";
const LEGACY_STATE_FILES = Object.freeze([
  "tusk-watch-seen.json",
  "tusk-no-key-notice.json",
]);
const LEGACY_INTEGRATION_KEY_PREFIXES = Object.freeze(["slack"]);

function isLegacyIntegrationKey(key) {
  const name = String(key || "");
  if (!name) return false;
  const lower = name.toLowerCase();
  return LEGACY_INTEGRATION_KEY_PREFIXES.some((prefix) =>
    lower.startsWith(String(prefix).toLowerCase())
  );
}

function unlinkRegularFileNoFollow(filePath) {
  let st;
  try {
    st = fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
  if (!st.isFile()) return false;
  fs.unlinkSync(filePath);
  return true;
}

function purgeLegacyIntegrationFields(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { next: data, changed: false };
  }
  const next = { ...data };
  let changed = false;
  for (const key of Object.keys(next)) {
    if (isLegacyIntegrationKey(key)) {
      delete next[key];
      changed = true;
    }
  }
  return { next, changed };
}

function markerExists(stateDir) {
  try {
    const st = fs.lstatSync(path.join(stateDir, MARKER_FILE));
    return st.isFile();
  } catch {
    return false;
  }
}

function writeMarker(stateDir) {
  writeFileAtomic(
    path.join(stateDir, MARKER_FILE),
    `${JSON.stringify({ version: 1 })}\n`,
    0o600
  );
}

function purgeSecretsFile(stateDir) {
  const filePath = path.join(stateDir, SECRETS_FILE);
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error("legacy integration state: secrets file is not JSON");
    err.code = "CORRUPT_SECRETS";
    throw err;
  }
  const { next, changed } = purgeLegacyIntegrationFields(parsed);
  if (!changed) return;
  writeFileAtomic(filePath, `${JSON.stringify(next, null, 2)}\n`, 0o600);
}

function deleteLegacyStateFiles(stateDir) {
  for (const name of LEGACY_STATE_FILES) {
    unlinkRegularFileNoFollow(path.join(stateDir, name));
  }
}

function migrateLegacyIntegrationState(stateDir = getStateDir()) {
  if (markerExists(stateDir)) {
    return { skipped: true };
  }
  purgeSecretsFile(stateDir);
  deleteLegacyStateFiles(stateDir);
  writeMarker(stateDir);
  return { skipped: false };
}

module.exports = {
  migrateLegacyIntegrationState,
  purgeLegacyIntegrationFields,
  unlinkRegularFileNoFollow,
  isLegacyIntegrationKey,
  LEGACY_INTEGRATION_KEY_PREFIXES,
  LEGACY_STATE_FILES,
  MARKER_FILE,
  SECRETS_FILE,
};
