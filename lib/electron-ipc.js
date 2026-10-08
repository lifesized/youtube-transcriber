"use strict";

const crypto = require("crypto");

function requestFromMain(type, payload = {}, timeoutMs = 10_000) {
  if (typeof process.send !== "function") {
    const err = new Error("electron_ipc_unavailable");
    err.code = "ELECTRON_IPC_UNAVAILABLE";
    throw err;
  }
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      process.off("message", onMessage);
      reject(new Error("electron_ipc_timeout"));
    }, timeoutMs);
    function onMessage(msg) {
      if (!msg || msg.requestId !== requestId) return;
      clearTimeout(timer);
      process.off("message", onMessage);
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.payload);
    }
    process.on("message", onMessage);
    process.send({ type, payload, requestId });
  });
}

async function getSecretsFromMainOrEnv() {
  try {
    return await requestFromMain("secrets-get");
  } catch (error) {
    if (error && error.code === "ELECTRON_IPC_UNAVAILABLE") {
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
    throw error;
  }
}

module.exports = {
  requestFromMain,
  getSecretsFromMainOrEnv,
};
