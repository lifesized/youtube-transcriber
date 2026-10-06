import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { proxy, config } from "../proxy.ts";

const { ensureLocalApiToken } = createRequire(import.meta.url)("../lib/local-api-token.js");

test("proxy returns 401 without a bearer and continues with the file token", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-proxy-"));
  process.env.TRANSCRIBER_STATE_DIR = dir;
  delete process.env.TRANSCRIBER_LOCAL_TOKEN;
  delete process.env.NEXT_PHASE;

  assert.deepEqual(config.matcher, ["/api/:path*"]);

  const token = ensureLocalApiToken();
  const denied = await proxy(new NextRequest("http://127.0.0.1:19720/api/transcripts"));
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("x-transcriber-service"), "1");
  assert.equal(denied.headers.get("www-authenticate"), "Bearer");
  const body = await denied.json();
  assert.deepEqual(body, { error: "Unauthorized" });
  assert.equal(JSON.stringify(body).includes(token), false);

  for (const pathname of [
    "/api/transcripts",
    "/api/settings",
    "/api/settings/providers",
    "/api/transcripts/abc/summarize",
  ]) {
    const rejected = await proxy(new NextRequest("http://127.0.0.1:19720" + pathname));
    assert.equal(rejected.status, 401, pathname);
  }

  const allowed = await proxy(
    new NextRequest("http://127.0.0.1:19720/api/settings", {
      headers: { authorization: "Bearer " + token },
    })
  );
  assert.equal(allowed.status, 200);
});
