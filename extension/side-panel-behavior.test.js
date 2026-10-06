const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backgroundSource = fs.readFileSync(
  path.join(__dirname, "background.js"),
  "utf8"
);

test("toolbar clicks open the side panel without storing anything", () => {
  assert.match(
    backgroundSource,
    /chrome\.sidePanel\s*\.setPanelBehavior\(\{\s*openPanelOnActionClick:\s*false\s*\}\)/
  );
  assert.match(
    backgroundSource,
    /setOptions\(\{\s*path:\s*"popup\.html",\s*enabled:\s*true\s*\}\)/
  );

  const clickStart = backgroundSource.indexOf(
    "chrome.action.onClicked.addListener"
  );
  assert.ok(clickStart > -1);
  const clickHandler = backgroundSource.slice(clickStart);
  assert.match(clickHandler, /chrome\.sidePanel\.open\(\{\s*windowId:\s*tab\.windowId\s*\}\)/);
  assert.doesNotMatch(clickHandler, /await|chrome\.storage|setOptions/);
  assert.doesNotMatch(backgroundSource, /chrome\.storage/);
});

test("send uses the native-host token in memory and a header, not a URL", () => {
  assert.match(backgroundSource, /getLocalToken/);
  assert.match(backgroundSource, /_localTokenMemory/);
  assert.match(backgroundSource, /buildLocalSendRequest\(pageUrl,\s*tokenResult\.token\)/);
  assert.match(backgroundSource, /credentials:\s*"omit"/);
  assert.doesNotMatch(
    backgroundSource,
    /searchParams|chrome\.storage|transcribed\.dev|\?token|yttx/
  );
});
