"use strict";

/**
 * Fail CI if any production extension sendMessage leaves lastError unread.
 * A missing content-script listener or a closed side panel is normal.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const SKIP = new Set([
  "send-message-checked.test.js",
]);

function productionJsFiles(dir) {
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".js") && !name.endsWith(".test.js") && !SKIP.has(name))
    .map((name) => path.join(dir, name));
}

function lineAt(src, index) {
  return src.slice(0, index).split("\n").length;
}

function sliceAround(src, index, beforeLines = 8, afterLines = 30) {
  let start = index;
  for (let i = 0; i < beforeLines; i++) {
    const prev = src.lastIndexOf("\n", start - 1);
    if (prev < 0) {
      start = 0;
      break;
    }
    start = prev;
  }
  let end = index;
  for (let i = 0; i < afterLines; i++) {
    const next = src.indexOf("\n", end + 1);
    if (next < 0) {
      end = src.length;
      break;
    }
    end = next;
  }
  return src.slice(start, end);
}

test("every chrome.runtime/tabs.sendMessage handles a missing receiver", () => {
  const sites = [];
  for (const file of productionJsFiles(ROOT)) {
    const src = fs.readFileSync(file, "utf8");
    const re = /chrome\.(runtime|tabs)\.sendMessage\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
      const rel = path.relative(ROOT, file);
      const line = lineAt(src, m.index);
      const window = sliceAround(src, m.index);
      const awaited = /await\s+chrome\.(runtime|tabs)\.sendMessage/.test(window);
      const promiseCatch = awaited && /catch\s*[\({]/.test(window);
      const callbackReadsLastError = /lastError/.test(window);
      const helperWraps = window.includes("sendRuntimeMessage(");
      sites.push({
        rel,
        line,
        ok: promiseCatch || callbackReadsLastError || helperWraps,
        snippet: window.trim().split("\n")[0],
      });
    }
  }

  assert.ok(sites.length >= 5, `expected several sendMessage sites, found ${sites.length}`);
  const unchecked = sites.filter((s) => !s.ok);
  assert.deepEqual(
    unchecked,
    [],
    unchecked.map((s) => `${s.rel}:${s.line} ${s.snippet}`).join("\n")
  );
});

test("caption fast-path inject/retry is debug, not info", () => {
  const src = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
  assert.match(src, /console\.debug\(\s*"\[ytt-bg\] caption fast-path: no listener/);
  assert.doesNotMatch(src, /console\.log\(\s*"\[ytt-bg\] caption fast-path: no listener/);
});
