import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  migrateLegacyIntegrationState,
  purgeLegacyEncFields,
  unlinkRegularFileNoFollow,
  isLegacyEncKey,
  LEGACY_STATE_FILES,
  MARKER_FILE,
  SECRETS_FILE,
} = require(path.join(root, "electron/legacy-integration-state.js"));

function tmpState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ytt-legacy-state-"));
}

function modeOf(file) {
  return fs.statSync(file).mode & 0o777;
}

test("legacy Enc keys are identified without decrypting", () => {
  assert.equal(isLegacyEncKey("slackBotTokenEnc"), true);
  assert.equal(isLegacyEncKey("slackAppTokenEnc"), true);
  assert.equal(isLegacyEncKey("llmApiKeyEnc"), false);
  assert.equal(isLegacyEncKey("notionTokenEnc"), false);
  const src = fs.readFileSync(path.join(root, "electron/legacy-integration-state.js"), "utf8");
  assert.doesNotMatch(src, /_decrypt|decryptString|safeStorage/);
  assert.match(src, /legacy integration state/);
});

test("purge drops leftover Enc fields and keeps the rest", () => {
  const { next, changed } = purgeLegacyEncFields({
    llmProvider: "anthropic",
    llmApiKeyEnc: "keep-me",
    slackBotTokenEnc: "cipher-bot",
    slackAppTokenEnc: "cipher-app",
    slackEnabled: true,
  });
  assert.equal(changed, true);
  assert.equal(next.llmApiKeyEnc, "keep-me");
  assert.equal(next.slackEnabled, true);
  assert.equal("slackBotTokenEnc" in next, false);
  assert.equal("slackAppTokenEnc" in next, false);
});

test("startup migration rewrites secrets at 0600, deletes leftover files, and runs once", () => {
  const stateDir = tmpState();
  const secretsPath = path.join(stateDir, SECRETS_FILE);
  const markerPath = path.join(stateDir, MARKER_FILE);
  fs.writeFileSync(
    secretsPath,
    JSON.stringify({
      llmApiKeyEnc: "keep-cipher",
      slackBotTokenEnc: "do-not-decrypt",
      slackAppTokenEnc: "also-secret",
    })
  );
  fs.chmodSync(secretsPath, 0o644);
  for (const name of LEGACY_STATE_FILES) {
    fs.writeFileSync(path.join(stateDir, name), '{"seen":true}\n');
  }
  const logs = [];
  const warn = console.warn;
  const error = console.error;
  const log = console.log;
  console.warn = (...args) => logs.push(["warn", ...args]);
  console.error = (...args) => logs.push(["error", ...args]);
  console.log = (...args) => logs.push(["log", ...args]);
  try {
    assert.deepEqual(migrateLegacyIntegrationState(stateDir), { skipped: false });
    const rewritten = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
    assert.equal(rewritten.llmApiKeyEnc, "keep-cipher");
    assert.equal("slackBotTokenEnc" in rewritten, false);
    assert.equal("slackAppTokenEnc" in rewritten, false);
    assert.equal(modeOf(secretsPath), 0o600);
    for (const name of LEGACY_STATE_FILES) {
      assert.equal(fs.existsSync(path.join(stateDir, name)), false, name);
    }
    assert.equal(fs.existsSync(markerPath), true);
    assert.equal(modeOf(markerPath), 0o600);
    assert.equal(
      logs.some((entry) => entry.some((part) => String(part).includes("do-not-decrypt"))),
      false,
      "must never log leftover ciphertext"
    );

    fs.writeFileSync(
      secretsPath,
      JSON.stringify({ slackBotTokenEnc: "reintroduced" })
    );
    fs.writeFileSync(path.join(stateDir, LEGACY_STATE_FILES[0]), "again\n");
    assert.deepEqual(migrateLegacyIntegrationState(stateDir), { skipped: true });
    assert.equal(
      JSON.parse(fs.readFileSync(secretsPath, "utf8")).slackBotTokenEnc,
      "reintroduced"
    );
    assert.equal(fs.existsSync(path.join(stateDir, LEGACY_STATE_FILES[0])), true);
  } finally {
    console.warn = warn;
    console.error = error;
    console.log = log;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("leftover file delete uses lstat and does not follow a symlink", () => {
  const stateDir = tmpState();
  const target = path.join(stateDir, "real-target.json");
  const link = path.join(stateDir, LEGACY_STATE_FILES[0]);
  fs.writeFileSync(target, "keep\n");
  fs.symlinkSync(target, link);
  assert.equal(unlinkRegularFileNoFollow(link), false);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(target, "utf8"), "keep\n");
  fs.rmSync(stateDir, { recursive: true, force: true });
});

test("main runs the one-time migration on startup", () => {
  const main = fs.readFileSync(path.join(root, "electron/main.js"), "utf8");
  assert.match(main, /migrateLegacyIntegrationState/);
  const ready = main.slice(main.indexOf("app.whenReady()"));
  assert.match(ready, /migrateLegacyIntegrationState\(\)/);
  assert.ok(ready.indexOf("migrateLegacyIntegrationState") < ready.indexOf("new SecretsStore"));
});
