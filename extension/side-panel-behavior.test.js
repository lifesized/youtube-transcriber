const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backgroundSource = fs.readFileSync(
  path.join(__dirname, "background.js"),
  "utf8"
);

test("toolbar clicks explicitly open the preconfigured panel", () => {
  assert.match(
    backgroundSource,
    /chrome\.sidePanel\s*\.setPanelBehavior\(\{\s*openPanelOnActionClick:\s*false\s*\}\)/,
    "Chrome's implicit opener must be disabled"
  );
  assert.match(
    backgroundSource,
    /chrome\.action\.onClicked\.addListener/,
    "the toolbar click should explicitly configure and open the panel"
  );
  assert.match(
    backgroundSource,
    /setOptions\(\{\s*path:\s*"popup\.html",\s*enabled:\s*true\s*\}\)[\s\S]*chrome\.action\.onClicked\.addListener/,
    "the document path must be configured during worker initialization"
  );

  const clickHandlerStart = backgroundSource.indexOf(
    "chrome.action.onClicked.addListener"
  );
  const clickHandlerEnd = backgroundSource.indexOf(
    "// Retained only as a command channel",
    clickHandlerStart
  );
  assert.doesNotMatch(
    backgroundSource.slice(clickHandlerStart, clickHandlerEnd),
    /sidePanelPort/,
    "a connected document must not be treated as panel visibility"
  );
  assert.doesNotMatch(
    backgroundSource.slice(clickHandlerStart, clickHandlerEnd),
    /setOptions/,
    "opening must remain directly inside the toolbar user gesture"
  );
  assert.match(
    backgroundSource.slice(clickHandlerStart, clickHandlerEnd),
    /open\(\{\s*windowId:\s*tab\.windowId\s*\}\)/
  );
  assert.doesNotMatch(backgroundSource.slice(clickHandlerStart,
    backgroundSource.indexOf("chrome.sidePanel.open", clickHandlerStart)), /await/);
});
