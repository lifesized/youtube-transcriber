"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ConnectTarget = require("./connect-target.js");
const ROOT = __dirname;

test("default target is Transcriber app on 19721 with the app host name", () => {
  assert.equal(ConnectTarget.normalize(undefined), ConnectTarget.APP);
  assert.equal(ConnectTarget.normalize(null), ConnectTarget.APP);
  assert.equal(ConnectTarget.normalize("nope"), ConnectTarget.APP);
  const app = ConnectTarget.getTarget(undefined);
  assert.equal(app.id, "app");
  assert.equal(app.label, "Transcriber app");
  assert.equal(app.apiBase, "http://127.0.0.1:19721");
  assert.equal(app.nativeHostName, "com.transcribed.app.host");
  assert.equal(app.pairUrl, "http://127.0.0.1:19721/api/native-host/pair");
  assert.equal(
    app.nativeHostLogHint,
    "~/Library/Logs/Transcriber App/native-host.log"
  );
});

test("Dev server target uses 19720 and the checkout host name", () => {
  const dev = ConnectTarget.getTarget("dev");
  assert.equal(dev.id, "dev");
  assert.equal(dev.label, "Dev server");
  assert.equal(dev.apiBase, "http://127.0.0.1:19720");
  assert.equal(dev.nativeHostName, "com.transcribed.host");
  assert.equal(
    dev.nativeHostLogHint,
    "~/Library/Logs/Transcriber/native-host.log"
  );
  assert.notEqual(
    ConnectTarget.getTarget("app").nativeHostLogHint,
    dev.nativeHostLogHint
  );
});

test("switching targets never auto-picks the other when one is down", () => {
  assert.equal(ConnectTarget.nextTargetWhenUnreachable("app"), "app");
  assert.equal(ConnectTarget.nextTargetWhenUnreachable("dev"), "dev");
  assert.equal(ConnectTarget.nextTargetWhenUnreachable(undefined), "app");
});

test("unreachable copy and Retry are per target", () => {
  assert.equal(
    ConnectTarget.unreachableMessage("app"),
    "Transcriber app isn't running."
  );
  assert.equal(
    ConnectTarget.unreachableMessage("dev"),
    "Can't reach your dev server. Start it, then try again."
  );
  assert.equal(ConnectTarget.shouldShowRetry("app"), false);
  assert.equal(ConnectTarget.shouldShowRetry("dev"), true);
  assert.equal(ConnectTarget.shouldReuseStartTranscriber("app"), true);
  assert.equal(ConnectTarget.shouldReuseStartTranscriber("dev"), false);
  assert.equal(ConnectTarget.RETRY_LABEL, "Retry");
  assert.equal(ConnectTarget.CONNECT_TO_LABEL, "Library");
  assert.equal(
    ConnectTarget.CONNECT_HELPER,
    "Two separate libraries. Transcribe saves to the one selected."
  );
});

test("user-facing copy is not Local server and Design strings are assigned via textContent", () => {
  const popupJs = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
  const popupHtml = fs.readFileSync(path.join(ROOT, "popup.html"), "utf8");
  const bg = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
  assert.doesNotMatch(popupJs, /Local server/);
  assert.doesNotMatch(popupHtml, /Local server/);
  assert.doesNotMatch(bg, /Local server/);
  assert.match(popupHtml, /connect-segmented/);
  assert.doesNotMatch(popupHtml, /<select/);
  assert.match(popupJs, /connectToLabel\.textContent/);
  assert.match(popupJs, /connectHelper\.textContent/);
  assert.match(popupJs, /connectError\.textContent/);
  assert.match(popupJs, /connectRetry\.textContent/);
  assert.match(popupJs, /connectTargetAppLabel\.textContent/);
  assert.match(popupJs, /connectTargetDevLabel\.textContent/);
  assert.match(popupJs, /STORAGE_KEY/);
  assert.match(popupJs, /CLEAR_LOCAL_TOKEN/);
  assert.match(bg, /clearLocalTokenMemory/);
  assert.match(bg, /ConnectTarget\.STORAGE_KEY/);
  assert.match(bg, /getTarget\(ConnectTarget\.APP\)\.pairUrl/);
  assert.doesNotMatch(popupJs, /auto-switch|autoSwitch|if \(devOnline\) setConnectTarget/);
});
