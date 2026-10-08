"use strict";

/**
 * LinkedIn page URL → transcript video ID. Mirrors extractLinkedInContentId
 * in lib/url-parser.ts; the server re-derives the ID from the page URL.
 * `var` so chrome.scripting re-injection into a live tab can redeclare it.
 */
var LinkedInUrl = (() => {
  // LinkedIn snowflake IDs are 19 digits; event slugs end with the ID.
  const EVENT_PATH = /^\/events\/[^/]*?(\d{19})(?:\/|$)/;
  const ACTIVITY = /(?:activity|ugcPost|share)[-:]([0-9]+)/;
  const POST_PATH = /^\/(?:feed\/update|posts)\//;
  // Pages listing several posts. The content script picks the post whose video is playing.
  const FEED_PATH = /^\/(?:feed\/?$|in\/[^/]+\/recent-activity\/|company\/[^/]+\/posts\/?$)/;

  function parse(url) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.replace(/^www\./, "") !== "linkedin.com") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function decodedPath(parsed) {
    try {
      return decodeURIComponent(parsed.pathname);
    } catch {
      return parsed.pathname;
    }
  }

  /** `linkedin:<activityId>`, `linkedin:event-<eventId>`, or null. */
  function contentId(url) {
    const parsed = parse(url);
    if (!parsed) return null;
    const path = decodedPath(parsed);

    const event = path.match(EVENT_PATH);
    if (event) return `linkedin:event-${event[1]}`;

    const highlighted = (parsed.searchParams.get("highlightedUpdateUrn") || "").match(ACTIVITY);
    if (highlighted) return `linkedin:${highlighted[1]}`;

    if (POST_PATH.test(path)) {
      const activity = path.match(ACTIVITY);
      if (activity) return `linkedin:${activity[1]}`;
    }
    return null;
  }

  /** "event" | "post" | "feed" | null */
  function pageKind(url) {
    const id = contentId(url);
    if (id) return id.startsWith("linkedin:event-") ? "event" : "post";
    const parsed = parse(url);
    return parsed && FEED_PATH.test(decodedPath(parsed)) ? "feed" : null;
  }

  /** Panel key: the post/event ID, or "linkedin:feed" until the content script picks a post. */
  function panelVideoId(url) {
    return contentId(url) || (pageKind(url) === "feed" ? "linkedin:feed" : null);
  }

  /** https URL on LinkedIn's media CDN (*.licdn.com). */
  function isMediaCdnUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return false;
      return parsed.hostname === "licdn.com" || parsed.hostname.endsWith(".licdn.com");
    } catch {
      return false;
    }
  }

  function postUrlForUrn(urn) {
    const match = String(urn || "").match(/^urn:li:(?:activity|ugcPost|share):[0-9]+$/);
    return match ? `https://www.linkedin.com/feed/update/${match[0]}/` : null;
  }

  return { contentId, pageKind, panelVideoId, isMediaCdnUrl, postUrlForUrn };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = LinkedInUrl;
}
