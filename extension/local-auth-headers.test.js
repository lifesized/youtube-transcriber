const test = require("node:test");
const assert = require("node:assert/strict");
const { localAuthHeadersFromToken } = require("./local-auth-headers.js");

test("local headers include Authorization Bearer when token present", () => {
  const token = "a".repeat(64);
  const headers = localAuthHeadersFromToken(token);
  assert.equal(headers.Authorization, `Bearer ${token}`);
});

test("local headers empty when token missing", () => {
  assert.deepEqual(localAuthHeadersFromToken(null), {});
  assert.deepEqual(localAuthHeadersFromToken(""), {});
});

test("token must not be placed in query strings", () => {
  const token = "a".repeat(64);
  const url = new URL("http://localhost:19720/api/health");
  assert.equal(url.searchParams.has("token"), false);
  assert.equal(url.searchParams.has("access_token"), false);
  const headers = localAuthHeadersFromToken(token);
  assert.ok(headers.Authorization.startsWith("Bearer "));
  assert.equal(url.toString().includes(token), false);
});
