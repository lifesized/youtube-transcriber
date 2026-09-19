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
