"use strict";

/**
 * At-rest encryption for provider/API keys stored in SQLite (YTT-437).
 *
 * Format: yttenc:v1:<iv_b64url>:<tag_b64url>:<ciphertext_b64url>
 * Algorithm: AES-256-GCM
 * Master key: TRANSCRIBER_SECRETS_KEY (64 hex chars = 32 bytes, or base64 of 32 bytes)
 *
 * Never log plaintext secrets or the master key.
 */

const crypto = require("crypto");

const ENV_NAME = "TRANSCRIBER_SECRETS_KEY";
const PREFIX = "yttenc:v1:";
const KEY_BYTES = 32;
const IV_BYTES = 12;

class SecretsKeyError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "SecretsKeyError";
  }
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isEncryptedSecret(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * Parse TRANSCRIBER_SECRETS_KEY into a 32-byte Buffer, or null if unset.
 * @param {string | undefined} raw
 * @returns {Buffer | null}
 */
function parseSecretsKey(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  try {
    const fromB64 = Buffer.from(trimmed, "base64");
    if (fromB64.length === KEY_BYTES) return fromB64;
  } catch {
    // fall through
  }

  throw new SecretsKeyError(
    `${ENV_NAME} must be 64 hex characters (openssl rand -hex 32) or base64-encoded 32 bytes.`
  );
}

/**
 * @returns {Buffer | null}
 */
function getSecretsKeyOrNull() {
  try {
    return parseSecretsKey(process.env[ENV_NAME]);
  } catch (err) {
    if (err instanceof SecretsKeyError) throw err;
    throw new SecretsKeyError(
      `${ENV_NAME} is set but invalid: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Require a valid master key or throw a clear error.
 * @returns {Buffer}
 */
function requireSecretsKey() {
  const key = getSecretsKeyOrNull();
  if (!key) {
    throw new SecretsKeyError(
      `${ENV_NAME} is required to store or decrypt API keys. ` +
        `Generate one with: openssl rand -hex 32 — then add it to .env and restart.`
    );
  }
  return key;
}

/**
 * @param {Buffer} buf
 * @returns {string}
 */
function b64url(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * @param {string} s
 * @returns {Buffer}
 */
function fromB64url(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

/**
 * Encrypt a plaintext secret for SQLite storage.
 * @param {string} plaintext
 * @param {Buffer} [key]
 * @returns {string}
 */
function encryptSecret(plaintext, key = requireSecretsKey()) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new SecretsKeyError("Cannot encrypt an empty secret");
  }
  if (isEncryptedSecret(plaintext)) {
    return plaintext;
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${b64url(iv)}:${b64url(tag)}:${b64url(ciphertext)}`;
}

/**
 * Decrypt a stored secret.
 * Plaintext database values are refused (fail closed). Only `yttenc:v1` ciphertext
 * is usable, and that still requires the master key.
 * @param {string} stored
 * @param {Buffer | null} [key]
 * @returns {string}
 */
function decryptSecret(stored, key = getSecretsKeyOrNull()) {
  if (typeof stored !== "string" || stored.length === 0) {
    throw new SecretsKeyError("Stored secret is empty");
  }
  if (!isEncryptedSecret(stored)) {
    throw new SecretsKeyError(
      `Refusing to use a plaintext API key from the database. ` +
        `Set ${ENV_NAME} (openssl rand -hex 32) and restart, or run npm run migrate:secrets, ` +
        `so existing rows are stored as ciphertext.`
    );
  }
  if (!key) {
    throw new SecretsKeyError(
      `${ENV_NAME} is required to decrypt API keys stored in the database. ` +
        `Set it in .env (openssl rand -hex 32) and restart.`
    );
  }
  const body = stored.slice(PREFIX.length);
  const parts = body.split(":");
  if (parts.length !== 3) {
    throw new SecretsKeyError("Stored secret has an invalid encryption envelope");
  }
  const [ivB64, tagB64, ctB64] = parts;
  let iv;
  let tag;
  let ciphertext;
  try {
    iv = fromB64url(ivB64);
    tag = fromB64url(tagB64);
    ciphertext = fromB64url(ctB64);
  } catch {
    throw new SecretsKeyError("Stored secret has corrupt encryption encoding");
  }
  if (iv.length !== IV_BYTES || tag.length !== 16) {
    throw new SecretsKeyError("Stored secret has invalid IV or auth tag length");
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretsKeyError(
      `Failed to decrypt API key — check that ${ENV_NAME} matches the key used when it was stored.`
    );
  }
}

/**
 * Mask a secret for API responses. Never returns plaintext.
 * Decrypts ciphertext only in-process when a master key is available.
 * A plaintext row is masked for display only; it is not a usable credential.
 * @param {string} stored
 * @returns {string}
 */
function maskStoredSecret(stored) {
  if (typeof stored !== "string" || stored.length === 0) return "****";
  let plaintext;
  try {
    if (isEncryptedSecret(stored)) {
      const key = getSecretsKeyOrNull();
      if (!key) return "••••••••";
      plaintext = decryptSecret(stored, key);
    } else {
      plaintext = stored;
    }
  } catch {
    return "••••••••";
  }
  if (plaintext.length <= 4) return "****";
  return "*".repeat(plaintext.length - 4) + plaintext.slice(-4);
}

/**
 * True when the client sent a masked placeholder (do not overwrite).
 * @param {string | undefined | null} value
 * @returns {boolean}
 */
function isMaskedPlaceholder(value) {
  if (typeof value !== "string") return false;
  const t = value.trim();
  return t.length > 0 && (/^\*+$/.test(t) || t.startsWith("***") || t.startsWith("••"));
}

/**
 * Generate a new master key (hex). For docs/scripts — do not log in app paths.
 * @returns {string}
 */
function generateSecretsKeyHex() {
  return crypto.randomBytes(KEY_BYTES).toString("hex");
}

module.exports = {
  ENV_NAME,
  PREFIX,
  SecretsKeyError,
  isEncryptedSecret,
  parseSecretsKey,
  getSecretsKeyOrNull,
  requireSecretsKey,
  encryptSecret,
  decryptSecret,
  maskStoredSecret,
  isMaskedPlaceholder,
  generateSecretsKeyHex,
};
