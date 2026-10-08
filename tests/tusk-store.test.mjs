import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { SecretsStore, maskSlackToken } = require(path.join(root, "electron/secrets-store.js"));

const BOT = "xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUv";
const APP = "xapp-1-A01234567890-1234567890123-abcdef0123456789abcdef0123456789";

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`enc:${plain}`, "utf8"),
    decryptString: (buf) => {
      const s = Buffer.from(buf).toString("utf8");
      if (!s.startsWith("enc:")) throw new Error("bad cipher");
      return s.slice(4);
    },
  };
}

test("Slack tokens are encrypted on disk and public view is saved ••••last4", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tusk-store-"));
  const prev = process.env.TRANSCRIBER_STATE_DIR;
  process.env.TRANSCRIBER_STATE_DIR = dir;
  const lines = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...args) => lines.push(args.map(String).join(" "));
  console.log = (...args) => lines.push(args.map(String).join(" "));
  try {
    const store = new SecretsStore({ safeStorage: fakeSafeStorage() });
    store.setSlack({
      botToken: BOT,
      appToken: APP,
      enabled: true,
      teamId: "T123",
      teamName: "Personal",
      botName: "tusk",
      channelAllowlist: ["C01234567"],
    });
    const disk = readFileSync(path.join(dir, "electron-secrets.json"), "utf8");
    assert.equal(disk.includes(BOT), false);
    assert.equal(disk.includes(APP), false);
    assert.match(disk, /slackBotTokenEnc/);
    const publicView = store.getSlackPublic();
    assert.equal(publicView.botTokenMasked, maskSlackToken(BOT));
    assert.equal(publicView.appTokenMasked, `saved ••••${APP.slice(-4)}`);
    assert.equal(publicView.hasBotToken, true);
    assert.equal(JSON.stringify(publicView).includes(BOT), false);
    assert.equal(store.getPlain().llmApiKey, "");
    assert.equal("botToken" in store.getPlain(), false);
    assert.equal(store.getSlackPlain().botToken, BOT);
    const joined = lines.join("\n");
    assert.equal(joined.includes(BOT), false);
    assert.equal(joined.includes(APP), false);
  } finally {
    console.error = originalError;
    console.log = originalLog;
    if (prev === undefined) delete process.env.TRANSCRIBER_STATE_DIR;
    else process.env.TRANSCRIBER_STATE_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
