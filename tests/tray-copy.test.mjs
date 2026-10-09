import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const copy = require(path.join(root, "electron", "tray-copy.js"));

test("running uses a sentence and Port {port}, or a fallback without sublabel", () => {
  assert.deepEqual(copy.runningStatus(19721, true), {
    label: "Transcriber is running",
    sublabel: "App library · Port 19721",
  });
  assert.deepEqual(copy.runningStatus(19721, false), {
    label: "Transcriber is running · App library · Port 19721",
  });
});

test("starting uses a real ellipsis and portInUse never embeds a raw exception", () => {
  assert.equal(copy.startingStatus().label, "Starting…");
  assert.ok(copy.startingStatus().label.includes("\u2026"));
  assert.deepEqual(copy.portInUseStatus(19721, null, true), {
    label: "Port 19721 is in use",
    sublabel: "Quit the app using it, then try again.",
  });
  assert.deepEqual(
    copy.portInUseStatus(19721, { process: "node", pid: "4242" }, true),
    {
      label: "Port 19721 is in use",
      sublabel: "Used by node (PID 4242). Quit it, then try again.",
    }
  );
  const stopped = copy.stoppedStatus().label;
  assert.equal(stopped, "Transcriber is stopped");
  assert.doesNotMatch(stopped, /Error:|exception|timeout/i);
});

test("tooltips and template image names follow spec §4.3", () => {
  assert.equal(copy.tooltipFor("running", 19721), "Transcriber — Running");
  assert.equal(copy.tooltipFor("starting", 19721), "Transcriber — Starting…");
  assert.equal(
    copy.tooltipFor("port-conflict", 19721),
    "Transcriber — Port 19721 is in use"
  );
  assert.equal(copy.tooltipFor("stopped", 19721), "Transcriber — Stopped");
  assert.equal(copy.trayImageName("running"), "trayTemplate.png");
  assert.equal(copy.trayImageName("starting"), "trayStartingTemplate.png");
  assert.equal(copy.trayImageName("port-conflict"), "trayAlertTemplate.png");
  assert.equal(copy.trayImageName("error"), "trayAlertTemplate.png");
  assert.equal(copy.trayImageName("stopped"), "trayAlertTemplate.png");
  assert.equal(copy.TRY_AGAIN, "Try Again");
  assert.equal(copy.RESTART, "Start Transcriber");
  assert.equal(copy.RUNNING_IN_MENU_BAR, "Transcriber is running in the menu bar");
});

test("Tusk tray line uses Design placeholders", () => {
  assert.equal(copy.tuskStatusLine("off"), "Tusk: off");
  assert.equal(copy.tuskStatusLine("error"), "Tusk: error");
  assert.equal(copy.tuskStatusLine("connected", "Personal"), "Tusk: connected to Personal");
  assert.equal(copy.tuskStatusLine("connected"), "Tusk: connected");
  assert.equal(copy.AI_KEY_MISSING, "AI key missing");
});

test("menu names the library it serves and offers its data folder under Advanced", () => {
  assert.equal(copy.servingLabel(19721), "App library · Port 19721");
  assert.equal(copy.OPEN_TRANSCRIBER, "Open Transcriber");
  assert.equal(copy.OPEN_LIBRARY, "Open Library");
  assert.equal(copy.ADVANCED, "Advanced");
  assert.equal(copy.SHOW_DATA_IN_FINDER, "Show Data in Finder");
  assert.equal(copy.OPEN_LIBRARY_FOLDER, undefined);
});
