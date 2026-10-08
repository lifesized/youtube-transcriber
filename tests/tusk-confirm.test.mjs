import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createTuskManager } = require(path.join(root, "electron/tusk/manager.js"));
const {
  tuskConfirmDialogOptions,
  confirmTuskSensitiveChange,
} = require(path.join(root, "electron/tusk/confirm.js"));
const { SecretsStore } = require(path.join(root, "electron/secrets-store.js"));

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

function mockApi(team = { team: "Personal", team_id: "THOME" }) {
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

test("confirm dialog defaults to Cancel and names the workspace when known", () => {
  const named = tuskConfirmDialogOptions({ workspace: "Personal" });
  assert.equal(named.defaultId, 0);
  assert.equal(named.cancelId, 0);
  assert.deepEqual(named.buttons, ["Cancel", "Change"]);
  assert.match(named.message, /Personal/);
  assert.match(named.message, /Slack tokens/);

  const reset = tuskConfirmDialogOptions({ workspace: "Personal", resetWorkspace: true });
  assert.equal(reset.defaultId, 0);
  assert.match(reset.message, /Reset/);
  assert.match(reset.message, /Personal/);

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

test("allowlist-only writes skip the confirmation dialog", async () => {
  const { store, cleanup } = storeInDir();
  try {
    let confirms = 0;
    const manager = createTuskManager({
      store,
      slackApi: mockApi(),
      WebSocket: FakeSocket,
      confirmSensitiveChange: async () => {
        confirms += 1;
        return true;
      },
    });
    await manager.applyPatch({ botToken: BOT, appToken: APP, enabled: true });
    assert.equal(confirms, 1);
    await manager.applyPatch({ channelAllowlist: ["C01234567"], enabled: true });
    assert.equal(confirms, 1);
    assert.deepEqual(store.getSlackPublic().channelAllowlist, ["C01234567"]);
    await manager.stop();
  } finally {
    await cleanup();
  }
});
