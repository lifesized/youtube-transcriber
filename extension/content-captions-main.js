// Runs in YouTube's MAIN world so it can read window.ytInitialPlayerResponse,
// which content scripts in the ISOLATED world cannot see. Posts the caption
// track metadata to the document so content.js (ISOLATED) can pick it up.
//
// The caption baseUrls are same-origin (youtube.com), so the ISOLATED world
// content script can fetch them directly with credentials.

(function () {
  function snapshotTracks() {
    const r = window.ytInitialPlayerResponse;
    if (!r) return null; // ytInitialPlayerResponse not hydrated yet
    const tracks =
      r?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    // Strip to a JSON-safe shape — anything we don't need adds bloat to the
    // CustomEvent.detail payload.
    return tracks.map((t) => ({
      languageCode: t.languageCode || "",
      kind: t.kind || "", // "asr" for auto-generated, "" for manual
      name: t.name?.simpleText || t.name?.runs?.[0]?.text || "",
      baseUrl: t.baseUrl || "",
    }));
  }

  function dispatch() {
    try {
      const tracks = snapshotTracks();
      if (tracks == null) return false; // not ready, caller should retry
      document.dispatchEvent(
        new CustomEvent("ytt-captions-tracks", {
          detail: { tracks, ts: Date.now() },
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  // Poll until ytInitialPlayerResponse hydrates. document_start runs
  // before YouTube's inline assignment on direct-load pages, so the
  // initial dispatch always misses; a fixed setTimeout is a guess.
  // Cap at ~6s so we don't leak timers on edge-case pages.
  function dispatchWhenReady() {
    if (dispatch()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (dispatch() || attempts >= 30) clearInterval(timer);
    }, 200);
  }

  // Initial attempt — direct load.
  dispatchWhenReady();

  // YouTube SPA navigation — re-snapshot the new video's tracks. The
  // ytInitialPlayerResponse swap can lag the navigate-finish event so
  // poll here too rather than guessing with a fixed setTimeout.
  window.addEventListener("yt-navigate-finish", dispatchWhenReady);

  // Synchronous request channel for the side panel — content.js
  // (ISOLATED) dispatches "ytt-captions-request" and we re-emit. Useful
  // when the bg's EXTRACT_CAPTIONS arrives before any prior dispatch
  // landed in the cache.
  document.addEventListener("ytt-captions-request", dispatchWhenReady);
})();
