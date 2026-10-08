import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  collectRequires,
  walkRequires,
} = require(path.join(repoRoot, "scripts/assert-packaged-requires.js"));

test("collectRequires finds relative and package requires", () => {
  const src = `
    const a = require("./server-manager.js");
    const b = require("../lib/local-api-token.js");
    const fs = require("fs");
    // require("./commented.js")
    const dyn = require("electron");
  `;
  assert.deepEqual(collectRequires(src), [
    "./server-manager.js",
    "../lib/local-api-token.js",
    "fs",
    "electron",
  ]);
});

test("walkRequires fails when lib/ is missing from the asar set", () => {
  const files = new Map([
    [
      "electron/main.js",
      `const ServerManager = require("./server-manager.js");\n`,
    ],
    [
      "electron/server-manager.js",
      `const { ensureInEnv } = require("../lib/local-api-token.js");\n`,
    ],
  ]);
  const asarFiles = new Set(files.keys());
  const result = walkRequires({
    entry: "electron/main.js",
    asarFiles,
    readFile: (hit) => files.get(hit.path),
  });
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].spec, "../lib/local-api-token.js");
  assert.equal(result.missing[0].from, "electron/server-manager.js");
});

test("walkRequires succeeds when lib is packaged next to electron/", () => {
  const files = new Map([
    ["electron/main.js", `require("./server-manager.js");\n`],
    [
      "electron/server-manager.js",
      `require("../lib/local-api-token.js");\nrequire("path");\n`,
    ],
    ["lib/local-api-token.js", `require("./local-api-auth.js");\n`],
    ["lib/local-api-auth.js", `require("crypto");\n`],
  ]);
  const asarFiles = new Set(files.keys());
  const result = walkRequires({
    entry: "electron/main.js",
    asarFiles,
    readFile: (hit) => files.get(hit.path),
  });
  assert.deepEqual(result.missing, []);
  assert.ok(result.seen.includes("lib/local-api-token.js"));
  assert.ok(result.seen.includes("lib/local-api-auth.js"));
});
