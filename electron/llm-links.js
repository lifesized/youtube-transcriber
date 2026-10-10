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

function matchAllowedLlmKeyLink(value) {
  const raw = String(value ?? "");
  if (!raw || raw.includes("\\")) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port && parsed.port !== "443") return null;
  let canonical;
  try {
    canonical = new URL(
      `https://${parsed.hostname}${parsed.pathname}${parsed.search}${parsed.hash}`
    );
  } catch {
    return null;
  }
  if (canonical.port) return null;
  const origin = `${canonical.protocol}//${canonical.hostname}`;
  if (!ALLOWED_LLM_KEY_ORIGINS.has(origin)) return null;
  return LLM_KEY_LINKS.find((link) => link.url === canonical.href) || null;
}

function isAllowedLlmKeyUrl(value) {
  return matchAllowedLlmKeyLink(value) != null;
}

async function openAllowedLlmKeyUrl(shell, url) {
  const match = matchAllowedLlmKeyLink(url);
  if (!match) return false;
  if (!shell || typeof shell.openExternal !== "function") return false;
  try {
    await shell.openExternal(match.url);
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
  matchAllowedLlmKeyLink,
  isAllowedLlmKeyUrl,
  openAllowedLlmKeyUrl,
  attachOpenExternalIpc,
};
