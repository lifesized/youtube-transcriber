"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createCaptionExtract,
  CAPTION_EXTRACT_TIMEOUT_MS,
} = require("./caption-extract.js");

function harness(options = {}) {
  const listeners = new Set();
  let lastError = options.lastError || null;
  const extract = createCaptionExtract({
    timeoutMs: options.timeoutMs ?? 40,
    lastError: () => lastError,
    sendMessage: (tabId, message, cb) => {
      options.onSend && options.onSend(tabId, message, cb);
    },
    addResultListener: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    randomId: () => options.requestId || "req-1",
  });
  return {
    extract,
    emit(msg) {
      for (const fn of listeners) fn(msg);
    },
    setLastError(value) {
      lastError = value;
    },
  };
}

test("caption extract waits ~12s and uses a hard cap", () => {
  assert.equal(CAPTION_EXTRACT_TIMEOUT_MS, 12000);
});

test("ack then result over a second message beats the timeout", async () => {
  let sent;
  let h;
  h = harness({
    onSend(_tabId, message, cb) {
      sent = message;
      cb({ accepted: true, requestId: message.requestId });
      setTimeout(() => {
        h.emit({
          type: "EXTRACT_CAPTIONS_RESULT",
          requestId: message.requestId,
          ok: true,
          segments: [{ start: 0, duration: 1, text: "hi" }],
        });
      }, 5);
    },
  });
  const result = await h.extract.extractFromTab(7);
  assert.equal(sent.type, "EXTRACT_CAPTIONS");
  assert.equal(result.ok, true);
  assert.equal(result.segments[0].text, "hi");
});

test("keep-alive {ok, segments} is accepted without a second message", async () => {
  const h = harness({
    onSend(_tabId, _message, cb) {
      cb({ ok: true, segments: [{ start: 0, duration: 1, text: "legacy" }] });
    },
  });
  const result = await h.extract.extractFromTab(3);
  assert.equal(result.ok, true);
  assert.equal(result.segments[0].text, "legacy");
});

test("lastError means not injected (null) so the caller can retry", async () => {
  const h = harness({
    lastError: { message: "Could not establish connection" },
    onSend(_tabId, _message, cb) {
      cb(undefined);
    },
  });
  const result = await h.extract.extractFromTab(3);
  assert.equal(result, null);
});

test("hard cap returns timeout when the result never arrives", async () => {
  const h = harness({
    timeoutMs: 20,
    onSend(_tabId, _message, cb) {
      cb({ accepted: true });
    },
  });
  const result = await h.extract.extractFromTab(3);
  assert.deepEqual(result, { ok: false, error: "timeout" });
});

test("result requestId must match exactly; missing or other ids are ignored", async () => {
  let h;
  h = harness({
    timeoutMs: 25,
    requestId: "req-strict",
    onSend(_tabId, message, cb) {
      cb({ accepted: true, requestId: message.requestId });
      setTimeout(() => {
        h.emit({
          type: "EXTRACT_CAPTIONS_RESULT",
          ok: true,
          segments: [{ start: 0, duration: 1, text: "no-id" }],
        });
        h.emit({
          type: "EXTRACT_CAPTIONS_RESULT",
          requestId: "other",
          ok: true,
          segments: [{ start: 0, duration: 1, text: "other" }],
        });
        h.emit({
          type: "EXTRACT_CAPTIONS_RESULT",
          requestId: message.requestId,
          ok: true,
          segments: [{ start: 0, duration: 1, text: "match" }],
        });
      }, 5);
    },
  });
  const result = await h.extract.extractFromTab(3);
  assert.equal(result.ok, true);
  assert.equal(result.segments[0].text, "match");

  const ignored = harness({
    timeoutMs: 20,
    requestId: "req-strict",
    onSend(_tabId, _message, cb) {
      cb({ accepted: true });
      ignored.emit({
        type: "EXTRACT_CAPTIONS_RESULT",
        ok: true,
        segments: [{ start: 0, duration: 1, text: "no-id" }],
      });
    },
  });
  const timedOut = await ignored.extract.extractFromTab(4);
  assert.deepEqual(timedOut, { ok: false, error: "timeout" });
});
