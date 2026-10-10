"use strict";

const CAPTION_EXTRACT_TIMEOUT_MS = 12000;
const EXTRACT_CAPTIONS_RESULT = "EXTRACT_CAPTIONS_RESULT";

function createCaptionExtract(deps) {
  const sendMessage = deps.sendMessage;
  const addResultListener = deps.addResultListener;
  const lastError = deps.lastError || (() => null);
  const timeoutMs = Number.isFinite(deps.timeoutMs)
    ? deps.timeoutMs
    : CAPTION_EXTRACT_TIMEOUT_MS;
  const setTimeoutFn = deps.setTimeout || setTimeout;
  const clearTimeoutFn = deps.clearTimeout || clearTimeout;
  const randomId =
    deps.randomId || (() => Math.random().toString(36).slice(2));

  function extractFromTab(tabId) {
    return new Promise((resolve) => {
      const requestId = randomId();
      let settled = false;
      let unsubscribe = () => {};

      function finish(value) {
        if (settled) return;
        settled = true;
        clearTimeoutFn(timer);
        try {
          unsubscribe();
        } catch {
          /* ignore */
        }
        resolve(value);
      }

      const timer = setTimeoutFn(() => {
        finish({ ok: false, error: "timeout" });
      }, timeoutMs);

      unsubscribe = addResultListener((msg) => {
        if (!msg || msg.type !== EXTRACT_CAPTIONS_RESULT) return;
        if (msg.requestId && msg.requestId !== requestId) return;
        finish(msg);
      });

      try {
        sendMessage(
          tabId,
          { type: "EXTRACT_CAPTIONS", requestId },
          (response) => {
            const err = lastError();
            if (err) {
              finish(null);
              return;
            }
            if (response && response.accepted) return;
            if (
              response &&
              (response.ok === true || typeof response.error === "string")
            ) {
              finish(response);
              return;
            }
            finish(response ?? null);
          }
        );
      } catch {
        finish(null);
      }
    });
  }

  return {
    extractFromTab,
    timeoutMs,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createCaptionExtract,
    CAPTION_EXTRACT_TIMEOUT_MS,
    EXTRACT_CAPTIONS_RESULT,
  };
} else {
  globalThis.createCaptionExtract = createCaptionExtract;
  globalThis.CAPTION_EXTRACT_TIMEOUT_MS = CAPTION_EXTRACT_TIMEOUT_MS;
  globalThis.EXTRACT_CAPTIONS_RESULT = EXTRACT_CAPTIONS_RESULT;
}
