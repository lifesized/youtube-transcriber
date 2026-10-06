import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  ensureLocalApiToken,
  localApiAuthDecision,
  tokenFilePath,
} = require("../lib/local-api-token.js");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function useTempState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-token-"));
  process.env.TRANSCRIBER_STATE_DIR = dir;
  delete process.env.TRANSCRIBER_LOCAL_TOKEN;
  delete process.env.NEXT_PHASE;
  return dir;
}

test("local API auth", { concurrency: 1 }, async (t) => {
  await t.test("missing and wrong bearer tokens are 401; the file token is 200", () => {
    const dir = useTempState();
    const missing = localApiAuthDecision(null);
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 401);

    const token = ensureLocalApiToken();
    assert.equal(localApiAuthDecision("Bearer wrong-token").status, 401);
    assert.equal(localApiAuthDecision("Basic " + token).status, 401);
    assert.equal(localApiAuthDecision("Bearer").status, 401);

    const allowed = localApiAuthDecision("Bearer " + token);
    assert.equal(allowed.ok, true);
    assert.equal(allowed.status, 200);
    assert.equal(localApiAuthDecision("bearer " + token).status, 200);

    const file = tokenFilePath();
    assert.equal(fs.readFileSync(file, "utf8").trim(), token);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    assert.equal(ensureLocalApiToken(), token);
  });

  await t.test("TRANSCRIBER_LOCAL_TOKEN overrides and rewrites the file", () => {
    useTempState();
    fs.mkdirSync(path.dirname(tokenFilePath()), { recursive: true });
    fs.writeFileSync(tokenFilePath(), "stale-token\n", { mode: 0o600 });
    process.env.TRANSCRIBER_LOCAL_TOKEN = "env-token-value";
    assert.equal(ensureLocalApiToken(), "env-token-value");
    assert.equal(fs.readFileSync(tokenFilePath(), "utf8").trim(), "env-token-value");
    assert.equal(localApiAuthDecision("Bearer env-token-value").status, 200);
    assert.equal(localApiAuthDecision("Bearer stale-token").status, 401);
  });

  await t.test("an env override replaces a symlinked token file", () => {
    const dir = useTempState();
    const outside = path.join(dir, "outside");
    fs.writeFileSync(outside, "leaked\n");
    fs.symlinkSync(outside, tokenFilePath());
    process.env.TRANSCRIBER_LOCAL_TOKEN = "replaced-token";
    assert.equal(ensureLocalApiToken(), "replaced-token");
    assert.equal(fs.lstatSync(tokenFilePath()).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(tokenFilePath(), "utf8").trim(), "replaced-token");
    assert.equal(fs.readFileSync(outside, "utf8").trim(), "leaked");
  });

  await t.test("a symlinked token file is refused", () => {
    const dir = useTempState();
    const outside = path.join(dir, "outside");
    fs.writeFileSync(outside, "leaked\n");
    fs.symlinkSync(outside, tokenFilePath());
    assert.throws(() => ensureLocalApiToken(), /symlink/i);
    assert.equal(localApiAuthDecision("Bearer leaked").status, 401);
  });

  await t.test("token decisions do not echo the secret", () => {
    useTempState();
    process.env.TRANSCRIBER_LOCAL_TOKEN = "super-secret-token";
    const decision = localApiAuthDecision("Bearer nope");
    assert.equal(JSON.stringify(decision).includes("super-secret-token"), false);
    const src = fs.readFileSync(path.join(root, "lib", "local-api-token.js"), "utf8");
    assert.doesNotMatch(src, /console\.(log|info|debug|warn|error)/);
  });

  await t.test("--path prints the token path and not a token", () => {
    const dir = useTempState();
    const script = path.join(root, "lib", "local-api-token.js");
    const result = spawnSync(process.execPath, [script, "--path"], {
      env: { ...process.env, TRANSCRIBER_STATE_DIR: dir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, path.join(dir, "local-api.token"));
    assert.equal(result.stdout.includes("Bearer"), false);
    assert.equal(fs.existsSync(result.stdout), false);
  });

  await t.test("health no longer returns projectPath", () => {
    const src = fs.readFileSync(path.join(root, "app", "api", "health", "route.ts"), "utf8");
    assert.doesNotMatch(src, /projectPath/);
  });
});
