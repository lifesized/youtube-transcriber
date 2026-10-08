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

const WSS = "wss://wss-primary.slack.com/link";

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
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.handlers.close) fn();
  }
  emit(name, data) {
    for (const fn of this.handlers[name]) fn(data);
  }
}

async function tick(times = 5) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

async function waitUntil(predicate, label = "condition") {
  for (let i = 0; i < 30; i += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`timed out waiting for ${label}`);
}

function createTimerQueue() {
  const q = [];
  return {
    q,
    api: {
      setTimeout: (fn, ms) => {
        const id = { fn, ms, cleared: false, ran: false };
        q.push(id);
        return id;
      },
      clearTimeout: (id) => {
        if (id) id.cleared = true;
      },
    },
    pending() {
      return q.filter((t) => !t.cleared && !t.ran);
    },
    async flush() {
      const due = this.pending();
      for (const t of due) {
        t.ran = true;
        t.fn();
      }
      await Promise.resolve();
      await Promise.resolve();
    },
  };
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
    openSocketConnection: async () => ({ ok: true, url: WSS }),
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
    channelAllowlist: ["C01234567"],
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
  assert.equal(sockets[0].url, WSS);
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

test("in-thread @Tusk with no URL is a thread question, not a new job", async () => {
  const questions = [];
  const links = [];
  const sockets = [];
  const runtime = createTuskRuntime({
    botToken: BOT,
    appToken: APP,
    teamId: "THOME",
    botUserId: "Ubot",
    channelAllowlist: ["C01234567"],
    slackApi: mockApi(),
    WebSocket: class extends FakeSocket {
      constructor(url) {
        super(url);
        sockets.push(this);
      }
    },
    onSupportedLink: async (evt) => links.push(evt),
    onThreadQuestion: async (evt) => questions.push(evt),
  });
  await runtime.start();
  sockets[0].emit("message", {
    data: JSON.stringify({
      type: "events_api",
      envelope_id: "q1",
      payload: {
        team_id: "THOME",
        event_id: "EvQ",
        event: {
          type: "app_mention",
          user: "Ujames",
          channel: "C01234567",
          channel_type: "channel",
          ts: "1710000000.000300",
          thread_ts: "1710000000.000100",
          text: "<@Ubot> what was the decision?",
          client_msg_id: "q1",
        },
      },
    }),
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(links.length, 0);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].threadTs, "1710000000.000100");
  assert.match(questions[0].text, /decision/);
  await runtime.stop();
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
        return { ok: true, url: WSS };
      },
    }),
    WebSocket: class extends FakeSocket {
      constructor(url) {
        super(url);
        sockets.push(this);
      }
    },
    random: () => 0,
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
      confirmSensitiveChange: async () => true,
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

test("token change to another workspace is refused until Reset workspace", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tusk-pin-"));
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
    let team = { team: "Personal", team_id: "THOME" };
    const otherBot = "xoxb-123456789012-1234567890123-ZyXwVuTsRqPoNmLkJiHgFeDc";
    const manager = createTuskManager({
      store,
      slackApi: mockApi({
        authTest: async () => ({ ok: true, user: "tusk", user_id: "Ubot", ...team }),
      }),
      WebSocket: FakeSocket,
      confirmSensitiveChange: async () => true,
    });
    await manager.applyPatch({ botToken: BOT, appToken: APP, enabled: true });
    assert.equal(store.getSlackPublic().teamId, "THOME");
    team = { team: "Other", team_id: "TOTHER" };
    await assert.rejects(
      () => manager.applyPatch({ botToken: otherBot, appToken: APP }),
      /Reset workspace/
    );
    assert.equal(store.getSlackPublic().teamId, "THOME");
    const reset = await manager.applyPatch({
      botToken: otherBot,
      appToken: APP,
      resetWorkspace: true,
    });
    assert.equal(reset.teamId, "TOTHER");
    assert.equal(reset.teamName, "Other");
    await manager.stop();
  } finally {
    if (prev === undefined) delete process.env.TRANSCRIBER_STATE_DIR;
    else process.env.TRANSCRIBER_STATE_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isSlackSocketUrl requires wss and a .slack.com host", () => {
  const { isSlackSocketUrl } = require(path.join(root, "electron/tusk/runtime.js"));
  assert.equal(isSlackSocketUrl("wss://wss-primary.slack.com/link"), true);
  assert.equal(isSlackSocketUrl("wss://wss-secondary.slack.com/"), true);
  assert.equal(isSlackSocketUrl("https://wss-primary.slack.com/link"), false);
  assert.equal(isSlackSocketUrl("wss://wss-primary.slack.test/link"), false);
  assert.equal(isSlackSocketUrl("wss://evil.example.com/slack.com"), false);
  assert.equal(isSlackSocketUrl("not-a-url"), false);
});

test("one live socket across disconnect envelopes and close events", async () => {
  let live = 0;
  const constructed = [];
  const pendingOpens = [];
  const timers = createTimerQueue();

  class CountingSocket extends FakeSocket {
    constructor(url) {
      super(url);
      constructed.push(this);
      live += 1;
    }
    close() {
      if (this.closed) return;
      live -= 1;
      super.close();
    }
  }

  const runtime = createTuskRuntime({
    botToken: BOT,
    appToken: APP,
    teamId: "THOME",
    slackApi: mockApi({
      openSocketConnection: () =>
        new Promise((resolve) => {
          pendingOpens.push(resolve);
        }),
    }),
    WebSocket: CountingSocket,
    timers: timers.api,
    random: () => 0,
  });

  const started = runtime.start();
  await waitUntil(() => pendingOpens.length === 1, "first connections.open");
  pendingOpens.shift()({ ok: true, url: WSS });
  await started;
  assert.equal(live, 1);
  assert.equal(constructed.length, 1);

  constructed[0].emit("message", { data: JSON.stringify({ type: "disconnect" }) });
  constructed[0].emit("message", { data: JSON.stringify({ type: "disconnect" }) });
  assert.equal(live, 0);
  assert.equal(timers.pending().length, 1, "duplicate disconnects share one reconnect timer");

  await timers.flush();
  await waitUntil(() => pendingOpens.length === 1, "reconnect after disconnect");
  pendingOpens.shift()({ ok: true, url: WSS });
  await tick();
  assert.equal(live, 1);

  constructed[constructed.length - 1].close();
  constructed[constructed.length - 1].close();
  assert.equal(live, 0);
  assert.equal(timers.pending().length, 1, "duplicate close events share one reconnect timer");
  await timers.flush();
  await waitUntil(() => pendingOpens.length === 1, "reconnect after close");
  pendingOpens.shift()({ ok: true, url: WSS });
  await tick();
  assert.equal(live, 1);
  assert.equal(constructed.filter((s) => !s.closed).length, 1);

  await runtime.stop();
  assert.equal(live, 0);
  assert.equal(timers.pending().length, 0);
});

test("stop or token change mid-connect never opens a socket with the old token", async () => {
  const constructed = [];
  const pendingOpens = [];
  const timers = createTimerQueue();

  const runtime = createTuskRuntime({
    botToken: BOT,
    appToken: "old-app-token",
    teamId: "THOME",
    slackApi: mockApi({
      openSocketConnection: (token) =>
        new Promise((resolve) => {
          pendingOpens.push({ token, resolve });
        }),
    }),
    WebSocket: class extends FakeSocket {
      constructor(url) {
        super(url);
        constructed.push(this);
      }
    },
    timers: timers.api,
    random: () => 0,
  });

  const first = runtime.start();
  await waitUntil(() => pendingOpens.length === 1, "open with old token");
  assert.equal(pendingOpens[0].token, "old-app-token");
  await runtime.stop();
  pendingOpens.shift().resolve({ ok: true, url: "wss://wss-primary.slack.com/old" });
  await first;
  assert.equal(constructed.length, 0, "stop mid-connect must not open the stale socket");

  const thirdConstructed = [];
  const thirdOpens = [];
  const options = {
    botToken: BOT,
    appToken: "token-a",
    teamId: "THOME",
    slackApi: mockApi({
      openSocketConnection: (token) =>
        new Promise((resolve) => {
          thirdOpens.push({ token, resolve });
        }),
    }),
    WebSocket: class extends FakeSocket {
      constructor(url) {
        super(url);
        thirdConstructed.push(url);
      }
    },
    timers: timers.api,
    random: () => 0,
  };
  const third = createTuskRuntime(options);
  const thirdStart = third.start();
  await waitUntil(() => thirdOpens.length === 1, "open with token-a");
  assert.equal(thirdOpens[0].token, "token-a");
  options.appToken = "token-b";
  thirdOpens[0].resolve({ ok: true, url: "wss://wss-primary.slack.com/token-a" });
  await thirdStart;
  assert.deepEqual(thirdConstructed, [], "token change mid-connect must not open the old socket");
  await third.stop();
});

test("invalid_auth stops permanently and leaves the tray in error", async () => {
  const delays = [];
  const runtime = createTuskRuntime({
    botToken: BOT,
    appToken: APP,
    slackApi: mockApi({
      openSocketConnection: async () => ({ ok: false, error: "invalid_auth" }),
    }),
    WebSocket: FakeSocket,
    random: () => 0,
    timers: {
      setTimeout: (fn, ms) => {
        delays.push(ms);
        fn();
        return delays.length;
      },
      clearTimeout: () => {},
    },
  });
  await runtime.start();
  assert.equal(runtime.isStopped(), true);
  assert.equal(runtime.isFatal(), true);
  assert.equal(runtime.getStatus().state, "error");
  assert.equal(runtime.getStatus().fatal, true);
  const after = delays.length;
  await new Promise((r) => setImmediate(r));
  assert.equal(delays.length, after, "fatal auth must not reconnect");
});

test("reconnect honours Retry-After instead of the backoff table", async () => {
  const delays = [];
  let opens = 0;
  const runtime = createTuskRuntime({
    botToken: BOT,
    appToken: APP,
    slackApi: mockApi({
      openSocketConnection: async () => {
        opens += 1;
        if (opens === 1) return { ok: false, error: "over_capacity", retryAfterMs: 7777 };
        return { ok: true, url: WSS };
      },
    }),
    WebSocket: FakeSocket,
    random: () => 0.9,
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
  assert.equal(delays[0], 7777);
  await runtime.stop();
});
