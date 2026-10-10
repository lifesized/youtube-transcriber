"use strict";

const LLM_KEY_LINKS = [
  { label: "Anthropic console", url: "https://console.anthropic.com/settings/keys" },
  { label: "OpenAI platform", url: "https://platform.openai.com/api-keys" },
  { label: "OpenRouter", url: "https://openrouter.ai/keys" },
];

const ALLOWED_LLM_KEY_ORIGINS = new Set([
  "https://console.anthropic.com",
  "https://platform.openai.com",
  "https://openrouter.ai",
]);

function isAllowedLlmKeyUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password || parsed.port) return false;
  if (!LLM_KEY_LINKS.some((link) => link.url === parsed.href)) return false;
  const origin = `${parsed.protocol}//${parsed.hostname}`;
  return ALLOWED_LLM_KEY_ORIGINS.has(origin);
}

async function openAllowedLlmKeyUrl(shell, url) {
  if (!isAllowedLlmKeyUrl(url)) return false;
  if (!shell || typeof shell.openExternal !== "function") return false;
  try {
    await shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
}

function attachOpenExternalIpc(child, shellApi) {
  if (!child || typeof child.on !== "function") return;
  child.on("message", (msg) => {
    if (!msg || msg.type !== "open-external" || !msg.requestId) return;
    Promise.resolve(openAllowedLlmKeyUrl(shellApi, msg.payload && msg.payload.url))
      .then((ok) => {
        child.send({
          type: "open-external-result",
          requestId: msg.requestId,
          payload: { ok },
        });
      })
      .catch((error) => {
        child.send({
          type: "open-external-result",
          requestId: msg.requestId,
          error: error && error.message ? error.message : "open_failed",
        });
      });
  });
}

module.exports = {
  LLM_KEY_LINKS,
  ALLOWED_LLM_KEY_ORIGINS,
  isAllowedLlmKeyUrl,
  openAllowedLlmKeyUrl,
  attachOpenExternalIpc,
};
