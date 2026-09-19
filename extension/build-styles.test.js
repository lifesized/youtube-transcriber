const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("packaged panel styles are self-contained and preserve the source primitives", () => {
  const { inlinePanelStyles } = require("./build-styles.js");
  const source = fs.readFileSync(path.join(__dirname, "popup.html"), "utf8");
  const html = inlinePanelStyles(source, __dirname);
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/);
  assert.doesNotMatch(html, /@import\s/);
  assert.match(html, /\.startup-shell\s*\{/);
  assert.match(html, /--ds-color-bg:/);
  assert.match(html, /--bg: var\(--ds-color-bg\)/);
  assert.match(html, /\.setup-wall/);
  assert.ok(html.indexOf("<style>") < html.indexOf('<div class="popup">'));
  assert.match(html, /<script defer src="popup.js"/);
});
