"use strict";

/**
 * LOCAL build: when 19721 and 19720 are both unreachable, the popup / side
 * panel must show the friendly offline state and never the hosted cloud
 * Sign-in UI (Google / magic link / transcribed.dev).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const ROOT = __dirname;
const Lock = require("./local-mode-lock.js");
const ConnectTarget = require("./connect-target.js");

const popupHtml = fs.readFileSync(path.join(ROOT, "popup.html"), "utf8");
const popupJs = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
const backgroundJs = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "build.js"), "utf8");

const LEFTOVER_CLOUD_SIGNIN = `
  <div id="offlineCloudMsg">
    <div id="cloudOnboarding">
      <p>Sign in to Transcriber</p>
      <p>transcribed.dev</p>
    </div>
    <div id="cloudAuthCard">
      <button id="cloudAuthGoogle">Continue with Google</button>
      <form id="cloudAuthForm">
        <input id="cloudAuthEmail" type="email" />
        <button id="cloudAuthSubmit" type="submit">Send magic link</button>
      </form>
    </div>
    <div id="cloudAuthError">Session expired</div>
    <div id="cloudAuthSent">Check your email</div>
    <a id="cloudLink" href="https://transcribed.dev">transcribed.dev</a>
  </div>
`;

function nodeFromMatch(html, id) {
  const re = new RegExp(
    `<([a-zA-Z0-9]+)([^>]*\\sid="${id}"[^>]*)>([\\s\\S]*?)</\\1>`,
    "i"
  );
  const selfClose = new RegExp(
    `<([a-zA-Z0-9]+)([^>]*\\sid="${id}"[^>]*)/?>`,
    "i"
  );
  const m = html.match(re) || html.match(selfClose);
  const attrs = m ? m[2] : "";
  return {
    id,
    hidden: /\bhidden\b/.test(attrs),
    textContent: "",
    querySelector() {
      return null;
    },
  };
}

function makeDoc(html) {
  const ids = new Map();
  for (const m of html.matchAll(/id="([^"]+)"/g)) {
    if (!ids.has(m[1])) ids.set(m[1], nodeFromMatch(html, m[1]));
  }
  return {
    getElementById(id) {
      return ids.get(id) || null;
    },
    _ids: ids,
  };
}

function bothPortsUnreachable(results) {
  return results["19721"] === false && results["19720"] === false;
}

async function probePort(port) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/health",
        timeout: 400,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

test("LOCAL lock ignores leftover cloud mode from storage or CHECK_SERVICE", () => {
  assert.equal(Lock.isLocalBuild(), true);
  assert.equal(Lock.resolveMode("cloud", "cloud"), "local");
  assert.equal(Lock.resolveMode(undefined, "cloud"), "local");
  assert.equal(Lock.resolveMode("local", undefined), "local");
  assert.equal(Lock.shouldShowCloudAuth("cloud"), false);
  assert.equal(Lock.shouldShowCloudAuth(), false);
});

test("LOCAL lock never treats transcribed.dev as a safe navigation", () => {
  assert.equal(Lock.isCloudHostedUrl("https://transcribed.dev/auth/login"), true);
  assert.equal(Lock.isCloudHostedUrl("https://app.transcribed.dev/"), true);
  assert.equal(Lock.isCloudHostedUrl("http://127.0.0.1:19721/"), false);
  assert.equal(Lock.isCloudHostedUrl("http://127.0.0.1:19720/"), false);
  assert.equal(Lock.isCloudHostedUrl("obsidian://new?name=x"), false);
});

test("popup and panel HTML have no cloud sign-in DOM", () => {
  assert.match(popupHtml, /id="stateNoService"/);
  assert.match(popupHtml, /id="offlineLocalMsg"/);
  assert.match(popupHtml, /Transcriber isn't running/);
  assert.doesNotMatch(popupHtml, /id="cloudAuthCard"/);
  assert.doesNotMatch(popupHtml, /id="cloudAuthGoogle"/);
  assert.doesNotMatch(popupHtml, /id="cloudAuthForm"/);
  assert.doesNotMatch(popupHtml, /cloudOnboarding/);
  assert.doesNotMatch(popupHtml, /Continue with Google/);
  assert.doesNotMatch(popupHtml, /magic link/i);
  assert.doesNotMatch(popupHtml, /transcribed\.dev/);
  assert.match(popupHtml, /local-mode-lock\.js/);
});

test("both ports down: leftover sign-in is hidden and offline state is shown", async () => {
  const appReachable = await probePort(19721);
  const devReachable = await probePort(19720);
  const ports = { 19721: appReachable, 19720: devReachable };

  // The assertion is about the paint, not requiring this machine to have
  // both servers down. Still record the live probe so a green local server
  // cannot silently change the gate.
  if (!bothPortsUnreachable(ports)) {
    assert.equal(
      ConnectTarget.nextTargetWhenUnreachable("app"),
      "app",
      "must not auto-switch to 19720 when 19721 is the target"
    );
    assert.equal(ConnectTarget.nextTargetWhenUnreachable("dev"), "dev");
  } else {
    assert.equal(ports["19721"], false);
    assert.equal(ports["19720"], false);
  }

  const html = popupHtml.replace("</body>", `${LEFTOVER_CLOUD_SIGNIN}</body>`);
  const doc = makeDoc(html);

  // Simulate the dual-mode leftover: CHECK_SERVICE says mode:cloud because
  // chrome.storage.sync.mode was cloud and 19720/19721 both failed.
  const serviceRes = { success: true, data: { online: false, mode: "cloud" } };
  const mode = Lock.resolveMode("cloud", serviceRes.data.mode);
  assert.equal(mode, "local");
  assert.equal(Lock.shouldShowCloudAuth(serviceRes.data.mode), false);

  const painted = Lock.paintLocalOffline(doc, {
    targetId: "app",
    nativeHostAvailable: false,
    nativeHostState: "missing",
  });

  assert.equal(painted.state, "offline-app-missing");
  assert.equal(painted.heading, "Transcriber isn't running");
  assert.equal(doc.getElementById("stateNoService").hidden, false);
  assert.equal(doc.getElementById("offlineLocalMsg").hidden, false);
  assert.equal(doc.getElementById("offlineHeading").textContent, "Transcriber isn't running");
  assert.equal(
    doc.getElementById("offlineSub").textContent,
    "Open Transcriber from your Applications folder."
  );

  for (const id of [
    "cloudAuthCard",
    "cloudAuthGoogle",
    "cloudAuthForm",
    "cloudOnboarding",
    "offlineCloudMsg",
    "cloudAuthError",
    "cloudAuthSent",
    "cloudLink",
  ]) {
    const node = doc.getElementById(id);
    assert.ok(node, `leftover ${id} should exist in the injected document`);
    assert.equal(node.hidden, true, `${id} must be hidden in LOCAL offline`);
  }

  const pairing = Lock.paintLocalOffline(makeDoc(html), {
    targetId: "app",
    nativeHostAvailable: false,
    nativeHostState: "pairing",
  });
  assert.equal(pairing.state, "offline-pairing");
  assert.equal(pairing.heading, "Allow Transcriber to connect");
});

test("unauthorized also stays on the local reconnect screen, not sign-in", () => {
  const html = popupHtml.replace("</body>", `${LEFTOVER_CLOUD_SIGNIN}</body>`);
  const doc = makeDoc(html);
  const painted = Lock.paintLocalOffline(doc, { authError: true, targetId: "app" });
  assert.equal(painted.state, "offline-auth");
  assert.equal(doc.getElementById("stateNoService").hidden, false);
  assert.equal(doc.getElementById("cloudAuthCard").hidden, true);
  assert.equal(doc.getElementById("cloudAuthGoogle").hidden, true);
});

test("init offline branch no longer takes a cloud sign-in path", () => {
  const start = popupJs.indexOf("if (!online) {");
  const end = popupJs.indexOf("stopOfflinePolling();", start);
  assert.ok(start > 0 && end > start, "offline branch markers");
  const branch = popupJs.slice(start, end);
  assert.doesNotMatch(branch, /cfgMode === ["']cloud["']/);
  assert.doesNotMatch(branch, /el\.offlineLocalMsg\.hidden = true/);
  assert.doesNotMatch(branch, /el\.cloudAuthCard\) el\.cloudAuthCard\.hidden = false/);
  assert.doesNotMatch(branch, /el\.cloudOnboarding\) el\.cloudOnboarding\.hidden = false/);
  assert.match(branch, /hideCloudSignIn/);
  assert.match(branch, /el\.offlineLocalMsg\.hidden = false/);
});

test("GET_SETTINGS and CHECK_SERVICE stay locked to local", () => {
  assert.match(
    backgroundJs,
    /case "GET_SETTINGS": \{[\s\S]*?return \{ mode: LocalModeLock\.resolveMode\(\) \}/
  );
  assert.match(backgroundJs, /mode: LocalModeLock\.resolveMode\(\)/);
  assert.doesNotMatch(backgroundJs, /case "OPEN_GOOGLE_SIGNIN":/);
  assert.doesNotMatch(backgroundJs, /case "SEND_MAGIC_LINK":/);
  assert.doesNotMatch(
    backgroundJs,
    /return \{ mode: mode \|\| "local" \}/
  );
});

test("dead cloud sign-in code is gone from popup and background", () => {
  assert.doesNotMatch(popupJs, /async function sendMagicLink/);
  assert.doesNotMatch(popupJs, /el\.cloudAuthForm/);
  assert.doesNotMatch(popupJs, /el\.cloudAuthGoogle/);
  assert.doesNotMatch(popupJs, /OPEN_GOOGLE_SIGNIN/);
  assert.doesNotMatch(popupJs, /SEND_MAGIC_LINK/);
  assert.doesNotMatch(popupJs, /if \(mode === ["']cloud["']\) setCachedAuth/);
});

test("LOCAL manifest short_name is Transcriber; dev tag is Transcriber (dev)", () => {
  const localManifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "manifests", "local.json"), "utf8")
  );
  assert.equal(localManifest.short_name, "Transcriber");
  assert.match(buildJs, /short_name = "Transcriber \(dev\)"/);
  assert.doesNotMatch(buildJs, /short_name = "Transcriber dev"/);
});

test("stored mode cloud and both ports down still shows the offline UI", async () => {
  const stored = { mode: "cloud" };
  const appReachable = await probePort(19721);
  const devReachable = await probePort(19720);
  const ports = { 19721: appReachable, 19720: devReachable };

  if (!bothPortsUnreachable(ports)) {
    assert.equal(ConnectTarget.nextTargetWhenUnreachable("app"), "app");
    assert.equal(ConnectTarget.nextTargetWhenUnreachable("dev"), "dev");
  } else {
    assert.equal(ports["19721"], false);
    assert.equal(ports["19720"], false);
  }

  const mode = Lock.resolveMode(stored.mode, "cloud");
  assert.equal(mode, "local");
  assert.equal(Lock.shouldShowCloudAuth(stored.mode), false);

  const doc = makeDoc(popupHtml);
  const painted = Lock.paintLocalOffline(doc, {
    targetId: "app",
    nativeHostAvailable: false,
    nativeHostState: "missing",
  });

  const heading = painted.heading;
  assert.ok(
    heading === "Transcriber isn't running" || heading === "Dev server setup",
    `unexpected heading: ${heading}`
  );
  assert.equal(doc.getElementById("stateNoService").hidden, false);
  assert.equal(doc.getElementById("offlineLocalMsg").hidden, false);

  const visible = [];
  for (const [id, node] of doc._ids) {
    if (!node.hidden) visible.push(`${id} ${node.textContent || ""}`);
  }
  visible.push(painted.heading);
  const blob = `${popupHtml}\n${visible.join("\n")}`;
  assert.doesNotMatch(blob, /Google|magic link|transcribed\.dev|Sign in/i);
});

test("popup defaults never fall back to cloud when GET_SETTINGS fails", () => {
  assert.doesNotMatch(popupJs, /\|\| "cloud"/);
  assert.match(popupJs, /currentSettingsMode = "local"/);
  assert.match(popupJs, /blocked transcribed\.dev navigation/);
  assert.match(buildJs, /"local-mode-lock\.js"/);
});
