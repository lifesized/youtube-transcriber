// Runs in YouTube's MAIN world so it can read window.ytInitialPlayerResponse,
// which content scripts in the ISOLATED world cannot see. Posts the caption
// track metadata to the document so content.js (ISOLATED) can pick it up.
//
// The caption baseUrls are same-origin (youtube.com), so the ISOLATED world
// content script can fetch them directly with credentials.

(function () {
  function getPlayerResponse() {
    // YouTube has rolled out at least three different surfaces for this data
    // over the years and the global `ytInitialPlayerResponse` is missing on
    // many current page renders (confirmed via diagnostic). Try them in
    // order of preference; whichever returns non-null wins.
    //
    //   1. window.ytInitialPlayerResponse — historic inline-script global
    //   2. movie_player.getPlayerResponse() — player API method (most
    //      reliable on current pages, but only after the player initializes)
    //   3. window.ytplayer.config.args.player_response — legacy, sometimes
    //      a JSON string instead of an object
    if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;
    try {
      const player = document.getElementById("movie_player");
      if (player && typeof player.getPlayerResponse === "function") {
        const resp = player.getPlayerResponse();
        if (resp) return resp;
      }
    } catch { /* player not ready */ }
    try {
      const raw = window.ytplayer?.config?.args?.player_response;
      if (raw) return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch { /* malformed */ }
    return null;
  }

  function snapshotTracks() {
    const resp = getPlayerResponse();
    if (!resp) return null; // none of the three sources are ready
    // YouTube populates the player response in stages. Both intermediate
    // states leak through here as "renderer present but no tracks" or
    // "renderer missing entirely". A video with 12 caption tracks was seen
    // dispatching empty during the early window because the renderer object
    // existed before captionTracks was assigned. Treat anything short of
    // a non-empty tracks array as "not ready" so the 6s poll keeps trying.
    // Cost: videos that genuinely have no captions poll for the full
    // window before giving up. Acceptable — those fall to the server path,
    // and most YouTube videos do have captions.
    const renderer = resp?.captions?.playerCaptionsTracklistRenderer;
    const tracks = renderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) return null;
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
