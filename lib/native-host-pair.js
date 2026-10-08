"use strict";

/**
 * Extension pairing: ID comes only from Origin: chrome-extension://<32 a-p>.
 * Electron main shows a native confirm dialog over child-process IPC.
 */

const crypto = require("crypto");

const EXTENSION_ID_RE = /^[a-p]{32}$/;
const PAIR_TYPE = "native-host-pair";
const PAIR_RESULT_TYPE = "native-host-pair-result";
const PAIR_EXPIRED_TYPE = "native-host-pair-expired";

const PAIR_MESSAGE =
  "Allow the Transcriber browser extension to connect to this app?";
const UNKNOWN_STORE_WARNING =
  "This isn't the Transcriber extension from the Chrome Web Store. Only allow it if you loaded it yourself.";

// TODO: add the public Chrome Web Store extension ID when the listing exists.
const KNOWN_STORE_EXTENSION_IDS = [];

const expiredRequestIds = new Set();

function parseExtensionIdFromOrigin(origin) {
  if (typeof origin !== "string" || origin.trim().length === 0) return null;
  let parsed;
  try {
    parsed = new URL(origin.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "chrome-extension:") return null;
  const id = String(parsed.hostname || "").toLowerCase();
  if (!EXTENSION_ID_RE.test(id)) return null;
  return id;
}

function isKnownStoreExtensionId(extensionId) {
  return KNOWN_STORE_EXTENSION_IDS.includes(extensionId);
}

function pairingDetailText(extensionId) {
  const lines = [`Extension ID: ${extensionId}`];
  if (!isKnownStoreExtensionId(extensionId)) {
    lines.push(UNKNOWN_STORE_WARNING);
  }
  return lines.join("\n");
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

function createPairingController(options = {}) {
  const denyTtlMs = options.denyTtlMs ?? 60_000;
  const now = options.now || (() => Date.now());
  const randomId = options.randomId || (() => crypto.randomUUID());
  const deniedUntil = new Map();
  let pending = false;

  async function pair({ origin, send, waitForResult }) {
    const extensionId = parseExtensionIdFromOrigin(origin);
    if (!extensionId) {
      return { status: 403, body: { error: "forbidden" } };
    }
    const t = now();
    const until = deniedUntil.get(extensionId);
    if (until && t < until) {
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
      const allowed = await waitForResult(requestId);
      if (expiredRequestIds.has(requestId)) {
        return { status: 504, body: { error: "dialog_timeout" } };
      }
      if (!allowed) {
        deniedUntil.set(extensionId, now() + denyTtlMs);
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

function resetPairingControllerForTests(options) {
  expiredRequestIds.clear();
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
        resolve(!!msg.allowed);
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
  PAIR_TYPE,
  PAIR_RESULT_TYPE,
  PAIR_EXPIRED_TYPE,
  PAIR_MESSAGE,
  UNKNOWN_STORE_WARNING,
  KNOWN_STORE_EXTENSION_IDS,
  parseExtensionIdFromOrigin,
  isKnownStoreExtensionId,
  pairingDetailText,
  expireRequest,
  isRequestExpired,
  createPairingController,
  createWaitForResult,
  resetPairingControllerForTests,
  handlePairPost,
};
