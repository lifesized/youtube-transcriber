const test = require("node:test");
const assert = require("node:assert/strict");
const { buildLocalSendRequest, normalizePageUrl } = require("./send-url.js");

const TOKEN = "a".repeat(64);
const WATCH = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s";

test("send request posts only the page URL to loopback", () => {
  const request = buildLocalSendRequest(WATCH, TOKEN);
  assert.equal(request.ok, true);
  assert.equal(request.url, "http://127.0.0.1:19720/api/transcripts");
  assert.equal(new URL(request.url).search, "");
  assert.equal(request.headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(JSON.parse(request.body), { url: WATCH });
  assert.equal(request.body.includes(TOKEN), false);
  assert.equal(request.url.includes(TOKEN), false);
});

test("secret query and hash params are removed before send", () => {
  const dirty =
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&token=" +
    TOKEN +
    "&api_key=sk-test&yttx=handoff#access_token=hidden";
  const request = buildLocalSendRequest(dirty, TOKEN);
  assert.equal(request.ok, true);
  const sent = new URL(JSON.parse(request.body).url);
  assert.equal(sent.searchParams.get("v"), "dQw4w9WgXcQ");
  assert.equal(sent.searchParams.has("token"), false);
  assert.equal(sent.searchParams.has("api_key"), false);
  assert.equal(sent.searchParams.has("yttx"), false);
  assert.equal(sent.hash.includes("access_token"), false);
  assert.equal(sent.href.includes(TOKEN), false);
  assert.equal(request.body.includes(TOKEN), false);
});

test("userinfo and non-http URLs are not sent", () => {
  const withUser = normalizePageUrl(
    "https://user:secret@www.youtube.com/watch?v=dQw4w9WgXcQ"
  );
  assert.equal(withUser.includes("secret"), false);
  assert.equal(withUser.includes("user"), false);
  assert.equal(normalizePageUrl("chrome-extension://abc/popup.html"), null);
  assert.equal(normalizePageUrl("javascript:alert(1)"), null);
  assert.equal(buildLocalSendRequest(WATCH, "").ok, false);
  assert.equal(buildLocalSendRequest(WATCH, null).ok, false);
});

test("a token embedded outside query params is refused", () => {
  const request = buildLocalSendRequest(
    `https://example.com/${TOKEN}`,
    TOKEN
  );
  assert.equal(request.ok, false);
});
