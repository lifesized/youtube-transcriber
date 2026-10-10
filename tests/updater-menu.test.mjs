import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { updaterMenuItem, UPDATER_COPY, downloadingLabel } = require(
  path.join(root, "electron", "updater-menu.js")
);
const trayCopy = require(path.join(root, "electron", "tray-copy.js"));

test("disabled updater never shows the item as active", () => {
  for (const state of [null, undefined, { enabled: false }, { enabled: false, status: "ready" }]) {
    const item = updaterMenuItem(state);
    assert.equal(item.label, UPDATER_COPY.check);
    assert.equal(item.enabled, false);
    assert.equal(item.action, "none");
  }
});

test("menu states use Design's final updater copy", () => {
  assert.equal(UPDATER_COPY.check, trayCopy.updaterCheckLabel());
  assert.deepEqual(updaterMenuItem({ enabled: true, status: "idle" }), {
    label: "Check for Updates…",
    enabled: true,
    action: "check",
  });
  assert.deepEqual(updaterMenuItem({ enabled: true, status: "checking" }), {
    label: "Checking for Updates…",
    enabled: false,
    action: "none",
  });
  assert.deepEqual(updaterMenuItem({ enabled: true, status: "up-to-date" }), {
    label: "Transcriber Is Up to Date",
    enabled: false,
    action: "none",
  });
  assert.deepEqual(
    updaterMenuItem({ enabled: true, status: "available", version: "0.2.0-beta.2" }),
    {
      label: "Update Available — 0.2.0-beta.2",
      enabled: true,
      action: "download",
    }
  );
  assert.deepEqual(updaterMenuItem({ enabled: true, status: "downloading", percent: 42.2 }), {
    label: "Downloading Update… 42%",
    enabled: false,
    action: "none",
  });
  assert.deepEqual(updaterMenuItem({ enabled: true, status: "ready" }), {
    label: "Restart to Update",
    enabled: true,
    action: "restart",
  });
});

test("downloading percent is clamped", () => {
  assert.equal(downloadingLabel(-4), "Downloading Update… 0%");
  assert.equal(downloadingLabel(140), "Downloading Update… 100%");
  assert.equal(downloadingLabel(undefined), "Downloading Update… 0%");
});
