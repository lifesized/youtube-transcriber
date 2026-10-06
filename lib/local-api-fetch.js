"use strict";

/**
 * Fail-closed client for the local Transcriber API (YTT-438).
 *
 * Auth is the YTT-435 loopback Bearer token: TRANSCRIBER_LOCAL_TOKEN, else an
 * existing shared token file. This client never mints or writes that file.
 * Header shape matches extension/local-auth-headers.js (localAuthHeadersFromToken).
 * No second scheme, no client apiKey, and no request when the token is missing.
 */

const fs = require("fs");
const { ENV_NAME, getLocalApiTokenPath } = require("./local-api-token.js");
const { localAuthHeadersFromToken } = require("../extension/local-auth-headers.js");

/** Match lib/local-api-token.js MIN_BYTES. Shorter file contents are not a token. */
const MIN_TOKEN_LENGTH = 32;

/**
 * Read the shared token file. Missing, unreadable, or too-short files yield null.
 * Does not create directories or files.
 * @returns {string | null}
 */
function readExistingTokenFile() {
  try {
    const existing = fs.readFileSync(getLocalApiTokenPath(), "utf8").trim();
    if (existing.length >= MIN_TOKEN_LENGTH) return existing;
    return null;
  } catch {
    return null;
  }
}

class LocalApiAuthError extends Error {
  /**
   * @param {string} message user-facing; must not include the token
   */
  constructor(message) {
    super(message);
    this.name = "LocalApiAuthError";
    this.code = "LOCAL_AUTH_REQUIRED";
  }
}

/**
 * Read-only. Env token, else the existing shared token file. Never mints.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {() => string | null | undefined} [readFile]
 * @returns {string | null}
 */
function resolveSharedLocalToken(env = process.env, readFile = readExistingTokenFile) {
  const fromEnv = env[ENV_NAME];
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  if (typeof readFile !== "function") return null;
  try {
    const token = readFile();
    if (typeof token === "string" && token.length > 0) return token;
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} headers
 * @returns {Record<string, string>}
 */
function plainHeaders(headers) {
  if (!headers) return {};
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    /** @type {Record<string, string>} */
    const out = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    /** @type {Record<string, string>} */
    const out = {};
    for (const pair of headers) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      out[String(pair[0])] = String(pair[1]);
    }
    return out;
  }
  if (typeof headers === "object") {
    return { .../** @type {Record<string, string>} */ (headers) };
  }
  return {};
}

/**
 * @param {unknown} token
 * @returns {Record<string, string>}
 */
function requireLocalAuthHeaders(token) {
  const headers = localAuthHeadersFromToken(
    typeof token === "string" ? token : null
  );
  if (!headers.Authorization) {
    throw new LocalApiAuthError(
      "Refusing to call the local API without a loopback token. Set TRANSCRIBER_LOCAL_TOKEN or start YouTube Transcriber so the shared token file exists."
    );
  }
  return headers;
}

/**
 * @param {unknown} confirm
 * @returns {string | null} refusal message, or null when deletion may proceed
 */
function rejectUnconfirmedDelete(confirm) {
  if (confirm === true) return null;
  return "Refusing to delete this transcript. Call delete_transcript again with confirm set to true to permanently delete it.";
}

/**
 * Delete only after an explicit confirm: true. Callbacks are not invoked otherwise.
 *
 * @param {{
 *   id: unknown,
 *   confirm: unknown,
 *   getTranscript: (id: string) => Promise<{ title?: string } | null | undefined>,
 *   deleteTranscript: (id: string) => Promise<void>,
 * }} args
 * @returns {Promise<{ deleted: boolean, title?: string, message?: string }>}
 */
async function guardedDeleteTranscript({
  id,
  confirm,
  getTranscript,
  deleteTranscript,
}) {
  const refused = rejectUnconfirmedDelete(confirm);
  if (refused) return { deleted: false, message: refused };
  if (typeof id !== "string" || id.trim().length === 0) {
    return { deleted: false, message: "Transcript id is required." };
  }
  const video = await getTranscript(id);
  await deleteTranscript(id);
  const title =
    video && typeof video.title === "string" && video.title.length > 0
      ? video.title
      : id;
  return { deleted: true, title };
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {{
 *   token?: unknown,
 *   env?: NodeJS.ProcessEnv,
 *   readTokenFile?: () => string | null | undefined,
 *   fetchImpl?: typeof fetch,
 * }} [options]
 *   Pass `token` (including null) to skip env/file lookup. Omit `token` to
 *   resolve the shared YTT-435 token (read-only).
 * @returns {Promise<Response>}
 */
async function authorizedFetch(url, init, options) {
  const opts = options || {};
  const token = Object.prototype.hasOwnProperty.call(opts, "token")
    ? opts.token
    : resolveSharedLocalToken(opts.env, opts.readTokenFile);
  const authHeaders = requireLocalAuthHeaders(token);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available");
  }
  const headers = {
    ...plainHeaders(init && init.headers),
    ...authHeaders,
  };
  return fetchImpl(url, { ...(init || {}), headers });
}

module.exports = {
  LocalApiAuthError,
  resolveSharedLocalToken,
  requireLocalAuthHeaders,
  rejectUnconfirmedDelete,
  guardedDeleteTranscript,
  authorizedFetch,
};
