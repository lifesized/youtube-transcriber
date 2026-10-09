"use strict";

const crypto = require("crypto");

const DEFAULT_IPC_TIMEOUT_MS = 10_000;
/** Longer than a native confirm dialog; a timed-out tusk-set also sends a cancel. */
const TUSK_SET_TIMEOUT_MS = 900_000;

function requestFromMain(type, payload = {}, timeoutMs) {
  if (typeof process.send !== "function") {
    const err = new Error("electron_ipc_unavailable");
    err.code = "ELECTRON_IPC_UNAVAILABLE";
    throw err;
  }
  const ms =
    timeoutMs ?? (type === "tusk-set" ? TUSK_SET_TIMEOUT_MS : DEFAULT_IPC_TIMEOUT_MS);
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      process.off("message", onMessage);
      try {
        if (typeof process.send === "function") {
          process.send({ type: `${type}-cancel`, requestId });
        }
      } catch {
        // child may already be gone
      }
      reject(new Error("electron_ipc_timeout"));
    }, ms);
    function onMessage(msg) {
      if (!msg || msg.requestId !== requestId) return;
      clearTimeout(timer);
      process.off("message", onMessage);
      if (msg.error) {
        const err = new Error(msg.error);
        if (msg.status) err.status = msg.status;
        reject(err);
      } else resolve(msg.payload);
    }
    process.on("message", onMessage);
    process.send({ type, payload, requestId });
  });
}

function secretsFromEnv() {
  const llmProvider = process.env.LLM_PROVIDER || "";
  const llmApiKey =
    llmProvider === "openai"
      ? process.env.OPENAI_API_KEY || ""
      : llmProvider === "anthropic"
        ? process.env.ANTHROPIC_API_KEY || ""
        : process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || "";
  return {
    llmProvider,
    llmApiKey,
    notionToken: process.env.NOTION_TOKEN || "",
    notionDatabaseId: process.env.NOTION_DATABASE_ID || "",
  };
}

async function getSecretsFromMainOrEnv() {
  // Electron child: secrets come from main over IPC only. Do not fall back
  // to process.env — a key cleared in Settings must stop working immediately.
  if (process.env.ELECTRON_RUN_AS_NODE) {
    return await requestFromMain("secrets-get");
  }
  try {
    return await requestFromMain("secrets-get");
  } catch (error) {
    if (error && error.code === "ELECTRON_IPC_UNAVAILABLE") {
      return secretsFromEnv();
    }
    throw error;
  }
}

module.exports = {
  requestFromMain,
  getSecretsFromMainOrEnv,
  secretsFromEnv,
  DEFAULT_IPC_TIMEOUT_MS,
  TUSK_SET_TIMEOUT_MS,
};
