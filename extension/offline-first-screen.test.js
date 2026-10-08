"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const popup = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "popup.html"), "utf8");

function offlineBranch() {
  const start = popup.indexOf("} else {");
  const marker = popup.indexOf('el.offlineLocalMsg.hidden = false');
  const end = popup.indexOf("showState(\"NoService\")", marker);
  assert.ok(marker > start && end > marker, "offline branch markers");
  return popup.slice(marker, end + 40);
}

test("offline init never auto-routes to Settings or the npm box for the app target", () => {
  const branch = offlineBranch();
  assert.doesNotMatch(branch, /showSettingsView\s*\(/);
  assert.doesNotMatch(branch, /feels more embedded/);
  assert.match(popup, /target\.id === ["']dev["']/);
  assert.match(popup, /Dev server setup/);
  assert.match(popup, /refreshOfflineStartUI/);
  assert.match(popup, /nativeHostState/);
});

test("offline screens use Design's exact strings", () => {
  assert.match(popup, /Transcriber isn't running/);
  assert.match(popup, /Start it to transcribe this video\./);
  assert.match(popup, /Open Transcriber from your Applications folder\./);
  assert.match(popup, /Allow Transcriber to connect/);
  assert.match(popup, /Click Allow in the Transcriber dialog on your Mac\./);
  assert.match(popup, /Reconnect to Transcriber/);
  assert.match(popup, /Quit and reopen Transcriber, then click Check Again\./);
  assert.match(html, /Check Again/);
  assert.match(html, /id="offlineConnectHint"/);
  assert.match(html, /Connected to:/);
  assert.match(html, /id="btnOfflineChangeTarget"/);
});

test("Settings server copy stays human and keeps npm only for Dev server", () => {
  assert.match(
    popup,
    /Transcriber can't talk to this browser yet\. In the Transcriber menu, choose Reinstall Browser Connection\./
  );
  assert.match(popup, /serverOnline \? "Running" : "Stopped"/);
});

test("friends build hides the footer GitHub link and pairing does not fall through to setup", () => {
  assert.match(popup, /githubLink\.hidden = true/);
  assert.match(html, /id="githubLink"[^>]*hidden/);
  assert.match(popup, /nativeHostState = "pairing"/);
  assert.doesNotMatch(popup, /setTimeout\(\s*\(\)\s*=>\s*\{[^}]*refreshOfflineStartUI/, "no 2.5s fallthrough timer");
});

test("offline init never paints cloud sign-in when the local target is down", () => {
  assert.match(popup, /hideCloudSignIn/);
  assert.match(popup, /LocalModeLock/);
  assert.doesNotMatch(popup, /cfgMode === ["']cloud["']/);
  assert.doesNotMatch(html, /transcribed\.dev/);
  assert.doesNotMatch(html, /id="cloudAuthCard"/);
});
