import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { buildTrayMenuTemplate, transcriberUrl, libraryUrl } = require(
  path.join(root, "electron", "tray-menu.js")
);

const ACTIONS = new Proxy({}, { get: (_t, name) => () => name });

function menu(status, extra = {}) {
  return buildTrayMenuTemplate(
    { status, port: 19721, supportsSublabel: true, openAtLogin: true, showImport: false, ...extra },
    ACTIONS
  );
}

function labels(template) {
  return template.map((item) => (item.type === "separator" ? "---" : item.label));
}

function item(template, label) {
  const found = template.find((i) => i.label === label);
  assert.ok(found, `missing ${label}`);
  return found;
}

const BODY = [
  "---",
  "Open Transcriber",
  "Open Library",
  "---",
  "Connect Browser Extension…",
  "Paired Extensions…",
  "Reinstall Browser Connection",
  "---",
  "Advanced",
  "Start at Login",
  "Quit Transcriber",
];

test("running: status line with the library sublabel, then the exact order", () => {
  const t = menu("running");
  assert.deepEqual(labels(t), ["Transcriber is running", ...BODY]);
  assert.equal(t[0].sublabel, "App library · Port 19721");
  assert.equal(t[0].enabled, false);
});

test("stopped and error: Transcriber is stopped, same sublabel, then Start Transcriber", () => {
  for (const status of ["stopped", "error"]) {
    const t = menu(status);
    assert.deepEqual(labels(t), ["Transcriber is stopped", "Start Transcriber", ...BODY]);
    assert.equal(t[0].sublabel, "App library · Port 19721");
    assert.equal(t[0].enabled, false);
    assert.equal(t[1].click(), "start");
  }
});

test("without menu sublabels the library line folds into the status label", () => {
  const running = menu("running", { supportsSublabel: false });
  assert.equal(running[0].label, "Transcriber is running · App library · Port 19721");
  assert.equal(running[0].sublabel, undefined);
  const stopped = menu("stopped", { supportsSublabel: false });
  assert.equal(stopped[0].label, "Transcriber is stopped · App library · Port 19721");
  assert.equal(stopped[0].sublabel, undefined);
});

test("starting and port conflict keep their own status lines", () => {
  const starting = menu("starting");
  assert.deepEqual(labels(starting), ["Starting…", ...BODY]);
  assert.equal(starting[0].sublabel, undefined);
  const conflict = menu("port-conflict", { portHolder: { process: "node", pid: "4242" } });
  assert.deepEqual(labels(conflict), ["Port 19721 is in use", "Try Again", ...BODY]);
  assert.equal(conflict[0].sublabel, "Used by node (PID 4242). Quit it, then try again.");
  assert.equal(conflict[1].click(), "tryAgain");
});

test("wrong location offers Move to Applications and disables setup items", () => {
  const t = menu("wrong-location");
  assert.deepEqual(labels(t), [
    "Move Transcriber to Applications, then reopen it.",
    "Move to Applications and Reopen",
    ...BODY,
  ]);
  assert.equal(item(t, "Reinstall Browser Connection").enabled, false);
  assert.equal(item(t, "Start at Login").enabled, false);
});

test("Open Library and the server-backed items are enabled only while running", () => {
  const serverItems = [
    "Open Transcriber",
    "Open Library",
    "Connect Browser Extension…",
    "Paired Extensions…",
  ];
  for (const label of serverItems) assert.equal(item(menu("running"), label).enabled, true, label);
  for (const status of ["stopped", "error", "starting", "port-conflict"]) {
    const t = menu(status);
    for (const label of serverItems) assert.equal(item(t, label).enabled, false, `${status} ${label}`);
    assert.equal(item(t, "Reinstall Browser Connection").enabled, true, status);
    assert.equal(item(t, "Start at Login").enabled, true, status);
    assert.notEqual(item(t, "Quit Transcriber").enabled, false, status);
  }
});

test("Open Library opens the list URL; Open Transcriber opens / and stays", () => {
  const t = menu("running");
  assert.equal(item(t, "Open Library").click(), "openLibrary");
  assert.equal(item(t, "Open Transcriber").click(), "openTranscriber");
  assert.equal(libraryUrl(19721), "http://127.0.0.1:19721/?layout=list");
  assert.equal(transcriberUrl(19721), "http://127.0.0.1:19721");
  assert.notEqual(transcriberUrl(19721), libraryUrl(19721));
});

test("Advanced holds Show Data in Finder; Open Library Folder is gone", () => {
  const t = menu("running");
  const advanced = item(t, "Advanced");
  assert.deepEqual(advanced.submenu.map((i) => i.label), ["Show Data in Finder"]);
  assert.equal(advanced.submenu[0].click(), "showDataInFinder");
  assert.equal(advanced.submenu[0].enabled, undefined);
  assert.equal(labels(t).includes("Open Library Folder"), false);
  assert.equal(item(menu("stopped"), "Advanced").enabled, undefined);
});

test("no ellipsis on Open Library or Show Data in Finder", () => {
  const t = menu("running");
  assert.doesNotMatch(item(t, "Open Library").label, /…|\.\.\./);
  assert.doesNotMatch(item(t, "Advanced").submenu[0].label, /…|\.\.\./);
});

test("Import Existing Library… sits under Advanced, only when a checkout library is detected", () => {
  assert.equal(labels(menu("running", { showImport: true })).includes("Import Existing Library…"), false);
  const advanced = item(menu("running", { showImport: true }), "Advanced").submenu;
  assert.deepEqual(advanced.map((i) => i.label), ["Show Data in Finder", "Import Existing Library…"]);
  assert.equal(advanced[1].enabled, true);
  assert.equal(advanced[1].click(), "importLibrary");
  assert.equal(item(menu("stopped", { showImport: true }), "Advanced").submenu[1].enabled, false);
});

test("Start at Login mirrors the login item and Quit keeps ⌘Q", () => {
  assert.equal(item(menu("running", { openAtLogin: true }), "Start at Login").checked, true);
  assert.equal(item(menu("running", { openAtLogin: false }), "Start at Login").checked, false);
  assert.equal(item(menu("running"), "Start at Login").type, "checkbox");
  assert.equal(item(menu("running"), "Quit Transcriber").accelerator, "Command+Q");
});
