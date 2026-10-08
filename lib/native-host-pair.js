"use strict";

/**
 * Extension pairing: ID comes only from Origin: chrome-extension://<32 a-p>.
 * Electron main shows a native confirm dialog over child-process IPC.
 */

const crypto = require("crypto");

const EXTENSION_ID_RE = /^[a-p]{32}$/;
const PAIR_TYPE = "native-host-pair";
const PAIR_RESULT_TYPE = "native-host-pair-result";

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

function defaultWaitForResult(requestId, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      process.off("message", onMessage);
      reject(new Error("dialog timeout"));
    }, timeoutMs);
    function onMessage(msg) {
      if (!msg || msg.type !== PAIR_RESULT_TYPE || msg.requestId !== requestId) {
        return;
      }
      clearTimeout(timer);
      process.off("message", onMessage);
      resolve(!!msg.allowed);
    }
    process.on("message", onMessage);
  });
}

async function handlePairPost(origin, ipc = {}) {
  const send = ipc.send || defaultSend;
  const waitForResult = ipc.waitForResult || defaultWaitForResult;
  try {
    return await controller.pair({ origin, send, waitForResult });
  } catch (error) {
    if (error && (error.code === "PAIRING_UNAVAILABLE" || error.message === "pairing_unavailable")) {
      return { status: 503, body: { error: "pairing_unavailable" } };
    }
    throw error;
  }
}

module.exports = {
  EXTENSION_ID_RE,
  PAIR_TYPE,
  PAIR_RESULT_TYPE,
  parseExtensionIdFromOrigin,
  createPairingController,
  resetPairingControllerForTests,
  handlePairPost,
};
