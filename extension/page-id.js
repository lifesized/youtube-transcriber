"use strict";

/**
 * Detect a transcribable YouTube video or Spotify episode ID from a page URL.
 * Kept as a plain module so URL parsing can be unit-tested without Chrome.
 */

function extractPageContentId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    if (host === "youtube.com" || host === "m.youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      if (u.pathname.startsWith("/shorts/"))
        return u.pathname.split("/shorts/")[1]?.split("/")[0];
      if (u.pathname.startsWith("/embed/"))
        return u.pathname.split("/embed/")[1]?.split("/")[0];
    }

    if (host === "open.spotify.com") {
      const match = u.pathname.match(
        /^(?:\/intl-[a-z]{2}(?:-[a-z0-9]+)?)?(?:\/embed(?:-podcast)?)?\/episode\/([a-zA-Z0-9]{22})(?:\/|$)/i
      );
      if (match) return match[1];
    }
  } catch {
    /* ignore */
  }
  return null;
}

if (typeof globalThis !== "undefined") {
  globalThis.extractPageContentId = extractPageContentId;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { extractPageContentId };
}
