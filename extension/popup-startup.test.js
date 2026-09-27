const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const popupSource = fs.readFileSync(
  path.join(__dirname, "popup.js"),
  "utf8"
);

test("the static shell remains the only loading UI before startup awaits", () => {
  const initStart = popupSource.indexOf("async function init() {");
  const initEnd = popupSource.indexOf("// PHASE 1", initStart);
  const startupBlock = popupSource.slice(initStart, initEnd);

  assert.doesNotMatch(
    startupBlock,
    /renderRecentSkeleton\(\)/,
    "the application skeleton must not stack underneath the static shell",
  );
});

test("popup has an HTML-first shell while deferred scripts start", () => {
  const html = fs.readFileSync(path.join(__dirname, "popup.html"), "utf8");
  const shellIndex = html.indexOf('id="startupShell"');

  assert.ok(shellIndex > -1, "startup shell must exist in static HTML");
  assert.match(html, /<script defer src="popup\.js"><\/script>/);

  const initStart = popupSource.indexOf("async function init() {");
  const firstPhase = popupSource.indexOf("// PHASE 1", initStart);
  const synchronousPaint = popupSource.slice(initStart, firstPhase);
  assert.doesNotMatch(synchronousPaint, /renderRecentSkeleton\(\)/);
  assert.doesNotMatch(
    synchronousPaint,
    /hideStartupShell\(\)/,
    "the static shell must remain available until a real state replaces it",
  );
  assert.match(
    popupSource,
    /function showState\(name\)[\s\S]*hideStartupShell\(\)/,
  );
});

test("opening Settings replaces the startup shell", () => {
  assert.match(
    popupSource,
    /function showSettingsView\(\)[\s\S]*hideStartupShell\(\)/,
  );
});

test("startup diagnostics preserve defer order without blocking HTML parsing", () => {
  const html = fs.readFileSync(path.join(__dirname, "popup.html"), "utf8");
  const diagnosticsIndex = html.indexOf(
    '<script defer src="panel-diagnostics.js"></script>',
  );
  const firstStylesheetIndex = html.indexOf('<link rel="stylesheet"');
  const popupScriptIndex = html.indexOf(
    '<script defer src="popup.js"></script>',
  );

  assert.ok(diagnosticsIndex > -1, "diagnostics must be deferred");
  assert.ok(
    diagnosticsIndex < firstStylesheetIndex,
    "diagnostics should be declared before styles and the app script",
  );
  assert.ok(
    diagnosticsIndex < popupScriptIndex,
    "the timing mark must precede deferred application scripts",
  );
});

test("retained panel launch signals measure the next presented frame", () => {
  assert.match(
    popupSource,
    /function connectPanelPort\(\)[\s\S]*type:\s*"PANEL_CONTEXT"[\s\S]*windows\.getCurrent\(\)/,
  );
  assert.match(
    popupSource,
    /onDisconnect\.addListener[\s\S]*port === nextPort[\s\S]*window\.addEventListener\("focus", connectPanelPort\)[\s\S]*visibilityState === "visible"[\s\S]*connectPanelPort\(\)/,
    "a retained panel should re-handshake after normal MV3 worker suspension",
  );
  assert.match(
    popupSource,
    /msg\.type === "PANEL_LAUNCH"[\s\S]*pendingPanelLaunchId = msg\.launchId[\s\S]*pendingPanelLaunchExpiresAt[\s\S]*mark\(\s*"launch-signal"[\s\S]*afterNextPaint\(\s*"launch-frame-presented"/,
  );
  assert.match(
    popupSource,
    /function showState\(name\)[\s\S]*currentPanelState = name[\s\S]*getPanelLaunchContext\(\)[\s\S]*`state:\$\{name\}-frame-presented`[\s\S]*launchContext/,
    "usable retained-panel evidence must come from a post-launch state frame",
  );
  assert.doesNotMatch(
    popupSource,
    /function showState\(name\)[\s\S]*pendingPanelLaunchId = null/,
    "the launch ID must survive long enough to correlate async history frames",
  );
  assert.match(
    popupSource,
    /msg\.type === "PANEL_LAUNCH"[\s\S]*currentPanelState[\s\S]*`state:\$\{currentPanelState\}-frame-presented`/,
    "a retained panel whose state was already rendered should re-present that state after open resolves",
  );
  assert.match(
    popupSource,
    /"recent-cache-rendered",\s*undefined,\s*getPanelLaunchContext\(\)[\s\S]*"recent-cache-frame-presented",\s*getPanelLaunchContext\(\)[\s\S]*"recent-response",\s*undefined,\s*getPanelLaunchContext\(\)[\s\S]*"recent-fresh-frame-presented",\s*getPanelLaunchContext\(\)/,
    "cached and fresh history milestones should retain the bounded launch context",
  );
});

test("recent cache does not wait for a background settings round-trip", () => {
  const loadRecentStart = popupSource.indexOf("async function loadRecent(");
  const loadRecentEnd = popupSource.indexOf(
    "function renderRecentSkeleton",
    loadRecentStart
  );
  const loadRecentSource = popupSource.slice(loadRecentStart, loadRecentEnd);

  assert.doesNotMatch(loadRecentSource, /GET_SETTINGS/);
  assert.match(loadRecentSource, /recentRefreshAction\(res\)/);
});
