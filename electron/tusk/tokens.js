"use strict";

/**
 * Slack token format checks. Errors never include the submitted value.
 * Callers must not log the token.
 */

const BOT_RE = /^xoxb-[A-Za-z0-9-]{15,}$/;
const APP_RE = /^xapp-[A-Za-z0-9-]{20,}$/;
const MAX_LEN = 200;

function looksMasked(value) {
  return typeof value === "string" && /^[•*]{2,}.{0,8}$/.test(value);
}

function validateToken(value, kind) {
  const label = kind === "app" ? "App-level token" : "Bot token";
  const prefix = kind === "app" ? "xapp-" : "xoxb-";
  const re = kind === "app" ? APP_RE : BOT_RE;
  if (value == null || value === "") {
    return { ok: false, error: `${label} is required` };
  }
  if (typeof value !== "string") {
    return { ok: false, error: `${label} must be a string` };
  }
  if (looksMasked(value)) {
    return { ok: false, error: `${label} is a masked placeholder` };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, error: `${label} is required` };
  }
  if (trimmed.length > MAX_LEN) {
    return { ok: false, error: `${label} is too long` };
  }
  if (!trimmed.startsWith(prefix) || !re.test(trimmed)) {
    return { ok: false, error: `${label} must start with ${prefix}` };
  }
  return { ok: true, value: trimmed };
}

function validateBotToken(value) {
  return validateToken(value, "bot");
}

function validateAppToken(value) {
  return validateToken(value, "app");
}

function maskToken(value) {
  const s = String(value || "");
  if (!s) return "";
  if (s.length <= 4) return "saved ••••";
  return `saved ••••${s.slice(-4)}`;
}

function last4(value) {
  const s = String(value || "");
  return s.length <= 4 ? s : s.slice(-4);
}

function containsSecret(haystack, secrets) {
  const text = String(haystack || "");
  return secrets.some((secret) => secret && text.includes(secret));
}

module.exports = {
  validateBotToken,
  validateAppToken,
  looksMasked,
  maskToken,
  last4,
  containsSecret,
  BOT_RE,
  APP_RE,
};
