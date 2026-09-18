const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backgroundSource = fs.readFileSync(
  path.join(__dirname, "background.js"),
  "utf8"
);

test("toolbar clicks use Chrome's built-in side-panel toggle", () => {
  assert.match(
    backgroundSource,
    /chrome\.sidePanel\s*\.setPanelBehavior\(\{\s*openPanelOnActionClick:\s*true\s*\}\)/,
    "the action icon should opt into Chrome's side-panel click behavior"
  );
  assert.doesNotMatch(
    backgroundSource,
    /chrome\.action\.onClicked\.addListener/,
    "a manual click handler can mistake a connected-but-hidden panel for an open one"
  );
});
