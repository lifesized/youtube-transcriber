import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NativeHostInstaller = require(path.join(repoRoot, "electron/native-host-installer.js"));
const { unpairExtension } = require(path.join(repoRoot, "electron/tray-manager.js"));

const ID_A = "abcdefghijklmnopabcdefghijklmnop";
const ID_B = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("removeExtensionId drops the id and rewrites extension-ids.json", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ytt-ids-"));
  const idsPath = path.join(dir, "extension-ids.json");
  writeFileSync(idsPath, JSON.stringify([ID_A, ID_B], null, 2) + "\n");
  try {
    const installer = new NativeHostInstaller({ idsPath, browsers: [] });
    assert.deepEqual(installer.listExtensionIds(), [ID_A, ID_B]);
    const left = installer.removeExtensionId(ID_A);
    assert.deepEqual(left, [ID_B]);
    assert.deepEqual(JSON.parse(readFileSync(idsPath, "utf8")), [ID_B]);
    installer.removeExtensionId(ID_B);
    assert.deepEqual(JSON.parse(readFileSync(idsPath, "utf8")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unpair rewrites manifests, rotates the token, and restarts the server", async () => {
  const calls = [];
  await unpairExtension(ID_A, {
    installer: {
      removeExtensionId(id) {
        calls.push(["remove", id]);
      },
      async rewriteManifests() {
        calls.push(["rewrite"]);
      },
    },
    serverManager: {
      async restart() {
        calls.push(["restart"]);
      },
    },
    rotate() {
      calls.push(["rotate"]);
    },
  });
  assert.deepEqual(calls, [
    ["remove", ID_A],
    ["rewrite"],
    ["rotate"],
    ["restart"],
  ]);
});
