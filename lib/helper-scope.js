"use strict";

/**
 * Edge-safe helper token scope. No fs. Never log token values.
 */

const { parseBearerToken, tokensEqual } = require("./local-api-auth.js");

const HELPER_ALLOWED_ROUTES = [
  { method: "GET", pathname: "/api/summaries" },
  { method: "POST", pathname: "/api/summaries" },
  { method: "POST", pathname: "/api/transcripts" },
  { method: "GET", pathname: "/api/settings" },
];

const SETTINGS_SECRET_KEYS = ["groq_api_key"];
const HELPER_TOKEN_SHAPE = /^[0-9a-f]{64,128}$/i;

function normalizePathname(pathname) {
  const raw = String(pathname || "").split("?")[0];
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw;
}

function isHelperAllowedRoute(method, pathname) {
  const m = String(method || "GET").toUpperCase();
  const p = normalizePathname(pathname);
  return HELPER_ALLOWED_ROUTES.some((row) => row.method === m && row.pathname === p);
}

function looksLikeHelperToken(authorizationHeader) {
  const bearer = parseBearerToken(authorizationHeader);
  return typeof bearer === "string" && HELPER_TOKEN_SHAPE.test(bearer);
}

function helperShapeAllowed(headers, method, pathname) {
  return looksLikeHelperToken(headers && headers.authorization) && isHelperAllowedRoute(method, pathname);
}

function matchHelperToken(bearer, records, equalFn = tokensEqual) {
  if (typeof bearer !== "string" || !bearer || !Array.isArray(records)) return null;
  for (const rec of records) {
    if (!rec || typeof rec.token !== "string") continue;
    if (equalFn(bearer, rec.token)) return rec;
  }
  return null;
}

function authorizeHelperBearer(headers, options = {}) {
  const bearer = parseBearerToken(headers && headers.authorization);
  if (!bearer) return { ok: false, reason: "no_bearer" };
  const records = Array.isArray(options.records) ? options.records : [];
  const rec = matchHelperToken(bearer, records, options.equalFn || tokensEqual);
  if (!rec) return { ok: false, reason: "unknown_token" };
  if (!isHelperAllowedRoute(options.method, options.pathname)) {
    return { ok: false, reason: "scope", id: rec.id };
  }
  return { ok: true, id: rec.id };
}

function stripSecretSettings(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const out = { ...payload };
  for (const key of SETTINGS_SECRET_KEYS) delete out[key];
  return out;
}

module.exports = {
  HELPER_ALLOWED_ROUTES,
  SETTINGS_SECRET_KEYS,
  normalizePathname,
  isHelperAllowedRoute,
  looksLikeHelperToken,
  helperShapeAllowed,
  matchHelperToken,
  authorizeHelperBearer,
  stripSecretSettings,
};
