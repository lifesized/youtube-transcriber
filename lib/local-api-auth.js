"use strict";

/**
 * Edge-safe local API auth helpers (no fs / node:crypto).
 * Used by Next.js middleware and shared with Node via local-api-token.js.
 */

const COOKIE_NAME = "transcriber_local_token";
const ENV_NAME = "TRANSCRIBER_LOCAL_TOKEN";

/**
 * Constant-time-ish string compare safe for Edge and Node.
 * Prefer this over === for token checks.
 */
function tokensEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const lenA = a.length;
  const lenB = b.length;
  const len = Math.max(lenA, lenB);
  let mismatch = lenA === lenB ? 0 : 1;
  for (let i = 0; i < len; i++) {
    const ca = i < lenA ? a.charCodeAt(i) : 0;
    const cb = i < lenB ? b.charCodeAt(i) : 0;
    mismatch |= ca ^ cb;
  }
  return mismatch === 0 && lenA > 0;
}

/** Node callers: wrap with crypto.timingSafeEqual when buffers are equal length. */
function tokensEqualNode(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  try {
    // Lazy require so Edge bundles that tree-shake this export stay clean
    // when only tokensEqual is imported — callers in Node should use this.
    const crypto = require("crypto");
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) {
      crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
      return false;
    }
    if (bufA.length === 0) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return tokensEqual(a, b);
  }
}

function parseBearerToken(authorizationHeader) {
  if (typeof authorizationHeader !== "string") return null;
  const match = authorizationHeader.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

function parseCookieToken(cookieHeader) {
  if (typeof cookieHeader !== "string" || !cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name === COOKIE_NAME) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function isAuthorizedRequest(headers, expected, equalFn = tokensEqual) {
  if (!expected) return false;
  const bearer = parseBearerToken(headers.authorization || "");
  if (bearer && equalFn(bearer, expected)) return true;
  const cookieTok = parseCookieToken(headers.cookie || "");
  if (cookieTok && equalFn(cookieTok, expected)) return true;
  return false;
}

function unauthorizedJson() {
  return { error: "unauthorized" };
}

module.exports = {
  COOKIE_NAME,
  ENV_NAME,
  tokensEqual,
  tokensEqualNode,
  parseBearerToken,
  parseCookieToken,
  isAuthorizedRequest,
  unauthorizedJson,
};
