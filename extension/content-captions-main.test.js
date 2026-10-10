"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = fs.readFileSync(path.join(__dirname, "content-captions-main.js"), "utf8");

test("MAIN helper does not expose window.__yttCaptionMain", () => {
  assert.doesNotMatch(SRC, /__yttCaptionMain/);
  assert.match(SRC, /Object\.defineProperty\(\s*window,\s*INSTALL_MARK/);
  assert.match(SRC, /enumerable:\s*false/);
  assert.match(SRC, /Symbol\.for\(/);

  const window = {};
  const events = [];
  const sandbox = {
    window,
    document: { getElementById: () => null },
    Object,
    Symbol,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init && init.detail;
      }
    },
    fetch: async () => {
      throw new Error("unused");
    },
  };
  sandbox.window.addEventListener = () => {};
  sandbox.window.dispatchEvent = (event) => events.push(event);
  vm.runInNewContext(SRC, sandbox);
  assert.equal(window.__yttCaptionMain, undefined);
  assert.equal(Object.keys(window).includes("__yttCaptionMain"), false);
  const symbols = Object.getOwnPropertySymbols(window);
  assert.equal(symbols.length, 1);
  assert.equal(Object.getOwnPropertyDescriptor(window, symbols[0]).enumerable, false);
});

test("MAIN timedtext fetch refuses a body over about 5 MB", () => {
  assert.match(SRC, /MAX_TIMEDTEXT_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/);
  assert.match(SRC, /error:\s*"oversized"/);
});
