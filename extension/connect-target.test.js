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

test("header indicator reads App · 19721 / Dev · 19720 with a Settings tooltip", () => {
  assert.equal(ConnectTarget.indicatorText("app"), "App · 19721");
  assert.equal(ConnectTarget.indicatorText("dev"), "Dev · 19720");
  assert.equal(
    ConnectTarget.indicatorTitle("app", "running"),
    "Library: Transcriber app · 19721, Running. Click to change in Settings."
  );
  assert.equal(
    ConnectTarget.indicatorTitle("dev", "needs_permission"),
    "Library: Dev server · 19720, Needs permission. Click to change in Settings."
  );
});

test("panel header is a read-only indicator that opens Settings › Library", () => {
  const popupJs = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
  const popupHtml = fs.readFileSync(path.join(ROOT, "popup.html"), "utf8");
  const header = popupHtml.match(/<div class="panel-header">[\s\S]*?<\/div>/)[0];
  assert.doesNotMatch(header, /aria-haspopup|chevron|role="menu"/);
  assert.doesNotMatch(popupHtml, /targetPickerMenu/);
  assert.doesNotMatch(popupJs, /menuitemradio|renderTargetMenu/);
  assert.match(popupJs, /targetPickerName\.textContent = T\.indicatorText\(/);
  assert.match(popupJs, /T\.indicatorTitle\(/);
  assert.match(
    popupJs,
    /targetPickerTrigger\.addEventListener\("click", openLibrarySettings\)/
  );
});

test("Settings › Library rows are radios and only the selected row gets the action", () => {
  const popupJs = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
  const popupHtml = fs.readFileSync(path.join(ROOT, "popup.html"), "utf8");
  const labels = popupHtml.match(/<label class="connect-segment-line">[\s\S]*?<\/label>/g);
  assert.equal(labels.length, 2);
  for (const label of labels) {
    assert.match(label, /type="radio"/);
    assert.match(label, /class="connect-ring"/);
    assert.doesNotMatch(label, /<button/, "no button inside a radio's label");
  }
  assert.match(popupJs, /T\.rowView\(/);
  assert.match(popupJs, /row\.appendChild\(el\.connectAction\)/);
  assert.match(popupJs, /connectError\.dataset\.tone = view\.tone/);
  assert.doesNotMatch(popupHtml, /id="connectError"[^>]*error-message|error-message[^>]*id="connectError"/);
  assert.match(popupJs, /requestNativeHostPair\(\)/);
  assert.match(
    popupJs,
    /mode !== "local" \|\| !connectTargetApi\(\)\?\.FEATURES\.stop/,
    "Settings has one Start: the Server section stays hidden while Stop is off"
  );
  assert.doesNotMatch(popupJs, /"Run: npm run install-native-host/);
});

test("dev setup command carries the extension ID", () => {
  assert.equal(
    ConnectTarget.devSetupCommand("abc"),
    "npm run install-native-host -- --ext-id=abc"
  );
});

const EXT = "kjbmhgfdlpoiacenbhgfmnmbcalkdefg";
const row = (id, status, reason = null, opts = {}) =>
  ConnectTarget.rowView(id, { status, reason }, { extId: EXT, ...opts });

test("Settings row: Running, Checking and Starting", () => {
  assert.deepEqual(row("app", "running"), { action: null, message: null, tone: null });
  assert.deepEqual(row("dev", "unknown"), { action: null, message: null, tone: null });
  assert.deepEqual(ConnectTarget.rowView("app", undefined), {
    action: null,
    message: null,
    tone: null,
  });
  assert.deepEqual(row("app", "starting").action, {
    kind: "start",
    label: "Starting…",
    busy: true,
  });
});

test("Settings row: Stopped shows Start for app and Retry for dev, muted", () => {
  assert.deepEqual(row("app", "stopped", "unreachable"), {
    action: { kind: "start", label: "Start" },
    message: "Transcriber app isn't running.",
    tone: "muted",
  });
  assert.deepEqual(row("dev", "stopped", "unreachable"), {
    action: { kind: "retry", label: "Retry" },
    message: "Can't reach your dev server. Start it, then try again.",
    tone: "muted",
  });
});

test("Settings row: a failed Start is the only red line", () => {
  const v = row("app", "stopped", "unreachable", { startFailure: "start_timeout" });
  assert.equal(v.tone, "error");
  assert.equal(v.message, "Transcriber didn't start. Open it from your Applications folder.");
  assert.equal(v.action.kind, "start");
  for (const [id, status, reason] of [
    ["app", "needs_permission", "extension_not_allowed"],
    ["app", "needs_permission", "unauthorized"],
    ["dev", "needs_permission", "unauthorized"],
    ["dev", "needs_permission", "host_forbidden"],
    ["app", "helper_outdated", "unknown_cmd"],
    ["dev", "helper_outdated", "unknown_cmd"],
    ["dev", "stopped", "bad_project_root"],
  ]) {
    assert.notEqual(row(id, status, reason).tone, "error", `${id} ${status} ${reason}`);
  }
});

test("Settings row: Needs permission, app offers Allow access for pairable reasons", () => {
  for (const reason of ["extension_not_allowed", "unauthorized_caller", "host_forbidden"]) {
    assert.deepEqual(row("app", "needs_permission", reason), {
      action: { kind: "allowAccess", label: "Allow access" },
      message:
        "Transcriber needs your permission to connect. Click Allow in the Transcriber dialog on your Mac.",
      tone: "warn",
    });
  }
  const key = row("app", "needs_permission", "unauthorized");
  assert.equal(key.action, null);
  assert.equal(
    key.message,
    "Transcriber didn't accept this browser's access key. Quit and reopen Transcriber, then try again."
  );
});

test("Settings row: Needs permission, dev shows the setup command", () => {
  assert.deepEqual(row("dev", "needs_permission", "extension_not_allowed"), {
    action: { kind: "command", command: `npm run install-native-host -- --ext-id=${EXT}` },
    message:
      "This extension isn't paired with the dev server. Run the setup command in your Transcriber folder, then try again.",
    tone: "warn",
  });
});

test("Settings row: a dev 401 asks to update the helper, never to open the dev server", () => {
  assert.deepEqual(row("dev", "needs_permission", "unauthorized"), {
    action: {
      kind: "command",
      heading: "Update helper",
      command: `npm run install-native-host -- --ext-id=${EXT}`,
    },
    message:
      "The dev server's browser helper needs an update. Copy the setup command from Settings › Library, run it in your Transcriber folder, then try again.",
    tone: "warn",
  });
  assert.doesNotMatch(ConnectTarget.errorMessage("unauthorized", "dev"), /127\.0\.0\.1|once in this browser/);
  assert.equal(ConnectTarget.STRINGS.action.openDevServer, undefined);
});

test("Settings row: Helper out of date names the tray item (app) or the command (dev)", () => {
  assert.deepEqual(row("app", "helper_outdated", "unknown_cmd"), {
    action: {
      kind: "note",
      heading: "Update helper",
      text: "In the Transcriber menu, choose Reinstall Browser Connection.",
    },
    message: null,
    tone: null,
  });
  assert.deepEqual(row("dev", "helper_outdated", "unknown_cmd"), {
    action: {
      kind: "command",
      heading: "Update helper",
      command: `npm run install-native-host -- --ext-id=${EXT}`,
    },
    message: null,
    tone: null,
  });
});

test("Settings row: dev bad_project_root copies the --project-root command", () => {
  const v = row("dev", "stopped", "bad_project_root");
  assert.deepEqual(v.action, {
    kind: "command",
    command: "npm run install-native-host -- --project-root <path-to-your-Transcriber-folder>",
  });
  assert.match(v.message, /isn't linked to your Transcriber folder/);
  assert.equal(v.tone, "warn");
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
