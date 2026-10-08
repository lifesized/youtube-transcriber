import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createTuskRuntime, BACKOFF_MS } = require(path.join(root, "electron/tusk/runtime.js"));
const { createTuskManager } = require(path.join(root, "electron/tusk/manager.js"));
const { SecretsStore } = require(path.join(root, "electron/secrets-store.js"));

const BOT = "xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUv";
const APP = "xapp-1-A01234567890-1234567890123-abcdef0123456789abcdef0123456789";

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.handlers = { message: [], close: [], error: [] };
    this.closed = false;
  }
  addEventListener(name, fn) {
    this.handlers[name].push(fn);
  }
  send(data) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    for (const fn of this.handlers.close) fn();
  }
  emit(name, data) {
    for (const fn of this.handlers[name]) fn(data);
  }
}

function mockApi(overrides = {}) {
  return {
    authTest: async () => ({
      ok: true,
      team: "Personal",
      team_id: "THOME",
      user: "tusk",
      user_id: "Ubot",
    }),
    openSocketConnection: async () => ({ ok: true, url: "wss://wss-primary.slack.test/link" }),
    addReaction: async (args) => {
      mockApi.reactions.push(args);
      return { ok: true };
    },
    ...overrides,
  };
}
mockApi.reactions = [];

test("lifecycle connects, acks, reacts to a supported link, and disconnects", async () => {
  mockApi.reactions = [];
  const sockets = [];
  const statuses = [];
  const api = mockApi();
  const runtime = createTuskRuntime({
    botToken: BOT,
    appToken: APP,
    teamId: "THOME",
    botUserId: "Ubot",
    slackApi: api,
    WebSocket: class extends FakeSocket {
      constructor(url) {
        super(url);
        sockets.push(this);
      }
    },
    onStatus: (s) => statuses.push(s.state),
    onSupportedLink: async (evt) => {
      await api.addReaction({
        botToken: BOT,
        channel: evt.channel,
        timestamp: evt.ts,
        name: "eyes",
      });
    },
  });

  await runtime.start();
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, "wss://wss-primary.slack.test/link");
  sockets[0].emit("message", { data: JSON.stringify({ type: "hello" }) });
  assert.ok(statuses.includes("connected"));

  sockets[0].emit("message", {
    data: JSON.stringify({
      type: "events_api",
      envelope_id: "e1",
      payload: {
        team_id: "THOME",
        event_id: "Ev1",
        event: {
          type: "message",
          user: "Ujames",
          channel: "C01234567",
          ts: "1710000000.000100",
          text: "watch https://youtu.be/dQw4w9WgXcQ",
          client_msg_id: "c1",
        },
      },
    }),
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(JSON.parse(sockets[0].sent[0]).envelope_id, "e1");
  assert.equal(mockApi.reactions.length, 1);
  assert.equal(mockApi.reactions[0].name, "eyes");
  assert.equal(JSON.stringify(mockApi.reactions[0]).includes(BOT), true);

  sockets[0].emit("message", {
    data: JSON.stringify({
      type: "slash_commands",
      envelope_id: "e2",
      payload: { team_id: "THOME", channel_id: "C01234567", text: "status", user_id: "Ujames" },
    }),
  });
  await new Promise((r) => setImmediate(r));
  const ack2 = JSON.parse(sockets[0].sent[1]);
  assert.match(ack2.payload.text, /Personal|connected|off/);

  await runtime.stop();
  assert.equal(runtime.isStopped(), true);
  assert.equal(sockets[0].closed, true);
  assert.equal(runtime.getStatus().state, "off");
});

test("reconnect uses backoff and disable stops retries", async () => {
  const delays = [];
  let opens = 0;
  const sockets = [];
  const runtime = createTuskRuntime({
    botToken: BOT,
    appToken: APP,
    slackApi: mockApi({
      openSocketConnection: async () => {
        opens += 1;
        if (opens === 1) return { ok: false, error: "over_capacity" };
        return { ok: true, url: "wss://wss-primary.slack.test/link" };
      },
    }),
    WebSocket: class extends FakeSocket {
      constructor(url) {
        super(url);
        sockets.push(this);
      }
    },
    timers: {
      setTimeout: (fn, ms) => {
        delays.push(ms);
        fn();
        return delays.length;
      },
      clearTimeout: () => {},
    },
  });
  await assert.rejects(() => runtime.start());
  assert.equal(delays[0], BACKOFF_MS[0]);
  await runtime.stop();
  const after = delays.length;
  // stop must not schedule another attempt
  assert.equal(runtime.isStopped(), true);
  assert.equal(delays.length, after);
});

test("manager saves public view only and starts when enabled", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tusk-mgr-"));
  const prev = process.env.TRANSCRIBER_STATE_DIR;
  process.env.TRANSCRIBER_STATE_DIR = dir;
  try {
    const store = new SecretsStore({
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (p) => Buffer.from(`enc:${p}`),
        decryptString: (b) => Buffer.from(b).toString().slice(4),
      },
    });
    const statuses = [];
    const manager = createTuskManager({
      store,
      slackApi: mockApi(),
      WebSocket: FakeSocket,
      onStatus: (s) => statuses.push(s.state),
    });
    const publicView = await manager.applyPatch({
      botToken: BOT,
      appToken: APP,
      enabled: true,
    });
    assert.equal(JSON.stringify(publicView).includes(BOT), false);
    assert.equal(publicView.hasBotToken, true);
    assert.equal(publicView.teamName, "Personal");
    assert.match(publicView.botTokenMasked, /saved ••••/);
    await manager.stop();
    assert.equal(manager.getStatus().state, "off");
  } finally {
    if (prev === undefined) delete process.env.TRANSCRIBER_STATE_DIR;
    else process.env.TRANSCRIBER_STATE_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
