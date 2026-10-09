import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createTuskManager } = require(path.join(root, "electron/tusk/manager.js"));
const {
  cleanDialogField,
  tuskConfirmDialogOptions,
  confirmTuskSensitiveChange,
} = require(path.join(root, "electron/tusk/confirm.js"));
const { SecretsStore } = require(path.join(root, "electron/secrets-store.js"));
const ipc = require(path.join(root, "lib/electron-ipc.js"));

const BOT = "xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUv";
const APP = "xapp-1-A01234567890-1234567890123-abcdef0123456789abcdef0123456789";
const OTHER_BOT = "xoxb-123456789012-1234567890123-ZyXwVuTsRqPoNmLkJiHgFeDc";

function storeInDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "tusk-confirm-"));
  const prev = process.env.TRANSCRIBER_STATE_DIR;
  process.env.TRANSCRIBER_STATE_DIR = dir;
  const store = new SecretsStore({
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (p) => Buffer.from(`enc:${p}`),
      decryptString: (b) => Buffer.from(b).toString().slice(4),
    },
  });
  return {
    store,
    async cleanup() {
      if (prev === undefined) delete process.env.TRANSCRIBER_STATE_DIR;
      else process.env.TRANSCRIBER_STATE_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function mockApi(team = { team: "Personal", team_id: "THOME", url: "https://lifesized.slack.com/" }) {
  return {
    authTest: async () => ({ ok: true, user: "tusk", user_id: "Ubot", ...team }),
    openSocketConnection: async () => ({ ok: true, url: "wss://wss-primary.slack.com/link" }),
    addReaction: async () => ({ ok: true }),
  };
}

class FakeSocket {
  addEventListener() {}
  send() {}
  close() {}
}

test("confirm dialog strips control characters and labels old vs new team IDs", () => {
  const dirty = tuskConfirmDialogOptions({
    workspace: "Acme\n<script>\u0007",
    teamId: "TNEW",
    authUrl: "https://acme.slack.com/\nX-Injected: 1",
    currentPin: "TOLD\nPIN",
    newPin: "TNEW",
    tokensChanged: true,
  });
  assert.doesNotMatch(dirty.message, /[\n\r\u0007]/);
  assert.doesNotMatch(dirty.detail, /TOLD\nPIN/);
  assert.doesNotMatch(dirty.detail, /slack\.com\/\n/);
  assert.doesNotMatch(dirty.detail, /\u0007/);
  assert.match(dirty.detail, /Old team ID: TOLD PIN/);
  assert.match(dirty.detail, /New team ID: TNEW/);
  assert.match(dirty.detail, /auth\.test URL: https:\/\/acme\.slack\.com\/ X-Injected: 1/);
  assert.equal(cleanDialogField("a".repeat(90)).length, 80);

  const rlo = tuskConfirmDialogOptions({
    workspace: "acme\u202Eemca",
    tokensChanged: true,
  });
  assert.equal(cleanDialogField("acme\u202Eemca"), "acmeemca");
  assert.doesNotMatch(rlo.message, /\u202E/);
  assert.match(rlo.message, /acmeemca/);
});

test("confirm dialog defaults to Cancel and names the workspace when known", () => {
  const named = tuskConfirmDialogOptions({
    workspace: "Personal",
    teamId: "THOME",
    authUrl: "https://lifesized.slack.com/",
    currentPin: "THOME",
    newPin: "THOME",
    tokensChanged: true,
  });
  assert.equal(named.defaultId, 0);
  assert.equal(named.cancelId, 0);
  assert.deepEqual(named.buttons, ["Cancel", "Change"]);
  assert.match(named.message, /Personal/);
  assert.match(named.message, /Slack tokens/);
  assert.match(named.detail, /Old team ID: THOME/);
  assert.match(named.detail, /New team ID: THOME/);
  assert.match(named.detail, /auth\.test URL: https:\/\/lifesized\.slack\.com\//);
  assert.doesNotMatch(named.detail, /Team ID: THOME/);
  assert.doesNotMatch(named.detail, /Workspace pin:/);

  const reset = tuskConfirmDialogOptions({
    workspace: "Personal",
    resetWorkspace: true,
    teamId: "THOME",
    currentPin: "THOME",
    newPin: "TOTHER",
  });
  assert.equal(reset.defaultId, 0);
  assert.match(reset.message, /Reset/);
  assert.match(reset.message, /Personal/);
  assert.match(reset.detail, /Old team ID: THOME/);
  assert.match(reset.detail, /New team ID: TOTHER/);

  const unknown = tuskConfirmDialogOptions({});
  assert.equal(unknown.defaultId, 0);
  assert.match(unknown.message, /Slack tokens/);
  assert.equal(unknown.message.includes("undefined"), false);
});

test("mocked dialog: Change applies the token write, Cancel leaves store unchanged", async () => {
  const { store, cleanup } = storeInDir();
  try {
    const calls = [];
    const dialog = {
      showMessageBox: async (opts) => {
        calls.push(opts);
        return { response: 1 };
      },
    };
    const manager = createTuskManager({
      store,
      slackApi: mockApi(),
      WebSocket: FakeSocket,
      confirmSensitiveChange: (info) => confirmTuskSensitiveChange(dialog, info),
    });
    const saved = await manager.applyPatch({ botToken: BOT, appToken: APP, enabled: true });
    assert.equal(saved.hasBotToken, true);
    assert.equal(store.getSlackPublic().teamId, "THOME");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].defaultId, 0);
    assert.match(calls[0].message, /Personal/);
    assert.match(calls[0].detail, /Old team ID: \(none\)/);
    assert.match(calls[0].detail, /New team ID: THOME/);
    assert.match(calls[0].detail, /auth\.test URL: https:\/\/lifesized\.slack\.com\//);

    dialog.showMessageBox = async (opts) => {
      calls.push(opts);
      return { response: 0 };
    };
    await assert.rejects(
      () => manager.applyPatch({ botToken: OTHER_BOT, appToken: APP, resetWorkspace: true }),
      (err) => {
        assert.equal(err.status, 409);
        assert.match(err.message, /cancelled/i);
        return true;
      }
    );
    assert.equal(store.getSlackPublic().teamId, "THOME");
    assert.equal(store.getSlackPlain().botToken, BOT);
    assert.equal(calls.length, 2);
    assert.match(calls[1].message, /Reset/);
    await manager.stop();
  } finally {
    await cleanup();
  }
});

test("adding allowlist channels or enabling Tusk requires confirmation", async () => {
  const { store, cleanup } = storeInDir();
  try {
    const reasons = [];
    const manager = createTuskManager({
      store,
      slackApi: mockApi(),
      WebSocket: FakeSocket,
      confirmSensitiveChange: async (info) => {
        reasons.push(info);
        return true;
      },
    });
    await manager.applyPatch({ botToken: BOT, appToken: APP, enabled: false });
    assert.equal(reasons.length, 1);
    assert.equal(reasons[0].tokensChanged, true);

    await manager.applyPatch({ channelAllowlist: ["C01234567"] });
    assert.equal(reasons.length, 2);
    assert.equal(reasons[1].allowlistAdded, true);
    assert.deepEqual(store.getSlackPublic().channelAllowlist, ["C01234567"]);

    await manager.applyPatch({ enabled: true });
    assert.equal(reasons.length, 3);
    assert.equal(reasons[2].enabledOn, true);
    assert.equal(store.getSlackPublic().enabled, true);

    await manager.applyPatch({ channelAllowlist: ["C01234567"] });
    assert.equal(reasons.length, 3, "re-saving the same allowlist is not an add");
    await manager.stop();
  } finally {
    await cleanup();
  }
});

test("a busy 409 does not release the dialog lock for a third request", async () => {
  const { store, cleanup } = storeInDir();
  try {
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    let dialogs = 0;
    const manager = createTuskManager({
      store,
      slackApi: mockApi(),
      WebSocket: FakeSocket,
      confirmSensitiveChange: async () => {
        dialogs += 1;
        await held;
        return true;
      },
    });
    const first = manager.applyPatch({ botToken: BOT, appToken: APP, enabled: true });
    await assert.rejects(
      () => manager.applyPatch({ channelAllowlist: ["C01234567"] }),
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "TUSK_SETTINGS_BUSY");
        return true;
      }
    );
    await assert.rejects(
      () => manager.applyPatch({ channelAllowlist: ["C07654321"] }),
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "TUSK_SETTINGS_BUSY");
        return true;
      }
    );
    assert.equal(dialogs, 1, "only the first request opens a dialog");
    release(true);
    await first;
    assert.equal(dialogs, 1);
    assert.equal(store.getSlackPublic().teamId, "THOME");
    await manager.stop();
  } finally {
    await cleanup();
  }
});

test("a second sensitive change gets 409 while a confirm dialog is open", async () => {
  const { store, cleanup } = storeInDir();
  try {
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const manager = createTuskManager({
      store,
      slackApi: mockApi(),
      WebSocket: FakeSocket,
      confirmSensitiveChange: async () => {
        await held;
        return true;
      },
    });
    const first = manager.applyPatch({ botToken: BOT, appToken: APP, enabled: true });
    await assert.rejects(
      () => manager.applyPatch({ channelAllowlist: ["C01234567"] }),
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "TUSK_SETTINGS_BUSY");
        return true;
      }
    );
    release(true);
    await first;
    assert.equal(store.getSlackPublic().teamId, "THOME");
    await manager.stop();
  } finally {
    await cleanup();
  }
});

test("a busy 409 still drops the pending request id", async () => {
  const { store, cleanup } = storeInDir();
  try {
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const manager = createTuskManager({
      store,
      slackApi: mockApi(),
      WebSocket: FakeSocket,
      confirmSensitiveChange: async () => {
        await held;
        return true;
      },
    });
    const child = new EventEmitter();
    const sent = [];
    child.send = (msg) => sent.push(msg);
    manager.attachIpc(child);
    child.emit("message", {
      type: "tusk-set",
      requestId: "req-first",
      payload: { botToken: BOT, appToken: APP, enabled: true },
    });
    await new Promise((resolve) => setImmediate(resolve));
    child.emit("message", {
      type: "tusk-set",
      requestId: "req-busy",
      payload: { channelAllowlist: ["C01234567"] },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const busy = sent.find((msg) => msg.requestId === "req-busy");
    assert.equal(busy.status, 409);
    child.emit("message", { type: "tusk-set-cancel", requestId: "req-busy" });
    release(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(store.getSlackPublic().teamId, "THOME");
    child.emit("message", {
      type: "tusk-set",
      requestId: "req-busy",
      payload: { channelAllowlist: ["C01234567"] },
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const reused = sent.filter((msg) => msg.requestId === "req-busy" && !msg.error).pop();
    assert.ok(reused, "reused request id must apply after the 409, not stay cancelled");
    assert.deepEqual(store.getSlackPublic().channelAllowlist, ["C01234567"]);
    await manager.stop();
  } finally {
    await cleanup();
  }
});

test("after confirm, the patch is applied to a freshly read store", async () => {
  const { store, cleanup } = storeInDir();
  try {
    const manager = createTuskManager({
      store,
      slackApi: mockApi(),
      WebSocket: FakeSocket,
      confirmSensitiveChange: async () => {
        store.setSlack({ channelAllowlist: ["C99999999"] });
        return true;
      },
    });
    await manager.applyPatch({ botToken: BOT, appToken: APP, enabled: true });
    assert.equal(store.getSlackPublic().teamId, "THOME");
    assert.deepEqual(
      store.getSlackPublic().channelAllowlist,
      ["C99999999"],
      "unrelated store writes during the dialog are kept"
    );
    await manager.stop();
  } finally {
    await cleanup();
  }
});

test("confirm focuses the app and uses a parent window when one exists", async () => {
  const calls = [];
  const parent = { isDestroyed: () => false };
  const dialog = {
    showMessageBox: async (...args) => {
      calls.push(args);
      return { response: 1 };
    },
  };
  const app = {
    focus: (opts) => {
      calls.push(["focus", opts]);
    },
  };
  const ok = await confirmTuskSensitiveChange(
    { dialog, app, getParentWindow: () => parent },
    { workspace: "Personal", tokensChanged: true, teamId: "THOME" }
  );
  assert.equal(ok, true);
  assert.deepEqual(calls[0], ["focus", { steal: true }]);
  assert.equal(calls[1][0], parent);
  assert.match(calls[1][1].message, /Personal/);
});

test("a timed-out tusk-set never applies after the user later confirms", async () => {
  const { store, cleanup } = storeInDir();
  try {
    let releaseConfirm;
    const held = new Promise((resolve) => {
      releaseConfirm = resolve;
    });
    const manager = createTuskManager({
      store,
      slackApi: mockApi(),
      WebSocket: FakeSocket,
      confirmSensitiveChange: async () => {
        await held;
        return true;
      },
    });
    const child = new EventEmitter();
    child.send = () => {};
    manager.attachIpc(child);
    child.emit("message", {
      type: "tusk-set",
      requestId: "req-late",
      payload: { botToken: BOT, appToken: APP, enabled: true },
    });
    await new Promise((resolve) => setImmediate(resolve));
    child.emit("message", { type: "tusk-set-cancel", requestId: "req-late" });
    releaseConfirm(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(store.getSlackPlain().botToken, "");
    assert.equal(store.getSlackPublic().hasBotToken, false);
    await manager.stop();
  } finally {
    await cleanup();
  }
});

test("a cancel for an unknown request id does not block a later tusk-set", async () => {
  const { store, cleanup } = storeInDir();
  try {
    const manager = createTuskManager({
      store,
      slackApi: mockApi(),
      WebSocket: FakeSocket,
      confirmSensitiveChange: async () => true,
    });
    const child = new EventEmitter();
    const sent = [];
    child.send = (msg) => sent.push(msg);
    manager.attachIpc(child);
    child.emit("message", { type: "tusk-set-cancel", requestId: "req-reuse" });
    child.emit("message", {
      type: "tusk-set",
      requestId: "req-reuse",
      payload: { botToken: BOT, appToken: APP, enabled: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(store.getSlackPublic().hasBotToken, true);
    assert.equal(store.getSlackPublic().teamId, "THOME");
    await manager.stop();
  } finally {
    await cleanup();
  }
});

test("tusk-set IPC timeout is longer than the confirm dialog and sends a cancel", async () => {
  assert.ok(ipc.TUSK_SET_TIMEOUT_MS > 60_000);
  assert.ok(ipc.TUSK_SET_TIMEOUT_MS > ipc.DEFAULT_IPC_TIMEOUT_MS);

  const sent = [];
  const previousSend = process.send;
  const previousOn = process.on;
  const previousOff = process.off;
  let listener;
  process.send = (msg) => {
    sent.push(msg);
  };
  process.on = (event, fn) => {
    if (event === "message") listener = fn;
    return process;
  };
  process.off = () => process;
  try {
    const pending = ipc.requestFromMain("tusk-set", { enabled: true }, 15);
    await assert.rejects(pending, /electron_ipc_timeout/);
    assert.equal(sent[0].type, "tusk-set");
    assert.equal(sent[1].type, "tusk-set-cancel");
    assert.equal(sent[1].requestId, sent[0].requestId);
    assert.equal(typeof listener, "function");
  } finally {
    process.send = previousSend;
    process.on = previousOn;
    process.off = previousOff;
  }
});
