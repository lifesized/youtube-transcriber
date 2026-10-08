"use strict";

/**
 * Extension pairing: ID comes only from Origin: chrome-extension://<32 a-p>.
 * Electron main shows a native confirm dialog over child-process IPC.
 */

const crypto = require("crypto");

const EXTENSION_ID_RE = /^[a-p]{32}$/;
const ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;
const PAIR_TYPE = "native-host-pair";
const PAIR_RESULT_TYPE = "native-host-pair-result";
const PAIR_EXPIRED_TYPE = "native-host-pair-expired";
const PAIR_WINDOW_TYPE = "native-host-pair-window";
const PAIRING_WINDOW_MS = 120_000;

const PAIR_MESSAGE = "An extension wants full access to Transcriber";
const PAIR_DETAIL_ACCESS =
  "Allowing it lets it read all your transcripts and change your settings.";
const UNKNOWN_STORE_WARNING =
  "This isn't the Transcriber extension from the Chrome Web Store. Only allow it if you loaded it yourself.";

// TODO: add the public Chrome Web Store extension ID when the listing exists.
const KNOWN_STORE_EXTENSION_IDS = [];

const expiredRequestIds = new Set();
let pairingOpenUntil = 0;

function parseExtensionIdFromOrigin(origin) {
  if (typeof origin !== "string" || origin.trim().length === 0) return null;
  const trimmed = origin.trim();
  if (!ORIGIN_RE.test(trimmed)) return null;
  return trimmed.slice("chrome-extension://".length);
}

function filterValidExtensionIds(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id) => typeof id === "string" && EXTENSION_ID_RE.test(id));
}

function isKnownStoreExtensionId(extensionId) {
  return KNOWN_STORE_EXTENSION_IDS.includes(extensionId);
}

function pairingDetailText(extensionId) {
  const lines = [`Extension ID: ${extensionId}. ${PAIR_DETAIL_ACCESS}`];
  if (!isKnownStoreExtensionId(extensionId)) {
    lines.push(UNKNOWN_STORE_WARNING);
  }
  return lines.join("\n");
}

function openPairingWindow(now = Date.now(), durationMs = PAIRING_WINDOW_MS) {
  pairingOpenUntil = now + durationMs;
  return pairingOpenUntil;
}

function isPairingWindowOpen(now = Date.now()) {
  return now < pairingOpenUntil;
}

function applyPairingWindowMessage(msg) {
  if (msg && msg.type === PAIR_WINDOW_TYPE && typeof msg.openUntil === "number") {
    pairingOpenUntil = msg.openUntil;
  }
}

if (typeof process.on === "function") {
  process.on("message", applyPairingWindowMessage);
}

function expireRequest(requestId, send) {
  expiredRequestIds.add(requestId);
  if (typeof send === "function") {
    send({ type: PAIR_EXPIRED_TYPE, requestId });
  } else if (typeof process.send === "function") {
    process.send({ type: PAIR_EXPIRED_TYPE, requestId });
  }
}

function isRequestExpired(requestId) {
  return expiredRequestIds.has(requestId);
}

function normalizeOutcome(outcome) {
  if (outcome === true) return { allowed: true, reason: null };
  if (outcome === false) return { allowed: false, reason: null };
  if (outcome && typeof outcome === "object") {
    return { allowed: !!outcome.allowed, reason: outcome.reason || null };
  }
  return { allowed: false, reason: null };
}

function createPairingController(options = {}) {
  const denyTtlMs = options.denyTtlMs ?? 60_000;
  const now = options.now || (() => Date.now());
  const randomId = options.randomId || (() => crypto.randomUUID());
  let deniedUntil = 0;
  let pending = false;

  async function pair({ origin, send, waitForResult }) {
    const extensionId = parseExtensionIdFromOrigin(origin);
    if (!extensionId) {
      return { status: 403, body: { error: "forbidden" } };
    }
    const t = now();
    if (t >= pairingOpenUntil) {
      return { status: 403, body: { error: "forbidden" } };
    }
    if (deniedUntil && t < deniedUntil) {
      return { status: 403, body: { error: "forbidden" } };
    }
    if (pending) {
      return { status: 409, body: { error: "dialog_pending" } };
    }
    if (typeof send !== "function" || typeof waitForResult !== "function") {
      return { status: 503, body: { error: "pairing_unavailable" } };
    }

    pending = true;
    const requestId = randomId();
    try {
      send({ type: PAIR_TYPE, extensionId, requestId });
      const outcome = normalizeOutcome(await waitForResult(requestId));
      if (expiredRequestIds.has(requestId)) {
        return { status: 504, body: { error: "dialog_timeout" } };
      }
      if (outcome.reason) {
        return { status: 403, body: { error: "forbidden" } };
      }
      if (!outcome.allowed) {
        deniedUntil = now() + denyTtlMs;
        return { status: 403, body: { error: "denied", extensionId } };
      }
      return { status: 200, body: { ok: true, extensionId } };
    } finally {
      pending = false;
    }
  }

  return { pair };
}

let controller = createPairingController();

function resetPairingControllerForTests(options = {}) {
  expiredRequestIds.clear();
  const now = options.now ? options.now() : Date.now();
  pairingOpenUntil =
    options.pairingOpenUntil !== undefined
      ? options.pairingOpenUntil
      : now + PAIRING_WINDOW_MS;
  controller = createPairingController(options);
  return controller;
}

function defaultSend(msg) {
  if (typeof process.send !== "function") {
    const err = new Error("pairing_unavailable");
    err.code = "PAIRING_UNAVAILABLE";
    throw err;
  }
  process.send(msg);
}

function createWaitForResult(options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const sendExpired = options.sendExpired;
  return function waitForResult(requestId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        process.off("message", onMessage);
        expireRequest(requestId, sendExpired);
        reject(new Error("dialog timeout"));
      }, timeoutMs);
      function onMessage(msg) {
        if (!msg || msg.type !== PAIR_RESULT_TYPE || msg.requestId !== requestId) {
          return;
        }
        if (expiredRequestIds.has(requestId)) {
          return;
        }
        clearTimeout(timer);
        process.off("message", onMessage);
        resolve({ allowed: !!msg.allowed, reason: msg.reason || null });
      }
      process.on("message", onMessage);
    });
  };
}

const defaultWaitForResult = createWaitForResult();

async function handlePairPost(origin, ipc = {}) {
  const send = ipc.send || defaultSend;
  const waitForResult = ipc.waitForResult || defaultWaitForResult;
  try {
    return await controller.pair({ origin, send, waitForResult });
  } catch (error) {
    if (error && (error.code === "PAIRING_UNAVAILABLE" || error.message === "pairing_unavailable")) {
      return { status: 503, body: { error: "pairing_unavailable" } };
    }
    if (error && error.message === "dialog timeout") {
      return { status: 504, body: { error: "dialog_timeout" } };
    }
    throw error;
  }
}

module.exports = {
  EXTENSION_ID_RE,
  ORIGIN_RE,
  PAIR_TYPE,
  PAIR_RESULT_TYPE,
  PAIR_EXPIRED_TYPE,
  PAIR_WINDOW_TYPE,
  PAIRING_WINDOW_MS,
  PAIR_MESSAGE,
  PAIR_DETAIL_ACCESS,
  UNKNOWN_STORE_WARNING,
  KNOWN_STORE_EXTENSION_IDS,
  parseExtensionIdFromOrigin,
  filterValidExtensionIds,
  isKnownStoreExtensionId,
  pairingDetailText,
  openPairingWindow,
  isPairingWindowOpen,
  applyPairingWindowMessage,
  expireRequest,
  isRequestExpired,
  createPairingController,
  createWaitForResult,
  resetPairingControllerForTests,
  handlePairPost,
};
