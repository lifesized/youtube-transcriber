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
  const clickHandler = backgroundSource.slice(clickHandlerStart, clickHandlerEnd);
  assert.match(
    clickHandler,
    /type:\s*"PANEL_LAUNCH"[\s\S]*openResolvedAt[\s\S]*deliverPanelLaunchSignal\(tab\.windowId, launchSignal\)/,
    "a retained panel should receive the launch timestamp only after Chrome resolves the open request"
  );
  assert.ok(
    clickHandler.indexOf("launch.openResolvedAt") <
      clickHandler.indexOf("deliverPanelLaunchSignal(tab.windowId, launchSignal)"),
    "a retained document must not report a presented frame before sidePanel.open resolves",
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
  assert.match(
    backgroundSource.slice(clickHandlerStart, clickHandlerEnd),
    /openRequestedAt[\s\S]*openResolvedAt[\s\S]*openRejectedAt/,
    "each toolbar launch should record the Chrome open API lifecycle"
  );
  assert.match(
    clickHandler,
    /openResolvedAt[\s\S]*storage\.local\.set\(\{ \[traceKey\]: launch \}\)[\s\S]*prunePanelClickDiagnostics\(\)[\s\S]*openRejectedAt[\s\S]*storage\.local\.set\(\{ \[traceKey\]: launch \}\)[\s\S]*prunePanelClickDiagnostics\(\)/,
    "late open completion must reapply retention after updating its lifecycle",
  );
  assert.doesNotMatch(backgroundSource.slice(clickHandlerStart,
    backgroundSource.indexOf("chrome.sidePanel.open", clickHandlerStart)), /await/);
  assert.ok(
    clickHandler.indexOf("chrome.sidePanel.open") <
      clickHandler.indexOf("deliverPanelLaunchSignal"),
    "diagnostics must never gate the native side-panel open call"
  );
  assert.match(
    backgroundSource,
    /sidePanelPorts\.set\(portWindowId, port\)[\s\S]*sidePanelPorts\.get\(portWindowId\) === port[\s\S]*sidePanelPorts\.delete\(portWindowId\)/,
    "disconnecting an older window port must not remove its replacement"
  );
  assert.match(
    backgroundSource,
    /deliverPanelLaunchSignal\(tab\.windowId, launchSignal\)[\s\S]*queuePanelLaunchSignal\(windowId, launchSignal\)[\s\S]*pendingPanelLaunchSignals\.get\(portWindowId\)[\s\S]*for \(const pendingLaunch of pendingLaunches\)[\s\S]*port\.postMessage\(pendingLaunch\)/,
    "a newly created panel should receive every queued launch ID after its context handshake"
  );
  assert.match(
    backgroundSource,
    /queued\.push\(launchSignal\)[\s\S]*queued\.slice\(-10\)/,
    "pre-connection rapid-click telemetry must be bounded without overwriting the previous click",
  );
});
