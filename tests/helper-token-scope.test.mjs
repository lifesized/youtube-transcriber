import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server.js";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scope = require(path.join(root, "lib/helper-scope.js"));
const tokens = require(path.join(root, "lib/helper-tokens.js"));
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

test("helper token allows only transcribe, summarize, and non-secret settings read", () => {
  const helperTok = "h".repeat(64);
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
    assert.deepEqual(scope.stripSecretSettings({ groq_api_key: "••••ab", whisper_enabled: "true" }), {
      whisper_enabled: "true",
    });
  } finally {
    restoreEnv();
  }
});

test("revoked helper tokens are rejected and values never appear in errors", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "helper-tok-"));
  try {
    const token = tokens.issueToken("notes", dir);
    assert.equal(tokens.listActiveRecords(dir).length, 1);
    const allowed = scope.authorizeHelperBearer(
      { authorization: `Bearer ${token}` },
      { method: "GET", pathname: "/api/summaries", records: tokens.listActiveRecords(dir) }
    );
    assert.equal(allowed.ok, true);
    tokens.revokeToken("notes", dir);
    const denied = scope.authorizeHelperBearer(
      { authorization: `Bearer ${token}` },
      { method: "GET", pathname: "/api/summaries", records: tokens.listActiveRecords(dir) }
    );
    assert.equal(denied.ok, false);
    assert.doesNotMatch(JSON.stringify(denied), new RegExp(token));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    restoreEnv();
  }
});
