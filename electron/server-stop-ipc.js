"use strict";

/**
 * Settings → Stop server. Only the Next child we spawned can send this.
 * The HTTP route is the security boundary (isSettingsPageWrite).
 */

const DEFAULT_STOP_DELAY_MS = 250;

function attachServerStopIpc(child, serverManager, delayMs = DEFAULT_STOP_DELAY_MS) {
  if (!child || typeof child.on !== "function") return;
  child.on("message", (msg) => {
    if (!msg || msg.type !== "server-stop" || !msg.requestId) return;
    try {
      child.send({
        type: "server-stop-result",
        requestId: msg.requestId,
        payload: { ok: true },
      });
    } catch {
      /* child may already be gone */
    }
    const wait = Number.isFinite(delayMs) ? Math.max(0, delayMs) : DEFAULT_STOP_DELAY_MS;
    setTimeout(() => {
      if (!serverManager || typeof serverManager.stop !== "function") return;
      Promise.resolve(serverManager.stop()).catch((error) => {
        console.warn("server-stop failed:", error && error.message);
      });
    }, wait);
  });
}

module.exports = {
  attachServerStopIpc,
  DEFAULT_STOP_DELAY_MS,
};
