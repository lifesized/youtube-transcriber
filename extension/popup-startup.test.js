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

test("initial refresh is deferred to allow panel to paint first (YTT-456)", () => {
  // The initial refresh() must be wrapped in requestIdleCallback or setTimeout
  // to prevent blocking the panel paint on chrome.tabs.query service-worker wake.
  // The fix for cold service worker latency: panel shows skeleton immediately,
  // then updates asynchronously when tab info arrives.
  assert.match(popup, /requestIdleCallback.*refresh.*timeout.*300/);
  assert.match(popup, /setTimeout.*refresh.*0/);
  // Event listeners calling refresh() are fine (they're in callbacks).
  // The blocking pattern is a bare `refresh();` at the end of the file,
  // outside any function or listener callback.
  const lastLine = popup.trim().split("\n").pop().trim();
  assert.notStrictEqual(lastLine, "refresh();", "popup.js must not end with a synchronous refresh() call");
});
