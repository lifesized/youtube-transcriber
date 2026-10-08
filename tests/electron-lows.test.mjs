import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("getSecretsFromMainOrEnv uses env only outside Electron", async () => {
  const ipc = require(path.join(repoRoot, "lib/electron-ipc.js"));
  const prevElectron = process.env.ELECTRON_RUN_AS_NODE;
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevProvider = process.env.LLM_PROVIDER;
  try {
    delete process.env.ELECTRON_RUN_AS_NODE;
    process.env.LLM_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
    const fromEnv = await ipc.getSecretsFromMainOrEnv();
    assert.equal(fromEnv.llmApiKey, "sk-ant-from-env");

    process.env.ELECTRON_RUN_AS_NODE = "1";
    await assert.rejects(
      () => ipc.getSecretsFromMainOrEnv(),
      (err) => err && err.code === "ELECTRON_IPC_UNAVAILABLE"
    );
  } finally {
    if (prevElectron === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = prevElectron;
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    if (prevProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = prevProvider;
  }
});

test("server spawn does not inject secretEnv", () => {
  const src = readFileSync(path.join(repoRoot, "electron/server-manager.js"), "utf8");
  assert.equal(src.includes("secretEnv"), false);
  const main = readFileSync(path.join(repoRoot, "electron/main.js"), "utf8");
  assert.equal(main.includes("secretEnv"), false);
  assert.equal(main.includes("envForSpawn"), false);
  const store = readFileSync(path.join(repoRoot, "electron/secrets-store.js"), "utf8");
  assert.equal(store.includes("envForSpawn"), false);
  assert.equal(store.includes("this.onChange"), false);
});

test("writeTokenFile uses atomic replace", () => {
  const src = readFileSync(path.join(repoRoot, "lib/local-api-token.js"), "utf8");
  assert.ok(src.includes("writeFileAtomic"));
  assert.equal(src.includes("writeFileSync(filePath, token"), false);
});

test("writeFileAtomic opens the temp file with wx", () => {
  const src = readFileSync(path.join(repoRoot, "lib/write-file-atomic.js"), "utf8");
  assert.match(src, /flag:\s*["']wx["']/);
  const { writeFileAtomic } = require(path.join(repoRoot, "electron/utils.js"));
  const dir = mkdtempSync(path.join(tmpdir(), "ytt-atomic-"));
  const target = path.join(dir, "file.json");
  try {
    writeFileAtomic(target, '{"ok":true}\n', 0o600);
    assert.equal(readFileSync(target, "utf8"), '{"ok":true}\n');
    if (process.platform !== "win32") {
      assert.equal(statSync(target).mode & 0o777, 0o600);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shSingleQuote escapes single quotes in wrapper paths", () => {
  const { shSingleQuote } = require(
    path.join(repoRoot, "electron/native-host-installer.js")
  );
  assert.equal(shSingleQuote("/Applications/Transcriber.app"), "'/Applications/Transcriber.app'");
  assert.equal(shSingleQuote("/tmp/it's.app"), `'/tmp/it'\\''s.app'`);
});

test("append refuses corrupt extension-ids.json instead of treating it as []", () => {
  const NativeHostInstaller = require(
    path.join(repoRoot, "electron/native-host-installer.js")
  );
  const dir = mkdtempSync(path.join(tmpdir(), "ytt-corrupt-"));
  const idsPath = path.join(dir, "extension-ids.json");
  writeFileSync(idsPath, "{not-json");
  try {
    const installer = new NativeHostInstaller({ idsPath, browsers: [] });
    assert.equal(installer.idsFileCorrupt, true);
    assert.throws(
      () => installer.appendExtensionId("abcdefghijklmnopabcdefghijklmnop"),
      /corrupt/
    );
    assert.equal(readFileSync(idsPath, "utf8"), "{not-json");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("electron isMasked is exact equality with the GET placeholder", () => {
  const { maskKey, isMasked } = require(path.join(repoRoot, "electron/secrets-store.js"));
  const plain = "sk-ant-abcdefghijklmnopqrstuvwxyz";
  const masked = maskKey(plain);
  assert.equal(isMasked(masked, masked), true);
  assert.equal(isMasked(plain, masked), false);
  assert.equal(isMasked("sk-ant-***secret***", masked), false);
  assert.equal(isMasked("••••", masked), false);
});

test("powerSaveBlocker.isStarted is never called with a null id", () => {
  const src = readFileSync(path.join(repoRoot, "electron/main.js"), "utf8");
  assert.equal(
    (src.match(/powerSaveBlocker\.isStarted\(/g) || []).length,
    2
  );
  assert.equal(
    (src.match(/powerSaveId !== null && powerSaveBlocker\.isStarted\(powerSaveId\)/g) || []).length,
    2
  );
});

test("afterPack flips fuses and keeps RunAsNode", () => {
  const src = readFileSync(path.join(repoRoot, "electron/after-pack.js"), "utf8");
  assert.ok(src.includes("@electron/fuses"));
  assert.ok(src.includes("EnableNodeOptionsEnvironmentVariable"));
  assert.ok(src.includes("EnableNodeCliInspectArguments"));
  assert.ok(src.includes("[FuseV1Options.RunAsNode]: true"));
});

test("workflow has least-privilege permissions and prints the DMG sha256", () => {
  const src = readFileSync(
    path.join(repoRoot, ".github/workflows/electron-build-macos.yml"),
    "utf8"
  );
  assert.match(src, /permissions:\s*\n\s+contents: read/);
  assert.ok(src.includes("GITHUB_STEP_SUMMARY"));
  assert.ok(src.includes("shasum -a 256"));
});
