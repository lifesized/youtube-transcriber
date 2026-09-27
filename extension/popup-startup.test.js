const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const popupSource = fs.readFileSync(
  path.join(__dirname, "popup.js"),
  "utf8"
);

test("startup policy bounds page metadata and preserves cache on refresh failure", async () => {
  const { withTimeout, recentRefreshAction } = require("./startup-policy.js");

  const fallback = await withTimeout(
    new Promise(() => {}),
    10,
    "cached-page-info"
  );
  assert.equal(fallback, "cached-page-info");

  assert.equal(recentRefreshAction({ success: false }), "preserve");
  assert.equal(recentRefreshAction({ success: true }), "preserve");
  assert.equal(recentRefreshAction({ success: true, data: {} }), "preserve");
  assert.equal(recentRefreshAction({ success: true, data: [] }), "clear");
  assert.equal(
    recentRefreshAction({ success: true, data: [{ id: "recent-1" }] }),
    "replace"
  );
});

test("a page metadata result that arrives after first paint is reconciled", async () => {
  const { withTimeout } = require("./startup-policy.js");
  let finishDetection;
  let lateResult = null;
  const detection = new Promise((resolve) => {
    finishDetection = resolve;
  });

  const firstPaint = await withTimeout(detection, 10, null, (value) => {
    lateResult = value;
  });
  assert.equal(firstPaint, null);

  finishDetection({ videoId: "late-video" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(lateResult, { videoId: "late-video" });
});

test("popup paints a recent skeleton before startup awaits", () => {
  const initStart = popupSource.indexOf("async function init() {");
  const initEnd = popupSource.indexOf("// PHASE 1", initStart);
  const startupBlock = popupSource.slice(initStart, initEnd);

  assert.match(
    startupBlock,
    /renderRecentSkeleton\(\)/,
    "the side panel should have visible content before reading Chrome state"
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
  assert.match(synchronousPaint, /renderRecentSkeleton\(\)/);
  assert.match(synchronousPaint, /hideStartupShell\(\)/);
});

test("startup diagnostics run before stylesheet parsing and deferred app scripts", () => {
  const html = fs.readFileSync(path.join(__dirname, "popup.html"), "utf8");
  const diagnosticsIndex = html.indexOf(
    '<script src="panel-diagnostics.js"></script>',
  );
  const firstStylesheetIndex = html.indexOf('<link rel="stylesheet"');
  const popupScriptIndex = html.indexOf(
    '<script defer src="popup.js"></script>',
  );

  assert.ok(diagnosticsIndex > -1, "diagnostics must be parser-blocking");
  assert.ok(
    diagnosticsIndex < firstStylesheetIndex,
    "the first timing mark must precede stylesheet parsing",
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
