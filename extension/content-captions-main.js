// Runs in YouTube's MAIN world so it can read window.ytInitialPlayerResponse,
// which content scripts in the ISOLATED world cannot see. Posts the caption
// track metadata to the document so content.js (ISOLATED) can pick it up.
//
// The caption baseUrls are same-origin (youtube.com), so the ISOLATED world
// content script can fetch them directly with credentials.

(function () {
  function snapshotTracks() {
    const r = window.ytInitialPlayerResponse;
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
      document.dispatchEvent(
        new CustomEvent("ytt-captions-tracks", {
          detail: { tracks, ts: Date.now() },
        })
      );
    } catch {
      /* page state in flux — wait for next nav event */
    }
  }

  // Initial dispatch (page may already be hydrated).
  dispatch();

  // YouTube SPA navigation — re-snapshot the new video's tracks.
  window.addEventListener("yt-navigate-finish", () => {
    // Defer slightly so YouTube updates ytInitialPlayerResponse first.
    setTimeout(dispatch, 250);
  });

  // Also expose a synchronous request channel for the side panel —
  // content.js can dispatch "ytt-captions-request" and we'll re-emit the
  // current tracks immediately. Useful if the side panel opens after
  // initial load and content.js missed the first dispatch.
  document.addEventListener("ytt-captions-request", () => {
    dispatch();
  });
})();
