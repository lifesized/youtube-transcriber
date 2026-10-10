"use strict";

/**
 * MAIN-world helper. Isolated content.js cannot see ytInitialPlayerResponse
 * or do a same-origin youtube.com fetch. CustomEvents cross the world bridge.
 */
(function () {
  if (window.__yttCaptionMain) return;
  window.__yttCaptionMain = true;

  function playerResponse() {
    try {
      const player = document.getElementById("movie_player");
      if (player && typeof player.getPlayerResponse === "function") {
        const live = player.getPlayerResponse();
        if (live && typeof live === "object") return live;
      }
    } catch {
      /* player not ready */
    }
    if (window.ytInitialPlayerResponse && typeof window.ytInitialPlayerResponse === "object") {
      return window.ytInitialPlayerResponse;
    }
    return null;
  }

  window.addEventListener("ytt-caption-tracks-request", (event) => {
    const requestId = event && event.detail && event.detail.requestId;
    try {
      const response = playerResponse();
      const tracks =
        (response &&
          response.captions &&
          response.captions.playerCaptionsTracklistRenderer &&
          response.captions.playerCaptionsTracklistRenderer.captionTracks) ||
        [];
      window.dispatchEvent(
        new CustomEvent("ytt-caption-tracks-result", {
          detail: {
            requestId,
            tracks: Array.isArray(tracks) ? tracks : [],
            videoId:
              (response && response.videoDetails && response.videoDetails.videoId) ||
              null,
          },
        })
      );
    } catch (error) {
      window.dispatchEvent(
        new CustomEvent("ytt-caption-tracks-result", {
          detail: { requestId, tracks: [], error: String(error && error.message || error) },
        })
      );
    }
  });

  window.addEventListener("ytt-timedtext-request", async (event) => {
    const detail = (event && event.detail) || {};
    const requestId = detail.requestId;
    const url = detail.url;
    try {
      const res = await fetch(url, {
        credentials: "same-origin",
        redirect: "error",
      });
      const text = await res.text();
      window.dispatchEvent(
        new CustomEvent("ytt-timedtext-result", {
          detail: {
            requestId,
            ok: res.ok,
            status: res.status,
            text,
            contentType: res.headers.get("content-type") || "",
          },
        })
      );
    } catch (error) {
      window.dispatchEvent(
        new CustomEvent("ytt-timedtext-result", {
          detail: {
            requestId,
            ok: false,
            error: String(error && error.message || error),
          },
        })
      );
    }
  });
})();
