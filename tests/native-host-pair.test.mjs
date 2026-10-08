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

test("unknown ID detail warns it is not the CWS extension", () => {
  assert.equal(pair.KNOWN_STORE_EXTENSION_IDS.length, 0);
  assert.equal(pair.isKnownStoreExtensionId(VALID_ID), false);
  const text = pair.pairingDetailText(VALID_ID);
  assert.ok(text.includes(`Extension ID: ${VALID_ID}`));
  assert.ok(text.includes(pair.UNKNOWN_STORE_WARNING));
});

test("waitForResult timeout marks request expired and notifies main", async () => {
  pair.resetPairingControllerForTests();
  const sent = [];
  const wait = pair.createWaitForResult({
    timeoutMs: 20,
    sendExpired: (msg) => sent.push(msg),
  });
  await assert.rejects(() => wait("req-timeout"), /dialog timeout/);
  assert.equal(pair.isRequestExpired("req-timeout"), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, pair.PAIR_EXPIRED_TYPE);
  assert.equal(sent[0].requestId, "req-timeout");
});

test("dialog timeout returns 504", async () => {
  pair.resetPairingControllerForTests({ randomId: () => "req-504" });
  const result = await pair.handlePairPost(VALID_ORIGIN, {
    send: () => {},
    waitForResult: async () => {
      throw new Error("dialog timeout");
    },
  });
  assert.equal(result.status, 504);
  assert.equal(result.body.error, "dialog_timeout");
});

test("pairing dialog focuses the app and includes the extension ID", async () => {
  const PairingBridge = require("../electron/pairing-bridge.js");
  const app = {
    focusCalls: [],
    focus(opts) {
      this.focusCalls.push(opts);
    },
  };
  let shown;
  const bridge = new PairingBridge({
    app,
    dialog: {
      showMessageBox: async (opts) => {
        shown = opts;
        return { response: 1 };
      },
    },
    installer: {
      appendExtensionId() {
        throw new Error("should not write on deny");
      },
    },
  });
  const replies = [];
  await bridge._onMessage(
    { send: (msg) => replies.push(msg) },
    { type: pair.PAIR_TYPE, extensionId: VALID_ID, requestId: "req-focus" }
  );
  assert.deepEqual(app.focusCalls, [{ steal: true }]);
  assert.equal(shown.detail, pair.pairingDetailText(VALID_ID));
  assert.ok(shown.detail.includes(pair.UNKNOWN_STORE_WARNING));
  assert.equal(replies[0].allowed, false);
});

test("late Allow after expire does not write the extension ID", async () => {
  const PairingBridge = require("../electron/pairing-bridge.js");
  const wrote = [];
  const replies = [];
  const bridge = new PairingBridge({
    app: { focus() {} },
    dialog: {
      showMessageBox: async () => ({ response: 0 }),
    },
    installer: {
      appendExtensionId(id) {
        wrote.push(id);
      },
      async install() {
        wrote.push("install");
      },
    },
  });
  await bridge._onMessage(
    { send: (msg) => replies.push(msg) },
    { type: pair.PAIR_EXPIRED_TYPE, requestId: "req-late" }
  );
  await bridge._onMessage(
    { send: (msg) => replies.push(msg) },
    { type: pair.PAIR_TYPE, extensionId: VALID_ID, requestId: "req-late" }
  );
  assert.deepEqual(wrote, []);
  assert.deepEqual(replies, []);
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
