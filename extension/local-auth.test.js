const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { localAuthorizationHeader } = require("./local-auth.js");

const background = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
const popup = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");

test("local authorization header is a bearer token and rejects empty input", () => {
  assert.deepEqual(localAuthorizationHeader("abc"), {
    Authorization: "Bearer abc",
  });
  assert.throws(() => localAuthorizationHeader(""), /local_token_unavailable/);
  assert.throws(() => localAuthorizationHeader("a b"), /local_token_unavailable/);
});

test("local mode attaches the bearer token from the native host", () => {
  assert.match(background, /importScripts\("local-auth\.js"\)/);
  assert.match(background, /callNativeHost\("getLocalToken"\)/);
  assert.match(background, /headers: localAuthorizationHeader\(token\)/);
  assert.match(popup, /Local API token required/);
  assert.match(popup, /tokenError/);
  assert.match(popup, /DOWNLOAD_TRANSCRIPT/);
  assert.match(popup, /showState\("NoService"\)/);
});

test("the token is not stored or placed in a query string", () => {
  for (const source of [background, popup]) {
    assert.doesNotMatch(source, /[?&]token=/);
    assert.doesNotMatch(
      source,
      /chrome\.storage\.(local|sync|session)\.set\(\s*\{[^}]*[Tt]oken/
    );
  }
  assert.doesNotMatch(background, /projectPath/);
});
