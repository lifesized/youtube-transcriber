import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const links = require(path.join(root, "electron/llm-links.js"));

test("only the three https signup URLs are allowed for openExternal", async () => {
  const allowed = links.LLM_KEY_LINKS.map((link) => link.url);
  assert.deepEqual(allowed, [
    "https://console.anthropic.com/settings/keys",
    "https://platform.openai.com/api-keys",
    "https://openrouter.ai/keys",
  ]);
  for (const url of allowed) assert.equal(links.isAllowedLlmKeyUrl(url), true);

  const opened = [];
  const shell = { openExternal: async (url) => opened.push(url) };
  assert.equal(await links.openAllowedLlmKeyUrl(shell, allowed[0]), true);
  assert.equal(await links.openAllowedLlmKeyUrl(shell, "https://evil.example/keys"), false);
  assert.equal(await links.openAllowedLlmKeyUrl(shell, "http://console.anthropic.com/settings/keys"), false);
  assert.equal(
    await links.openAllowedLlmKeyUrl(shell, "https://user:pass@console.anthropic.com/settings/keys"),
    false
  );
  assert.equal(
    await links.openAllowedLlmKeyUrl(shell, "https://console.anthropic.com:8443/settings/keys"),
    false
  );
  assert.equal(await links.openAllowedLlmKeyUrl(shell, "javascript:alert(1)"), false);
  assert.deepEqual(opened, [allowed[0]]);
});
