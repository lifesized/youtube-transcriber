"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SidePanelClose = require("./side-panel-close.js");

test("content script still asks the background to close on fullscreen", () => {
  const content = fs.readFileSync(path.join(__dirname, "content.js"), "utf8");
  assert.match(content, /type:\s*"CLOSE_PANEL"/);
  assert.match(content, /fullscreenchange/);
  assert.match(content, /ytp-fullscreen/);
});

test("background forwards CLOSE_PANEL and Chrome window fullscreen", () => {
  const bg = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
  assert.match(bg, /side-panel-close\.js/);
  assert.match(bg, /case "CLOSE_PANEL"/);
  assert.match(bg, /SidePanelClose\.closeSidePanel/);
  assert.match(bg, /onBoundsChanged/);
  assert.match(bg, /isFullscreenWindow/);
  assert.match(bg, /PANEL_CONTEXT/);
  assert.match(bg, /port\.windowId/);
});

test("closeSidePanel uses sidePanel.close when Chrome provides it", async () => {
  const closed = [];
  const ports = [{ windowId: 42, postMessage: (msg) => closed.push(["port", msg]) }];
  const chromeApi = {
    sidePanel: {
      close: async (opts) => {
        closed.push(["close", opts]);
      },
      setOptions: async () => {
        closed.push(["setOptions"]);
      },
    },
  };
  const result = await SidePanelClose.closeSidePanel(chromeApi, ports, 42);
  assert.deepEqual(result, { ok: true, method: "close" });
  assert.deepEqual(closed, [
    ["port", { type: "CLOSE" }],
    ["close", { windowId: 42 }],
  ]);
});

test("closeSidePanel falls back to disable-then-reenable", async () => {
  const opts = [];
  const chromeApi = {
    sidePanel: {
      setOptions: async (o) => {
        opts.push(o);
      },
    },
  };
  const result = await SidePanelClose.closeSidePanel(chromeApi, [], 7);
  assert.equal(result.method, "disable-reenable");
  assert.equal(opts[0].enabled, false);
  assert.equal(opts[0].windowId, 7);
  assert.equal(opts[1].enabled, true);
  assert.equal(opts[1].path, "popup.html");
});

test("postClose only notifies ports for the fullscreen window", () => {
  const seen = [];
  const ports = [
    { windowId: 1, postMessage: (msg) => seen.push(["1", msg]) },
    { windowId: 2, postMessage: (msg) => seen.push(["2", msg]) },
    { postMessage: (msg) => seen.push(["none", msg]) },
  ];
  SidePanelClose.postClose(ports, 2);
  assert.deepEqual(seen, [["2", { type: "CLOSE" }]]);
});

test("isFullscreenWindow is only Chrome window fullscreen", () => {
  assert.equal(SidePanelClose.isFullscreenWindow({ state: "fullscreen" }), true);
  assert.equal(SidePanelClose.isFullscreenWindow({ state: "normal" }), false);
  assert.equal(SidePanelClose.isFullscreenWindow({ state: "maximized" }), false);
  assert.equal(SidePanelClose.isFullscreenWindow(null), false);
});
