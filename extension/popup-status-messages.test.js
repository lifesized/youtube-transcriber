const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

/**
 * Tests for YTT-443: popup.js status message mapping.
 * Verifies that the exact locked copy is shown for each failure reason.
 */

const popup = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");

test("popup maps reason 'unreachable' to exact status text", () => {
  assert.match(
    popup,
    /reason === "unreachable".*Start the Transcriber app\./s
  );
});

test("popup maps reason 'unauthorized' to exact status text", () => {
  assert.match(
    popup,
    /reason === "unauthorized".*Token missing or out of date — restart Transcriber\./s
  );
});

test("popup maps reason 'project_not_configured' to setup copy", () => {
  assert.match(
    popup,
    /reason === "project_not_configured".*Transcriber isn't set up in this folder yet\./s
  );
});

test("popup shows generic error for other failures", () => {
  // Should have a fallback to "Couldn't send this URL."
  assert.match(popup, /Couldn't send this URL\./);
});

test("popup never puts TRANSCRIBER_LOCAL_TOKEN on the status line", () => {
  // The status line should not contain TRANSCRIBER_LOCAL_TOKEN
  // (it's allowed in tooltips/secondary UI only, but we're not adding that yet)
  const statusCalls = popup.match(/setStatus\([^)]+\)/g) || [];
  for (const call of statusCalls) {
    assert.doesNotMatch(call, /TRANSCRIBER_LOCAL_TOKEN/);
  }
});

test("popup never stores or reads from chrome.storage", () => {
  // YTT-442 policy: no storage
  assert.doesNotMatch(popup, /chrome\.storage/);
});
