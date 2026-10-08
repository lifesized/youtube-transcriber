const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;

function read(name) {
  return fs.readFileSync(path.join(ROOT, name), "utf8");
}

function getRuntimeFiles() {
  const buildJs = read("build.js");
  const copyFilesMatch = buildJs.match(/const COPY_FILES = \[([\s\S]*?)\];/);
  if (!copyFilesMatch) throw new Error("COPY_FILES not found in build.js");
  const copyFilesStr = copyFilesMatch[1];
  const files = [];
  for (const match of copyFilesStr.matchAll(/"([^"]+)"/g)) {
    files.push(match[1]);
  }
  const manifest = JSON.parse(read("manifest.json"));
  const popupHtml = read("popup.html");
  for (const scriptMatch of popupHtml.matchAll(/<script[^>]*src="([^"]+)"/g)) {
    const scriptSrc = scriptMatch[1];
    if (!files.includes(scriptSrc)) files.push(scriptSrc);
  }
  return files;
}

test("LOCAL runtime never stores secrets or puts them in URLs", () => {
  const RUNTIME = getRuntimeFiles();
  const sources = RUNTIME.map((name) => read(name)).join("\n");
  assert.doesNotMatch(sources, /chrome\.storage\.(local|sync|session)/);
  assert.doesNotMatch(sources, /transcribed\.dev/);
  assert.doesNotMatch(sources, /\?yttx|LLM_HANDOFF|searchParams\.set\(/);
  assert.doesNotMatch(sources, /apiKey|api_key\s*[:=]/);
});

test("manifest is loopback-only and does not declare storage", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.deepEqual(manifest.permissions.sort(), [
    "activeTab",
    "nativeMessaging",
    "sidePanel",
    "tabs",
  ]);
  assert.deepEqual(manifest.host_permissions, [
    "http://127.0.0.1:19721/*",
    "http://127.0.0.1:19720/*",
    "https://www.linkedin.com/*",
  ]);
  assert.equal(manifest.optional_permissions, undefined);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /https:/);
  assert.match(
    manifest.content_security_policy.extension_pages,
    /http:\/\/127\.0\.0\.1:19720/
  );
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /localhost/);
  assert.equal(manifest.background.service_worker, "background.js");
});

test("store build copies the thin LOCAL files only", () => {
  const build = read("build.js");
  assert.match(build, /"send-url\.js"/);
  assert.doesNotMatch(build, /content-llm-handoff|destination-connected|content\.js|transcribed\.dev/);
  assert.doesNotMatch(read("background.js"), /CLOUD_BASE|mode === "cloud"|stashHandoffPrompt/);
  assert.doesNotMatch(read("popup.js"), /cloud|summarize|obsidian|notion|apiKey/i);
});
