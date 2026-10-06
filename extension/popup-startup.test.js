const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "popup.html"), "utf8");
const popup = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");

test("the send control is in the static document", () => {
  const button = html.indexOf('id="btnSend"');
  const script = html.indexOf('<script defer src="popup.js"></script>');
  assert.ok(button > -1);
  assert.ok(script > button, "the button is parsed before popup.js runs");
  assert.match(html, /disabled>Send this page</);
  assert.doesNotMatch(html, /panel-diagnostics|startupShell|transcribed\.dev/);
});

test("the panel sends the page URL and does not touch storage", () => {
  assert.match(popup, /type:\s*"SEND_PAGE_URL"/);
  assert.match(popup, /normalizePageUrl\(raw\)/);
  assert.doesNotMatch(popup, /chrome\.storage|fetch\(|yttx|apiKey|token/);
});
