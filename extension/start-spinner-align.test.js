"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "popup.css"), "utf8");

function rule(selector) {
  const re = new RegExp(
    selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]+)\\}"
  );
  const m = css.match(re);
  assert.ok(m, `missing ${selector}`);
  return m[1];
}

test("Start Transcriber spinner sits on the right, centered without transform", () => {
  const button = rule(".btn-transcribe");
  assert.match(button, /position:\s*relative/);

  const spinner = rule(".btn-transcribe .start-spinner");
  assert.match(spinner, /position:\s*absolute/);
  assert.match(spinner, /right:\s*12px/);
  assert.match(spinner, /top:\s*50%/);
  assert.match(spinner, /margin-top:\s*-6px/);
  assert.doesNotMatch(spinner, /transform:/);
  assert.doesNotMatch(spinner, /vertical-align:/);
});
