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

test("Origin with trailing slash, path, or port is rejected", async () => {
  pair.resetPairingControllerForTests();
  const sent = [];
  for (const origin of [
    `${VALID_ORIGIN}/`,
    `${VALID_ORIGIN}/popup.html`,
    `${VALID_ORIGIN}:443`,
  ]) {
    sent.length = 0;
    const result = await pair.handlePairPost(origin, {
      send: (msg) => sent.push(msg),
      waitForResult: async () => true,
    });
    assert.equal(result.status, 403, origin);
    assert.equal(sent.length, 0, origin);
    assert.equal(pair.parseExtensionIdFromOrigin(origin), null, origin);
  }
  assert.equal(pair.parseExtensionIdFromOrigin(VALID_ORIGIN), VALID_ID);
  assert.equal(pair.ORIGIN_RE.toString(), "/^chrome-extension:\\/\\/[a-p]{32}$/");
});

test("pair returns 403 with no dialog outside the pairing window", async () => {
  pair.resetPairingControllerForTests({ pairingOpenUntil: 0, now: () => 1 });
  const sent = [];
  const result = await pair.handlePairPost(VALID_ORIGIN, {
    send: (msg) => sent.push(msg),
    waitForResult: async () => true,
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.error, "forbidden");
  assert.equal(sent.length, 0);
});

test("IPC pairing-window message opens the server window", async () => {
  pair.resetPairingControllerForTests({ pairingOpenUntil: 0, now: () => 1 });
  assert.equal(pair.isPairingWindowOpen(1), false);
  pair.applyPairingWindowMessage({
    type: pair.PAIR_WINDOW_TYPE,
    openUntil: 10_000,
  });
  assert.equal(pair.isPairingWindowOpen(1), true);
  assert.equal(pair.isPairingWindowOpen(10_000), false);
});

test("filterValidExtensionIds keeps only 32-char a-p IDs", () => {
  const ids = pair.filterValidExtensionIds([
    VALID_ID,
    "not-an-id",
    "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    123,
    `${VALID_ID}x`,
    null,
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ]);
  assert.deepEqual(ids, [VALID_ID, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test("known store ID omits the unknown-ID line", () => {
  pair.KNOWN_STORE_EXTENSION_IDS.push(VALID_ID);
  try {
    const text = pair.pairingDetailText(VALID_ID);
    assert.equal(
      text,
      `Extension ID: ${VALID_ID}. ${pair.PAIR_DETAIL_ACCESS}`
    );
    assert.equal(text.includes(pair.UNKNOWN_STORE_WARNING), false);
  } finally {
    pair.KNOWN_STORE_EXTENSION_IDS.length = 0;
  }
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
    now: () => 1_000,
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
  bridge.openWindow(1_000 + pair.PAIRING_WINDOW_MS);
  const replies = [];
  await bridge._onMessage(
    { send: (msg) => replies.push(msg) },
    { type: pair.PAIR_TYPE, extensionId: VALID_ID, requestId: "req-focus" }
  );
  assert.deepEqual(app.focusCalls, [{ steal: true }]);
  assert.equal(shown.message, pair.PAIR_MESSAGE);
  assert.equal(shown.message, "An extension wants full access to Transcriber");
  assert.equal(
    shown.detail,
    `Extension ID: ${VALID_ID}. Allowing it lets it read all your transcripts and change your settings.\n${pair.UNKNOWN_STORE_WARNING}`
  );
  assert.equal(replies[0].allowed, false);
});

test("bridge refuses pairing with no dialog outside the window", async () => {
  const PairingBridge = require("../electron/pairing-bridge.js");
  let dialogs = 0;
  const bridge = new PairingBridge({
    now: () => 5_000,
    dialog: {
      showMessageBox: async () => {
        dialogs += 1;
        return { response: 0 };
      },
    },
  });
  const replies = [];
  await bridge._onMessage(
    { send: (msg) => replies.push(msg) },
    { type: pair.PAIR_TYPE, extensionId: VALID_ID, requestId: "req-closed" }
  );
  assert.equal(dialogs, 0);
  assert.equal(replies[0].allowed, false);
  assert.equal(replies[0].reason, "closed");
});

test("Don't allow sets a global deny cooldown across IDs", async () => {
  const PairingBridge = require("../electron/pairing-bridge.js");
  let now = 1_000;
  const dialogs = [];
  const otherId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const bridge = new PairingBridge({
    now: () => now,
    denyTtlMs: 60_000,
    app: { focus() {} },
    dialog: {
      showMessageBox: async () => {
        dialogs.push(now);
        return { response: 1 };
      },
    },
  });
  bridge.openWindow(now + 10 * 60 * 60 * 1000);
  const replies = [];
  const child = { send: (msg) => replies.push(msg) };

  await bridge._onMessage(child, {
    type: pair.PAIR_TYPE,
    extensionId: VALID_ID,
    requestId: "deny-1",
  });
  now = 2_000;
  await bridge._onMessage(child, {
    type: pair.PAIR_TYPE,
    extensionId: otherId,
    requestId: "deny-2",
  });
  assert.equal(dialogs.length, 1);
  assert.equal(replies[1].reason, "cooldown");

  now = 1_000 + 60_001;
  await bridge._onMessage(child, {
    type: pair.PAIR_TYPE,
    extensionId: otherId,
    requestId: "deny-3",
  });
  assert.equal(dialogs.length, 2);
});

test("never stacks a second dialog even after server timeout", async () => {
  const PairingBridge = require("../electron/pairing-bridge.js");
  let resolveFirst;
  let dialogCount = 0;
  const bridge = new PairingBridge({
    now: () => 1_000,
    app: { focus() {} },
    dialog: {
      showMessageBox() {
        dialogCount += 1;
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      },
    },
  });
  bridge.openWindow(1_000 + pair.PAIRING_WINDOW_MS);
  const replies = [];
  const child = { send: (msg) => replies.push(msg) };

  const first = bridge._onMessage(child, {
    type: pair.PAIR_TYPE,
    extensionId: VALID_ID,
    requestId: "req-a",
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(dialogCount, 1);
  assert.equal(bridge.dialogOpen, true);

  await bridge._onMessage(child, {
    type: pair.PAIR_EXPIRED_TYPE,
    requestId: "req-a",
  });
  await bridge._onMessage(child, {
    type: pair.PAIR_TYPE,
    extensionId: VALID_ID,
    requestId: "req-b",
  });
  assert.equal(dialogCount, 1);
  assert.equal(replies[0].reason, "busy");

  resolveFirst({ response: 1 });
  await first;
});

test("caps pairing dialogs at 3 per hour", async () => {
  const PairingBridge = require("../electron/pairing-bridge.js");
  let now = 0;
  const shown = [];
  const bridge = new PairingBridge({
    now: () => now,
    app: { focus() {} },
    dialog: {
      showMessageBox: async () => {
        shown.push(now);
        return { response: 0 };
      },
    },
  });
  bridge.openWindow(10 * 60 * 60 * 1000);
  const replies = [];
  const child = { send: (msg) => replies.push(msg) };

  for (let i = 0; i < 3; i++) {
    now = i * 1_000;
    await bridge._onMessage(child, {
      type: pair.PAIR_TYPE,
      extensionId: VALID_ID,
      requestId: `req-${i}`,
    });
  }
  assert.equal(shown.length, 3);

  now = 4_000;
  await bridge._onMessage(child, {
    type: pair.PAIR_TYPE,
    extensionId: VALID_ID,
    requestId: "req-4",
  });
  assert.equal(shown.length, 3);
  assert.equal(replies.at(-1).reason, "rate_limit");

  now = 60 * 60 * 1000 + 1;
  await bridge._onMessage(child, {
    type: pair.PAIR_TYPE,
    extensionId: VALID_ID,
    requestId: "req-5",
  });
  assert.equal(shown.length, 4);
});

test("attach resends an open pairing window to the server child", () => {
  const PairingBridge = require("../electron/pairing-bridge.js");
  const sent = [];
  const bridge = new PairingBridge({ now: () => 1_000 });
  bridge.openWindow(1_000 + pair.PAIRING_WINDOW_MS);
  const child = {
    on() {},
    send(msg) {
      sent.push(msg);
    },
  };
  bridge.attach(child);
  assert.equal(sent[0].type, pair.PAIR_WINDOW_TYPE);
  assert.equal(sent[0].openUntil, 1_000 + pair.PAIRING_WINDOW_MS);
});

test("late Allow after expire does not write the extension ID", async () => {
  const PairingBridge = require("../electron/pairing-bridge.js");
  const wrote = [];
  const replies = [];
  const bridge = new PairingBridge({
    now: () => 1_000,
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
  bridge.openWindow(1_000 + pair.PAIRING_WINDOW_MS);
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
