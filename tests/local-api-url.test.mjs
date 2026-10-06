import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { isSameOriginApiUrl } = createRequire(import.meta.url)("../lib/local-api-url.js");
const origin = "http://127.0.0.1:19720";

test("same-origin API urls receive the bearer token", () => {
  assert.equal(isSameOriginApiUrl("/api/transcripts", origin), true);
  assert.equal(isSameOriginApiUrl("/api/transcripts?q=rick", origin), true);
  assert.equal(isSameOriginApiUrl(origin + "/api/health", origin), true);
});

test("other origins and non-API paths do not receive the token", () => {
  assert.equal(
    isSameOriginApiUrl("https://www.youtube.com/oembed?url=1", origin),
    false
  );
  assert.equal(isSameOriginApiUrl("https://evil.test/api/transcripts", origin), false);
  assert.equal(isSameOriginApiUrl("/settings", origin), false);
  assert.equal(isSameOriginApiUrl("/apples", origin), false);
});
