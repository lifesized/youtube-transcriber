import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pair = require("../lib/native-host-pair.js");

const VALID_ID = "abcdefghijklmnopabcdefghijklmnop";
const VALID_ORIGIN = `chrome-extension://${VALID_ID}`;

test("no Origin gives 403", async () => {
  pair.resetPairingControllerForTests();
  const sent = [];
  const result = await pair.handlePairPost(undefined, {
    send: (msg) => sent.push(msg),
    waitForResult: async () => true,
  });
  assert.equal(result.status, 403);
  assert.equal(sent.length, 0);
});

test("https web origin gives 403", async () => {
  pair.resetPairingControllerForTests();
  const sent = [];
  const result = await pair.handlePairPost("https://example.com", {
    send: (msg) => sent.push(msg),
    waitForResult: async () => true,
  });
  assert.equal(result.status, 403);
  assert.equal(sent.length, 0);
});

test("valid extension origin emits a dialog request (mock IPC)", async () => {
  pair.resetPairingControllerForTests({ randomId: () => "req-1" });
  const sent = [];
  const result = await pair.handlePairPost(VALID_ORIGIN, {
    send: (msg) => sent.push(msg),
    waitForResult: async (requestId) => {
      assert.equal(requestId, "req-1");
      return true;
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.extensionId, VALID_ID);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "native-host-pair");
  assert.equal(sent[0].extensionId, VALID_ID);
  assert.equal(sent[0].requestId, "req-1");
});

test("body is ignored; Origin supplies the ID", async () => {
  pair.resetPairingControllerForTests({ randomId: () => "req-2" });
  const sent = [];
  const result = await pair.handlePairPost(VALID_ORIGIN, {
    send: (msg) => sent.push(msg),
    waitForResult: async () => true,
  });
  assert.equal(result.status, 200);
  assert.equal(sent[0].extensionId, VALID_ID);
  assert.notEqual(sent[0].extensionId, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test("Don't allow cools down the same ID for 60s", async () => {
  let now = 1_000;
  pair.resetPairingControllerForTests({
    now: () => now,
    denyTtlMs: 60_000,
    randomId: () => "req-deny",
  });
  const first = await pair.handlePairPost(VALID_ORIGIN, {
    send: () => {},
    waitForResult: async () => false,
  });
  assert.equal(first.status, 403);

  const second = await pair.handlePairPost(VALID_ORIGIN, {
    send: () => {
      throw new Error("should not show another dialog during cooldown");
    },
    waitForResult: async () => true,
  });
  assert.equal(second.status, 403);

  now += 60_001;
  const third = await pair.handlePairPost(VALID_ORIGIN, {
    send: () => {},
    waitForResult: async () => true,
  });
  assert.equal(third.status, 200);
});
