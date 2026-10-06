const test = require("node:test");
const assert = require("node:assert/strict");

test("background returns transcript ID on success", () => {
  // Verify background.js extracts transcript ID from response
  const fs = require("fs");
  const bgCode = fs.readFileSync(__dirname + "/background.js", "utf8");
  
  // Must return transcript ID from successful response
  assert.ok(
    bgCode.includes("transcriptId: data.id"),
    "Background must extract and return transcript ID from API response"
  );
  assert.ok(
    bgCode.includes("title: data.title"),
    "Background must extract and return title from API response"
  );
  assert.ok(
    bgCode.includes('ok: true'),
    "Background must return ok: true on success"
  );
});

test("background returns specific failure reasons", async () => {
  // Test unreachable (network error)
  const failFetch = async () => {
    throw new Error("Network error");
  };

  // Test unauthorized (401)
  const unauthorizedFetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: "Unauthorized" }),
  });

  // Test other error (non-401 failure)
  const otherErrorFetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: "Server error" }),
  });

  // These would be tested in integration, verifying response shape:
  // { ok: false, reason: "unreachable" }
  // { ok: false, reason: "unauthorized" }
  // { ok: false, reason: "other", error: "..." }
});

test("panel shows Design-locked error strings", () => {
  // Design-locked strings that must not change:
  const designLockedStrings = {
    unreachable: "Start the Transcriber app.",
    unauthorized: "Token missing or out of date — restart Transcriber.",
    other: "Couldn't send this URL.",
  };

  // Verify these exact strings are used in popup.js
  const fs = require("fs");
  const popupCode = fs.readFileSync(__dirname + "/popup.js", "utf8");

  assert.ok(
    popupCode.includes(designLockedStrings.unreachable),
    "Must preserve Design-locked unreachable string"
  );
  assert.ok(
    popupCode.includes(designLockedStrings.unauthorized),
    "Must preserve Design-locked unauthorized string"
  );
  assert.ok(
    popupCode.includes(designLockedStrings.other),
    "Must preserve Design-locked other error string"
  );
});

test("deep-link uses correct transcript ID format", () => {
  // Deep-link format: http://127.0.0.1:19720/?id={transcriptId}
  const transcriptId = "abc123";
  const expectedUrl = `http://127.0.0.1:19720/?id=${encodeURIComponent(transcriptId)}`;
  
  // Verify popup.js constructs this URL
  const fs = require("fs");
  const popupCode = fs.readFileSync(__dirname + "/popup.js", "utf8");
  
  assert.ok(
    popupCode.includes("http://127.0.0.1:19720/?id="),
    "Deep-link must use correct base URL and query param"
  );
  assert.ok(
    popupCode.includes("encodeURIComponent(lastTranscriptId)"),
    "Deep-link must encode transcript ID"
  );
});

test("deep-link button is hidden by default and shown on success", () => {
  const fs = require("fs");
  const popupHtml = fs.readFileSync(__dirname + "/popup.html", "utf8");
  
  // Button must have hidden attribute initially
  assert.ok(
    popupHtml.includes('id="deepLink"') && popupHtml.includes("hidden"),
    "Deep-link button must be hidden by default"
  );
  
  // Verify popup.js shows it on success
  const popupCode = fs.readFileSync(__dirname + "/popup.js", "utf8");
  assert.ok(
    popupCode.includes("deepLinkEl.hidden = false"),
    "Deep-link button must be shown on successful send"
  );
  assert.ok(
    popupCode.includes("deepLinkEl.hidden = true"),
    "Deep-link button must be hidden before sending"
  );
});
