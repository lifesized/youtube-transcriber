"use strict";

/**
 * Edge-safe local API auth helpers (no fs / node:crypto).
 * Used by Next.js middleware and shared with Node via local-api-token.js.
 */

const COOKIE_PREFIX = "transcriber_local_token";
const ENV_NAME = "TRANSCRIBER_LOCAL_TOKEN";
const DEFAULT_PORT = 19720;

function configuredPort() {
  const raw = process.env.PORT;
  const n = raw ? Number.parseInt(String(raw), 10) : DEFAULT_PORT;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PORT;
}

/**
 * Cookies are scoped to the host, not the port, so the Dev (19720) and App
 * (19721) servers would share one cookie without the port in its name.
 */
function cookieName(port = configuredPort()) {
  return `${COOKIE_PREFIX}_${port}`;
}

function allowedLoopbackHosts(port = configuredPort()) {
  const p = String(port);
  return [`127.0.0.1:${p}`, `localhost:${p}`];
}

function isAllowedLoopbackHost(hostHeader, port = configuredPort()) {
  if (typeof hostHeader !== "string") return false;
  const host = hostHeader.trim().toLowerCase();
  return allowedLoopbackHosts(port).includes(host);
}

/**
 * Same-origin loads, and top-level document navigations from anywhere: the
 * extension's and tray's Library tabs arrive as `none` or `cross-site`. A
 * cross-site page can trigger those, but it cannot read the cookie, and
 * cookie auth on /api/* refuses anything that is not same-origin.
 */
function shouldMintTokenCookie({ site, mode, dest } = {}) {
  if (site === "none" || site === "same-origin") return true;
  return mode === "navigate" && dest === "document";
}

/** Dev and App are same-site to each other, so `same-site` is cross-port. */
function allowsCookieAuth(secFetchSite) {
  return secFetchSite === "same-origin" || secFetchSite === "none";
}

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

function parseCookieToken(cookieHeader, name = cookieName()) {
  if (typeof cookieHeader !== "string" || !cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function isAuthorizedRequest(headers, expected, equalFn = tokensEqual, port = configuredPort()) {
  if (!expected) return false;
  const bearer = parseBearerToken(headers.authorization || "");
  if (bearer && equalFn(bearer, expected)) return true;
  if (!allowsCookieAuth(headers.secFetchSite)) return false;
  const cookieTok = parseCookieToken(headers.cookie || "", cookieName(port));
  if (cookieTok && equalFn(cookieTok, expected)) return true;
  return false;
}

/**
 * Settings writes that store secrets (Tusk tokens) are only accepted from
 * the Settings page: the port-scoped cookie AND Sec-Fetch-Site: same-origin.
 * Any Authorization header is rejected — a minted cookie plus curl plus
 * Bearer is not the Settings page.
 */
function isSettingsPageWrite(headers, expected, equalFn = tokensEqual, port = configuredPort()) {
  if (!expected) return false;
  if (headers.authorization != null && String(headers.authorization) !== "") return false;
  if (headers.secFetchSite !== "same-origin") return false;
  const cookieTok = parseCookieToken(headers.cookie || "", cookieName(port));
  return Boolean(cookieTok && equalFn(cookieTok, expected));
}

function unauthorizedJson() {
  return { error: "unauthorized" };
}

module.exports = {
  ENV_NAME,
  DEFAULT_PORT,
  configuredPort,
  cookieName,
  allowedLoopbackHosts,
  isAllowedLoopbackHost,
  shouldMintTokenCookie,
  allowsCookieAuth,
  tokensEqual,
  tokensEqualNode,
  parseBearerToken,
  parseCookieToken,
  isAuthorizedRequest,
  isSettingsPageWrite,
  unauthorizedJson,
};
