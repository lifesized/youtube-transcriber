"use strict";

/**
 * YouTube watch / Shorts / embed / youtu.be → 11-char video id.
 * Shared by the service worker and the YouTube content script.
 */
function youtubeVideoId(url) {
  try {
    const parsed = new URL(String(url || ""));
    const host = parsed.hostname.replace(/^www\./, "");
    let id = null;
    if (host === "youtu.be") {
      id = parsed.pathname.slice(1).split("/")[0] || null;
    } else if (host === "youtube.com" || host === "m.youtube.com") {
      if (parsed.pathname === "/watch") id = parsed.searchParams.get("v");
      else if (parsed.pathname.startsWith("/shorts/")) {
        id = parsed.pathname.split("/shorts/")[1]?.split("/")[0] || null;
      } else if (parsed.pathname.startsWith("/embed/")) {
        id = parsed.pathname.split("/embed/")[1]?.split("/")[0] || null;
      }
    }
    if (!id) return null;
    id = id.split("?")[0].split("&")[0];
    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Match a tab by video id, not by exact URL (share links, extra query params). */
function findYouTubeTabByVideoId(tabs, targetUrl) {
  const targetVid = youtubeVideoId(targetUrl);
  if (!targetVid) return null;
  const list = Array.isArray(tabs) ? tabs : [];
  return list.find((tab) => youtubeVideoId(tab && tab.url) === targetVid) || null;
}

const YOUTUBE_TAB_QUERY_URLS = [
  "*://*.youtube.com/*",
  "*://m.youtube.com/*",
  "*://youtu.be/*",
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    youtubeVideoId,
    findYouTubeTabByVideoId,
    YOUTUBE_TAB_QUERY_URLS,
  };
} else {
  globalThis.youtubeVideoId = youtubeVideoId;
  globalThis.findYouTubeTabByVideoId = findYouTubeTabByVideoId;
  globalThis.YOUTUBE_TAB_QUERY_URLS = YOUTUBE_TAB_QUERY_URLS;
}
