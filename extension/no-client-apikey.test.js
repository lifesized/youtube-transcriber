const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;

function read(name) {
  return fs.readFileSync(path.join(ROOT, name), "utf8");
}

function getRuntimeFiles() {
  const files = ["manifest.json", "popup.html"];
  const manifest = JSON.parse(read("manifest.json"));
  if (manifest.background?.service_worker) {
    files.push(manifest.background.service_worker);
  }
  const popupHtml = read("popup.html");
  for (const scriptMatch of popupHtml.matchAll(/<script[^>]*src="([^"]+)"/g)) {
    const scriptSrc = scriptMatch[1];
    if (!files.includes(scriptSrc)) files.push(scriptSrc);
  }
  // Filter out non-text files (PNGs, etc.) that shouldn't be scanned as UTF-8
  return files.filter((f) => !f.match(/\.(png|jpg|jpeg|gif|ico|woff|woff2|ttf)$/i));
}

const RUNTIME = getRuntimeFiles();

test("YTT-445: extension never accepts provider API keys", () => {
  // No input fields for API keys
  const html = read("popup.html");
  assert.doesNotMatch(html, /<input/i);
  assert.doesNotMatch(html, /<textarea/i);
  assert.doesNotMatch(html, /type=["']password/i);
  assert.doesNotMatch(html, /apiKey|api_key|provider.*key/i);

  // No prompt() or other input mechanisms
  const sources = RUNTIME.map((name) => read(name)).join("\n");
  assert.doesNotMatch(sources, /prompt\(|confirm\(/);
  assert.doesNotMatch(sources, /apiKey.*=.*\?|apiKey.*input/i);
  
  // No content_scripts or externally_connectable (attack surface)
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.content_scripts, undefined, "No content_scripts in LOCAL extension");
  assert.equal(manifest.externally_connectable, undefined, "No externally_connectable in LOCAL extension");
});

test("YTT-445: extension never stores provider API keys", () => {
  // No storage permission in manifest
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.permissions.includes("storage"), false);
  assert.equal(manifest.optional_permissions, undefined);

  // No chrome.storage API calls in runtime code (comments are OK)
  const popup = read("popup.js");
  const background = read("background.js");
  const sendUrl = read("send-url.js");
  const authHeaders = read("local-auth-headers.js");

  // Core runtime files don't use chrome.storage API
  assert.doesNotMatch(popup, /chrome\.storage\.(local|sync|session)\./);
  assert.doesNotMatch(background, /chrome\.storage\.(local|sync|session)\./);
  assert.doesNotMatch(sendUrl, /chrome\.storage\.(local|sync|session)\./);
  assert.doesNotMatch(authHeaders, /chrome\.storage\.(local|sync|session)\./);

  // No localStorage or sessionStorage
  const sources = [popup, background, sendUrl, authHeaders].join("\n");
  assert.doesNotMatch(sources, /localStorage\.|sessionStorage\./);
  assert.doesNotMatch(sources, /\.setItem\(|\.getItem\(/);
});

test("YTT-445: extension never forwards provider API keys", () => {
  // API keys are stripped from URLs before sending
  const sendUrl = read("send-url.js");
  assert.match(sendUrl, /api_key|apikey/);
  assert.match(sendUrl, /stripSecretParams|isSecretQueryKey/);

  // POST body contains only the page URL, never an apiKey field
  const background = read("background.js");
  assert.doesNotMatch(background, /apiKey.*:/);
  assert.match(sendUrl, /JSON\.stringify\(\{ url \}\)/);

  // Only the loopback Bearer token goes in headers, never a provider key in actual code
  assert.match(sendUrl, /Authorization/);
  assert.match(sendUrl, /Bearer/);
  assert.doesNotMatch(background, /x-api-key|api-key.*header/i);
  // Check that x-api-key only appears in comments (not in actual header assignments)
  assert.doesNotMatch(sendUrl, /(headers|Header)\[["']x-api-key|openai-organization/i);
});

test("YTT-445: extension never calls summarize with client-supplied key", () => {
  // No summarize functionality in extension at all
  const popup = read("popup.js");
  const background = read("background.js");
  const sendUrl = read("send-url.js");

  assert.doesNotMatch(popup, /summarize/i);
  assert.doesNotMatch(background, /summarize/i);
  assert.doesNotMatch(sendUrl, /summarize/i);

  // No calls to OpenAI, Anthropic, or other LLM providers
  const sources = [popup, background, sendUrl].join("\n");
  assert.doesNotMatch(sources, /openai\.com|anthropic\.com|api\.openai|api\.anthropic/i);
  assert.doesNotMatch(sources, /v1\/chat\/completions|v1\/messages/);

  // Only endpoint is the local loopback
  assert.match(sendUrl, /LOCAL_SEND_ENDPOINT.*127\.0\.0\.1:19720/);
  assert.doesNotMatch(sources, /https:\/\/[^1]/);
});

test("YTT-445: summarize must use server-stored keys only", () => {
  // Extension sends only page URL to server; server handles all LLM calls
  const sendUrl = read("send-url.js");
  const bodyPattern = /body.*JSON\.stringify\(\{ url \}\)/;
  assert.match(sendUrl, bodyPattern);

  // Server receives { url } only, no apiKey parameter
  const background = read("background.js");
  const postBody = background.match(/body: request\.body/);
  assert.ok(postBody, "POST body comes from buildLocalSendRequest");

  // buildLocalSendRequest only includes url field
  const requestBuild = sendUrl.match(
    /const body = JSON\.stringify\(\{ url \}\);[\s\S]*?parsedBody\.url !== url/
  );
  assert.ok(requestBuild, "buildLocalSendRequest creates { url } body only");
});
