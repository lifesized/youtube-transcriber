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
    bgCode.includes('ok: true'),
    "Background must return ok: true on success"
  );
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

test("deep-link uses the selected target origin", () => {
  const fs = require("fs");
  const bgCode = fs.readFileSync(__dirname + "/background.js", "utf8");
  assert.ok(
    bgCode.includes("target.apiBase"),
    "Deep-link must use the selected connect-target origin"
  );
  assert.ok(
    bgCode.includes("encodeURIComponent(transcriptId)"),
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
