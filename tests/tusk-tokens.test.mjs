import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokens = require(path.join(root, "electron/tusk/tokens.js"));

const BOT = "xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUv";
const APP = "xapp-1-A01234567890-1234567890123-abcdef0123456789abcdef0123456789";

test("accepts well-formed Slack tokens and rejects bad prefixes", () => {
  assert.equal(tokens.validateBotToken(BOT).ok, true);
  assert.equal(tokens.validateBotToken(BOT).value, BOT);
  assert.equal(tokens.validateAppToken(APP).ok, true);
  assert.equal(tokens.validateBotToken("xoxp-not-a-bot").ok, false);
  assert.equal(tokens.validateAppToken("xoxb-wrong-kind").ok, false);
  assert.equal(tokens.validateBotToken("").ok, false);
  assert.equal(tokens.validateBotToken("••••wxyz").ok, false);
});

test("validation errors never include the submitted secret", () => {
  const bad = "xoxb-THIS-IS-SECRET-VALUE-12345";
  const result = tokens.validateAppToken(bad);
  assert.equal(result.ok, false);
  assert.equal(result.error.includes("THIS-IS-SECRET"), false);
  assert.equal(JSON.stringify(result).includes("THIS-IS-SECRET"), false);
});

test("mask shows saved ••••last4 and never the prefix", () => {
  assert.equal(tokens.maskToken(BOT), `saved ••••${BOT.slice(-4)}`);
  assert.equal(tokens.maskToken(BOT).includes("xoxb"), false);
  assert.equal(tokens.containsSecret(`log ${BOT}`, [BOT]), true);
  assert.equal(tokens.containsSecret("Failed to decrypt Slack bot token", [BOT]), false);
});

test("token helpers do not log secrets", () => {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.map(String).join(" "));
  try {
    tokens.validateBotToken(BOT);
    tokens.validateAppToken(APP);
    tokens.maskToken(BOT);
  } finally {
    console.error = original;
  }
  assert.equal(tokens.containsSecret(lines.join("\n"), [BOT, APP]), false);
});
