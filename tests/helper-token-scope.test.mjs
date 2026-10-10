import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server.js";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scope = require(path.join(root, "lib/helper-scope.js"));
const tokens = require(path.join(root, "lib/helper-tokens.js"));
const helperRequest = require(path.join(root, "lib/helper-request.js"));
const helpers = require(path.join(root, "electron/helpers.js"));
const { middleware } = await import("../middleware.ts");

const PORT = 19721;
const MAIN = "m".repeat(64);
const saved = {
  PORT: process.env.PORT,
  TOKEN: process.env.TRANSCRIBER_LOCAL_TOKEN,
  HELPERS: process.env.TRANSCRIBER_HELPER_TOKENS,
};

function restoreEnv() {
  if (saved.PORT === undefined) delete process.env.PORT;
  else process.env.PORT = saved.PORT;
  if (saved.TOKEN === undefined) delete process.env.TRANSCRIBER_LOCAL_TOKEN;
  else process.env.TRANSCRIBER_LOCAL_TOKEN = saved.TOKEN;
  if (saved.HELPERS === undefined) delete process.env.TRANSCRIBER_HELPER_TOKENS;
  else process.env.TRANSCRIBER_HELPER_TOKENS = saved.HELPERS;
}

function send(url, headers, method = "GET") {
  process.env.PORT = String(PORT);
  process.env.TRANSCRIBER_LOCAL_TOKEN = MAIN;
  const res = middleware(
    new NextRequest(`http://127.0.0.1:${PORT}${url}`, {
      method,
      headers: { host: `127.0.0.1:${PORT}`, ...headers },
    })
  );
  return { res, passed: res.headers.get("x-middleware-next") === "1" };
}

test("middleware only shape-checks helper bearers and never reads env tokens", () => {
  const helperTok = "a".repeat(64);
  process.env.TRANSCRIBER_HELPER_TOKENS = JSON.stringify([{ id: "notes", token: helperTok }]);
  try {
    const auth = { authorization: `Bearer ${helperTok}`, "sec-fetch-site": "none" };
    assert.equal(send("/api/summaries", auth).passed, true);
    assert.equal(send("/api/summaries", auth, "POST").passed, true);
    assert.equal(send("/api/transcripts", auth, "POST").passed, true);
    assert.equal(send("/api/settings", auth).passed, true);
    assert.equal(send("/api/settings", auth, "PUT").passed, false);
    assert.equal(send("/api/settings/llm", auth).passed, false);
    assert.equal(send("/api/settings/helpers", auth, "POST").passed, false);
    assert.equal(send("/api/summaries", { authorization: "Bearer not-hex", "sec-fetch-site": "none" }).passed, false);
    assert.equal(scope.looksLikeHelperToken(`Bearer ${helperTok}`), true);
    assert.deepEqual(scope.stripSecretSettings({ groq_api_key: "••••ab", whisper_enabled: "true" }), {
      whisper_enabled: "true",
    });
  } finally {
    restoreEnv();
  }
});

test("Node handlers only enforce when the Bearer looks like a helper token", () => {
  const req = (authorization) => ({
    method: "POST",
    url: "http://127.0.0.1:19721/api/transcripts",
    headers: { get: (name) => (name === "authorization" ? authorization : null) },
  });
  assert.equal(helperRequest.authorizeLocalOrHelper(req(null), { pathname: "/api/transcripts" }).kind, "local");
  assert.equal(
    helperRequest.authorizeLocalOrHelper(req(`Bearer ${"a".repeat(64)}`), {
      method: "POST",
      pathname: "/api/transcripts",
    }).ok,
    false
  );
});

test("Node handlers re-read the 0600 file: new token after startAll, revoke rejects both", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "helper-order-"));
  const stateDir = path.join(dir, "state");
  mkdirSync(stateDir, { recursive: true });
  const helperDir = path.join(stateDir, "helpers", "notes");
  mkdirSync(path.join(helperDir, "bin"), { recursive: true });
  chmodSync(helperDir, 0o755);
  writeFileSync(path.join(helperDir, "bin", "helper"), "#!/bin/sh\n");
  chmodSync(path.join(helperDir, "bin", "helper"), 0o755);
  writeFileSync(
    path.join(helperDir, "manifest.json"),
    JSON.stringify({ id: "notes", displayName: "Notes", executable: "bin/helper", version: "1.0.0" })
  );
  const oldToken = tokens.issueToken("notes", stateDir);
  process.env.TRANSCRIBER_HELPER_TOKENS = JSON.stringify([{ id: "notes", token: oldToken }]);
  const spawned = [];
  const child = { pid: 4242, kill() {}, on() {} };
  const manager = helpers.createHelperManager({
    stateDir,
    helpersDir: path.join(stateDir, "helpers"),
    logDir: path.join(dir, "logs"),
    port: 19721,
    isPackaged: false,
    autostart: true,
    uid: process.getuid(),
    spawn: (exe, args, opts) => {
      spawned.push({ exe, args, env: opts.env });
      return child;
    },
  });
  function check(token) {
    return tokens.authorizeHelperFromStore(
      { authorization: `Bearer ${token}` },
      { method: "GET", pathname: "/api/summaries", stateDir }
    );
  }
  try {
    manager.persistTokens();
    assert.equal(process.env.TRANSCRIBER_HELPER_TOKENS.includes(oldToken), true, "env still holds the pre-start token");
    const afterPersist = check(oldToken);
    assert.equal(afterPersist.ok, true);

    manager.enable("notes");
    manager.startAll();
    assert.equal(spawned.length, 1);
    const minted = spawned[0].env.TRANSCRIBER_HELPER_TOKEN;
    assert.notEqual(minted, oldToken);
    assert.equal(process.env.TRANSCRIBER_HELPER_TOKENS.includes(minted), false, "Next env never receives the new token");
    assert.equal(check(minted).ok, true, "file re-read accepts the token minted at startAll");
    assert.equal(check(oldToken).ok, false, "pre-start token is no longer in the file");

    tokens.revokeToken("notes", stateDir);
    assert.equal(check(minted).ok, false);
    assert.equal(check(oldToken).ok, false);
    assert.doesNotMatch(JSON.stringify(check(minted)), new RegExp(minted));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    restoreEnv();
  }
});
