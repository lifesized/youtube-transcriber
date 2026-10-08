import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaults = require(path.join(root, "electron", "product-defaults.js"));

test("friends-beta product defaults are one flip each", () => {
  assert.equal(defaults.AUTO_SAVE_AFTER_TRANSCRIBE, false);
  assert.equal(defaults.OBSIDIAN_WRITE_MARKDOWN_TO_VAULT, true);
  assert.equal(defaults.RESAVE_UPDATES_SAME_NOTE, true);
  assert.equal(defaults.PORT_CONFLICT_OFFER_QUIT, false);
  assert.equal(defaults.DARK_APP_ICON, true);
  assert.equal(defaults.IMPORT_LIBRARY_ONLY_WHEN_DETECTED, true);
});

test("tray manager and config read the flags instead of inlining the decisions", () => {
  const tray = fs.readFileSync(path.join(root, "electron", "tray-manager.js"), "utf8");
  const config = fs.readFileSync(path.join(root, "electron", "config.js"), "utf8");
  assert.match(tray, /product-defaults\.js/);
  assert.match(tray, /PORT_CONFLICT_OFFER_QUIT/);
  assert.match(tray, /IMPORT_LIBRARY_ONLY_WHEN_DETECTED/);
  assert.equal(config.includes("19721"), true);
});
