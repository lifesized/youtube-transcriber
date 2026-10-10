import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const links = require(path.join(root, "electron/tusk/llm-links.js"));
const { createNoKeyNotice } = require(path.join(root, "electron/tusk/no-key-notice.js"));
const { COPY } = require(path.join(root, "electron/tusk/errors.js"));

test("no-key copy and Slack text include the three signup links, never a key", () => {
  assert.equal(COPY.no_llm, "Tusk needs an AI key. Open Transcriber > Settings to add one.");
  assert.equal(links.NO_KEY_COPY, COPY.no_llm);
  const text = links.noKeySlackText();
  assert.match(text, /Tusk needs an AI key/);
  assert.match(text, /https:\/\/console\.anthropic\.com\/settings\/keys/);
  assert.match(text, /https:\/\/platform\.openai\.com\/api-keys/);
  assert.match(text, /https:\/\/openrouter\.ai\/keys/);
  assert.doesNotMatch(text, /sk-|xoxb|xapp|Bearer/i);
});

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
  assert.equal(
    await links.openAllowedLlmKeyUrl(shell, "https://evil.example/keys"),
    false
  );
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

  const mixed = [];
  const mixedShell = { openExternal: async (url) => mixed.push(url) };
  assert.equal(
    await links.openAllowedLlmKeyUrl(mixedShell, "https://Console.Anthropic.com/settings/keys"),
    true
  );
  assert.deepEqual(mixed, [allowed[0]]);
  assert.equal(links.canonicalLlmKeyUrl("https://Console.Anthropic.com/settings/keys"), allowed[0]);
});

test("no-key cooldown map is bounded (LRU prune)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tusk-nokey-lru-"));
  let clock = 1_000;
  try {
    const notice = createNoKeyNotice({
      stateDir: dir,
      cooldownMs: 6 * 60 * 60 * 1000,
      maxChannels: 3,
      now: () => clock,
    });
    notice.markPosted("C1");
    clock += 1;
    notice.markPosted("C2");
    clock += 1;
    notice.markPosted("C3");
    clock += 1;
    notice.markPosted("C4");
    const saved = JSON.parse(readFileSync(notice.path(), "utf8"));
    assert.equal(Object.keys(saved.channels).length, 3);
    assert.equal(saved.channels.C1, undefined);
    assert.ok(saved.channels.C2);
    assert.ok(saved.channels.C4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no-key notice persists per channel with 0600 and a 6h cooldown", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tusk-nokey-store-"));
  let clock = 5_000;
  try {
    const notice = createNoKeyNotice({
      stateDir: dir,
      cooldownMs: 6 * 60 * 60 * 1000,
      now: () => clock,
    });
    assert.equal(notice.shouldPost("C01234567"), true);
    assert.equal(notice.shouldPost(""), false);
    notice.markPosted("C01234567");
    assert.equal(notice.shouldPost("C01234567"), false);
    assert.equal(notice.shouldPost("C07654321"), true);
    const file = notice.path();
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(saved.version, 1);
    assert.equal(typeof saved.channels.C01234567, "number");
    clock += 6 * 60 * 60 * 1000 + 1;
    assert.equal(notice.shouldPost("C01234567"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
