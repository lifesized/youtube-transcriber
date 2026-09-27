const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildLaunchRows,
} = require("../scripts/analyze-extension-startup.js");
const backgroundSource = fs.readFileSync(
  path.join(__dirname, "background.js"),
  "utf8",
);

test("service worker leaves report analysis off the measured startup path", () => {
  assert.doesNotMatch(
    backgroundSource,
    /importScripts\([\s\S]*"startup-report\.js"[\s\S]*\);/,
  );
});

test("startup report measures toolbar click through usable panel milestones", () => {
  const report = {
    clicks: [
      {
        launchId: "new-document",
        clickedAt: 1_000,
        openRequestedAt: 1_001,
        openResolvedAt: 1_025,
        windowId: 7,
      },
      {
        launchId: "retained-document",
        clickedAt: 2_000,
        openRequestedAt: 2_001,
        openResolvedAt: 2_020,
        windowId: 7,
      },
      {
        launchId: "no-document",
        clickedAt: 5_000,
        openRequestedAt: 5_001,
        openResolvedAt: 5_010,
        windowId: 9,
      },
      {
        launchId: "recent-pending",
        clickedAt: 129_950,
        openRequestedAt: 129_951,
        openResolvedAt: 129_960,
        windowId: 10,
      },
    ],
    traces: [
      {
        startedAt: 1_050,
        windowId: 7,
        events: [
          { name: "document-script", atMs: 10, wallAt: 1_060 },
          { name: "first-contentful-paint", atMs: 30, wallAt: 1_080 },
          { name: "replacement-frame-presented", atMs: 40, wallAt: 1_090 },
          { name: "state:Ready-frame-presented", atMs: 60, wallAt: 1_110 },
          { name: "recent-cache-frame-presented", atMs: 70, wallAt: 1_120 },
          { name: "focus", atMs: 1_000, wallAt: 2_050 },
          {
            name: "launch-frame-presented",
            atMs: 1_005,
            wallAt: 2_055,
            launchId: "retained-document",
          },
          {
            name: "state:Ready-frame-presented",
            atMs: 1_010,
            wallAt: 2_060,
            launchId: "retained-document",
          },
        ],
      },
    ],
    capturedAt: 130_000,
  };

  const rows = buildLaunchRows(report);
  assert.deepEqual(rows[0], {
    launchId: "new-document",
    clickedAt: 1_000,
    windowId: 7,
    status: "usable",
    openApiMs: 25,
    navigationMs: 50,
    firstScriptMs: 60,
    firstPaintMs: 80,
    reopenFrameMs: null,
    replacementFrameMs: 90,
    primaryStateFrameMs: 110,
    cachedHistoryFrameMs: 120,
    freshHistoryFrameMs: null,
  });
  assert.equal(rows[1].status, "usable");
  assert.equal(rows[1].navigationMs, null);
  assert.equal(rows[1].reopenFrameMs, 55);
  assert.equal(rows[1].primaryStateFrameMs, 60);
  assert.equal(rows[2].status, "evidence-unavailable");
  assert.equal(rows[2].openApiMs, 10);
  assert.equal(rows[2].firstScriptMs, null);
  assert.equal(rows[3].status, "pending");
});

test("a newer click supersedes a retained launch whose frame never appeared", () => {
  const rows = buildLaunchRows({
    capturedAt: 200_000,
    clicks: [
      {
        launchId: "first",
        clickedAt: 1_000,
        openResolvedAt: 1_010,
        windowId: 3,
      },
      {
        launchId: "second",
        clickedAt: 1_005,
        openResolvedAt: 1_015,
        windowId: 3,
      },
    ],
    traces: [
      {
        startedAt: 500,
        windowId: 3,
        events: [
          {
            name: "launch-frame-presented",
            atMs: 520,
            wallAt: 1_020,
            launchId: "first",
            primaryStateVisible: true,
          },
          {
            name: "launch-frame-presented",
            atMs: 530,
            wallAt: 1_030,
            launchId: "second",
            primaryStateVisible: true,
          },
          {
            name: "state:Ready-frame-presented",
            atMs: 535,
            wallAt: 1_035,
            launchId: "second",
          },
        ],
      },
    ],
  });
  assert.equal(rows[0].reopenFrameMs, null);
  assert.equal(rows[1].reopenFrameMs, 25);
  assert.equal(rows[0].status, "superseded");
  assert.equal(rows[1].status, "usable");
});

test("a click after the correlation window does not supersede missing evidence", () => {
  const rows = buildLaunchRows({
    capturedAt: 500_000,
    clicks: [
      {
        launchId: "older",
        clickedAt: 1_000,
        openRequestedAt: 1_001,
        openResolvedAt: 1_010,
        windowId: 3,
      },
      {
        launchId: "much-later",
        clickedAt: 200_000,
        openRequestedAt: 200_001,
        openResolvedAt: 200_010,
        windowId: 3,
      },
    ],
    traces: [],
  });

  assert.equal(rows[0].status, "evidence-unavailable");
});

test("an outbound launch signal alone is not panel activation evidence", () => {
  const report = {
    capturedAt: 130_000,
    clicks: [
      {
        launchId: "signal-only",
        clickedAt: 1_000,
        openRequestedAt: 1_001,
        openResolvedAt: 1_010,
        windowId: 4,
      },
    ],
    traces: [
      {
        startedAt: 500,
        windowId: 4,
        events: [
          {
            name: "launch-signal",
            atMs: 510,
            wallAt: 1_010,
            launchId: "signal-only",
          },
        ],
      },
    ],
  };
  assert.equal(buildLaunchRows(report)[0].status, "panel-signal-without-frame");
  report.capturedAt = 2_000;
  assert.equal(buildLaunchRows(report)[0].status, "pending");
});

test("untagged retained-panel activity is not attributed to a toolbar click", () => {
  const rows = buildLaunchRows({
    capturedAt: 130_000,
    clicks: [
      {
        launchId: "never-presented",
        clickedAt: 1_000,
        openRequestedAt: 1_001,
        openResolvedAt: 1_010,
        windowId: 4,
      },
    ],
    traces: [
      {
        startedAt: 500,
        windowId: 4,
        events: [
          { name: "state:Ready-frame-presented", atMs: 520, wallAt: 1_020 },
          { name: "recent-cache-frame-presented", atMs: 530, wallAt: 1_030 },
        ],
      },
    ],
  });

  assert.equal(rows[0].status, "evidence-unavailable");
  assert.equal(rows[0].primaryStateFrameMs, null);
  assert.equal(rows[0].cachedHistoryFrameMs, null);
});

test("a retained panel's pre-launch visible state is not usable evidence", () => {
  const rows = buildLaunchRows({
    capturedAt: 130_000,
    clicks: [
      {
        launchId: "stale-state",
        clickedAt: 1_000,
        openRequestedAt: 1_001,
        openResolvedAt: 1_010,
        windowId: 4,
      },
    ],
    traces: [
      {
        startedAt: 500,
        windowId: 4,
        events: [
          {
            name: "launch-frame-presented",
            atMs: 520,
            wallAt: 1_020,
            launchId: "stale-state",
            primaryStateVisible: true,
          },
        ],
      },
    ],
  });

  assert.equal(rows[0].status, "panel-painted");
});

test("legacy clicks without open lifecycle fields are explicitly unavailable", () => {
  const rows = buildLaunchRows({
    capturedAt: 500_000,
    clicks: [{ clickedAt: 1_000, windowId: 2 }],
    traces: [],
  });
  assert.equal(rows[0].status, "legacy-unavailable");
});

test("DevTools exporter uses the same launch classifier as the CLI analyzer", () => {
  const exporter = fs.readFileSync(
    path.join(__dirname, "../scripts/extension-diagnostics-console.js"),
    "utf8",
  );
  assert.match(
    exporter,
    /await import\(chrome\.runtime\.getURL\("startup-report\.js"\)\)/,
  );
  assert.doesNotMatch(exporter, /importScripts/);
  assert.match(exporter, /TranscriberStartupReport\.buildLaunchRows/);
  assert.doesNotMatch(exporter, /const durationAfterClick/);
});
