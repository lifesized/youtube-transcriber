import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { buildTrayMenuTemplate } = require(path.join(root, "electron/tray-menu.js"));
const copy = require(path.join(root, "electron/tray-copy.js"));
const helpers = require(path.join(root, "electron/helpers.js"));

const ACTIONS = new Proxy({}, { get: (_t, name) => () => name });

function labels(template) {
  return template.map((item) => (item.type === "separator" ? "---" : item.label));
}

test("helper status line uses the manifest displayName", () => {
  assert.equal(copy.helperStatusLine("Notes", "running"), "Notes: running");
  assert.equal(copy.helperStatusLine("Notes\nBad", "nope"), "Notes Bad: stopped");
});

test("tray lists no helper rows when none are installed", () => {
  const empty = buildTrayMenuTemplate(
    {
      status: "running",
      port: 19721,
      supportsSublabel: true,
      openAtLogin: true,
      showImport: false,
      updater: { enabled: false },
      helpers: [],
    },
    ACTIONS
  );
  const withHelper = buildTrayMenuTemplate(
    {
      status: "running",
      port: 19721,
      supportsSublabel: true,
      openAtLogin: true,
      showImport: false,
      updater: { enabled: false },
      helpers: [{ id: "notes", displayName: "Notes", state: "running" }],
    },
    ACTIONS
  );
  assert.equal(labels(empty).some((label) => /: running|: stopped|: error|: starting/.test(label) && label.includes("Notes")), false);
  assert.equal(labels(withHelper).includes("Notes: running"), true);
  assert.equal(labels(empty).includes("Notes: running"), false);
});

test("Settings Helpers section is omitted unless helpers are installed", () => {
  const panel = readFileSync(path.join(root, "components/settings-panel.tsx"), "utf8");
  assert.match(panel, /installedHelpers\.length > 0/);
  assert.match(panel, />Helpers</);
  assert.match(panel, /\/api\/settings\/helpers/);
  assert.match(panel, /"Enable"/);
  assert.match(panel, /action: "enable"/);
  const idx = panel.indexOf("/api/settings/helpers");
  const chunk = panel.slice(idx - 80, idx + 220);
  assert.doesNotMatch(chunk, /Authorization/);
});

test("discoverHelpers is empty when the helpers directory is missing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "helpers-none-"));
  try {
    assert.deepEqual(helpers.discoverHelpers({ helpersDir: path.join(dir, "missing"), isPackaged: false }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
