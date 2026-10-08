"use strict";

/**
 * LinkedIn content script (LOCAL build). On LINKEDIN_GET_MEDIA from the
 * background, finds the post or event video in this tab and replies with its
 * page URL and a signed LinkedIn CDN media URL for the local server to
 * download. It reads this tab only and never makes network requests.
 *
 * Media sources, most reliable first:
 * 1. Event pages: the recording in LinkedIn's page data (<code> JSON blobs).
 * 2. The playing <video> element's https src / data-sources.
 * 3. Page data on a single-post page (one player only).
 * 4. Media URLs seen in this tab's resource timing (single-video pages only;
 *    LinkedIn often plays through MediaSource, so <video> shows a blob: URL).
 */
var TranscriberLinkedIn = (() => {
  const Url = typeof LinkedInUrl !== "undefined" ? LinkedInUrl : require("./linkedin-url.js");

  const EVENT_TYPE = "com.linkedin.voyager.dash.events.ProfessionalEvent";
  const PLAYER_TYPE = "com.linkedin.videocontent.VideoPlayMetadata";
  const POST_ROOT = '[data-urn^="urn:li:activity:"], [data-id^="urn:li:activity:"], [data-urn^="urn:li:ugcPost:"]';
  const NETWORK_MAX = 50;

  function cleanText(value, maxLength) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  /** Progressive file or HLS manifest on LinkedIn's CDN; never images or segments. */
  function isNetworkMediaUrl(url) {
    if (!Url.isMediaCdnUrl(url)) return false;
    const { pathname } = new URL(url);
    if (/\/dms\/image\//.test(pathname)) return false;
    return /\/mp4-|\.mp4$|\.m3u8$/i.test(pathname);
  }

  function pageEntities(doc) {
    const entities = [];
    for (const code of doc.querySelectorAll("code")) {
      let data;
      try {
        data = JSON.parse(code.textContent);
      } catch {
        continue;
      }
      if (Array.isArray(data?.included)) entities.push(...data.included.filter(Boolean));
    }
    return entities;
  }

  function players(entities) {
    return entities.filter((entity) => entity.$type === PLAYER_TYPE);
  }

  /** Smallest progressive mp4 (same audio, least to download), else the HLS master. */
  function mediaFromPlayer(player) {
    const progressive = (player?.progressiveStreams || [])
      .flatMap((stream) =>
        (stream?.streamingLocations || []).map((location) => ({
          url: location?.url,
          rank: Number(stream.bitRate) || Number(stream.width) || Number.MAX_SAFE_INTEGER,
        }))
      )
      .filter((stream) => Url.isMediaCdnUrl(stream.url))
      .sort((a, b) => a.rank - b.rank);
    if (progressive[0]) return progressive[0].url;

    const hls = (player?.adaptiveStreams || [])
      .filter((stream) => stream?.protocol === "HLS")
      .flatMap((stream) => (stream.masterPlaylists || []).map((playlist) => playlist?.url));
    return hls.find((url) => Url.isMediaCdnUrl(url)) || "";
  }

  /**
   * Event state from page data. null when the page data doesn't describe
   * this event (e.g. LinkedIn navigated here without a full page load).
   */
  function readEvent(doc, eventId) {
    const entities = pageEntities(doc);
    const event = entities.find(
      (entity) => entity.$type === EVENT_TYPE && String(entity.entityUrn || "").endsWith(`:${eventId}`)
    );
    if (!event) return null;

    const candidates = players(entities);
    // Only live recordings carry liveStreamCreatedAt; prefer it over any trailer.
    const player = candidates.find((p) => p.liveStreamCreatedAt) || (candidates.length === 1 ? candidates[0] : null);
    return {
      state: event.lifecycleState || "",
      title: cleanText(event.name, 512),
      mediaUrl: player ? mediaFromPlayer(player) : "",
    };
  }

  function videoSources(video) {
    const sources = [video.currentSrc, video.src, video.getAttribute("src")];
    for (const source of video.querySelectorAll("source")) sources.push(source.getAttribute("src"));
    try {
      const listed = JSON.parse(video.getAttribute("data-sources") || "[]");
      const ranked = listed
        .filter((source) => source?.src)
        .sort((a, b) => (Number(a["data-bitrate"]) || 0) - (Number(b["data-bitrate"]) || 0));
      sources.push(...ranked.map((source) => source.src));
    } catch {
      // ignore malformed data-sources
    }
    return sources.filter((src) => typeof src === "string" && src);
  }

  function elementMediaUrl(video) {
    return videoSources(video).find((src) => Url.isMediaCdnUrl(src)) || "";
  }

  function visibleArea(element, viewport) {
    const rect = element.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, viewport.width) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, viewport.height) - Math.max(rect.top, 0));
    return width * height;
  }

  /** The playing video if any, else the most visible one. */
  function activeVideo(doc, viewport) {
    const ranked = Array.from(doc.querySelectorAll("video"))
      .map((video) => ({ video, area: visibleArea(video, viewport), playing: video.paused === false }))
      .filter((item) => item.area > 0)
      .sort((a, b) => Number(b.playing) - Number(a.playing) || b.area - a.area);
    return ranked[0]?.video || null;
  }

  /**
   * The post a video belongs to: its feed container's URN, else the nearest
   * ancestor holding post links that all point at one post.
   */
  function postForVideo(video) {
    const root = video.closest(POST_ROOT);
    if (root) {
      const pageUrl = Url.postUrlForUrn(root.getAttribute("data-urn") || root.getAttribute("data-id"));
      return pageUrl ? { root, pageUrl } : null;
    }
    let node = video.parentElement;
    for (let depth = 0; node && depth < 14; depth++, node = node.parentElement) {
      const links = Array.from(node.querySelectorAll("a[href]")).filter((link) => Url.contentId(link.href));
      if (!links.length) continue;
      const ids = new Set(links.map((link) => Url.contentId(link.href)));
      return ids.size === 1 ? { root: node, pageUrl: links[0].href } : null;
    }
    return null;
  }

  function extractAuthor(root) {
    const selectors = [
      ".update-components-actor__title span[aria-hidden='true']",
      ".update-components-actor__name",
      ".feed-shared-actor__name",
      "[data-test-id='actor-name']",
    ];
    for (const selector of selectors) {
      const text = cleanText(root?.querySelector(selector)?.textContent, 256);
      if (text) return text;
    }
    return "";
  }

  function extractTitle(root, doc) {
    const selectors = [
      ".update-components-text",
      ".feed-shared-inline-show-more-text",
      ".feed-shared-update-v2__description",
      "[data-test-id='main-feed-activity-card__commentary']",
    ];
    for (const selector of selectors) {
      const text = cleanText(root?.querySelector(selector)?.textContent, 240);
      if (text.length >= 12) return text;
    }
    return cleanText(doc.title.replace(/^\(\d+\)\s*/, "").replace(/\s*\|\s*LinkedIn\s*$/i, ""), 240);
  }

  function lastNetworkMediaUrl(networkUrls) {
    return [...networkUrls].reverse().find(isNetworkMediaUrl) || "";
  }

  /**
   * Resolve the media for this tab.
   * @param {Document} doc
   * @param {string} href  location.href
   * @param {string[]} networkUrls  resource URLs seen in this tab, oldest first
   * @param {{width: number, height: number}} viewport
   * @returns {{ok: true, pageUrl: string, mediaUrl: string, title: string, author: string} | {ok: false, reason: string}}
   */
  function findMedia(doc, href, networkUrls, viewport) {
    const kind = Url.pageKind(href);
    if (!kind) return { ok: false, reason: "no_video" };

    if (kind === "event") {
      const eventId = Url.contentId(href).slice("linkedin:event-".length);
      const event = readEvent(doc, eventId);
      if (event?.state === "FUTURE") return { ok: false, reason: "event_upcoming" };
      if (event?.state === "ONGOING") return { ok: false, reason: "event_live" };
      const title = event?.title || cleanText(doc.querySelector("h1")?.textContent, 512);
      const fromDom = activeVideo(doc, viewport);
      const mediaUrl =
        event?.mediaUrl ||
        (fromDom && elementMediaUrl(fromDom)) ||
        (doc.querySelectorAll("video").length === 1 ? lastNetworkMediaUrl(networkUrls) : "");
      if (mediaUrl) return { ok: true, pageUrl: href, mediaUrl, title, author: "" };
      if (event?.state === "PAST") return { ok: false, reason: "event_no_recording" };
      return { ok: false, reason: "reload" };
    }

    const video = activeVideo(doc, viewport);
    const post = video ? postForVideo(video) : null;

    if (kind === "feed") {
      if (!video) return { ok: false, reason: "no_video" };
      const mediaUrl = elementMediaUrl(video);
      if (!post || !mediaUrl) return { ok: false, reason: "open_post" };
      return { ok: true, pageUrl: post.pageUrl, mediaUrl, title: extractTitle(post.root, doc), author: extractAuthor(post.root) };
    }

    // Single-post URL. A highlighted feed post can sit above other videos,
    // so trust the playing video's own post over the address bar.
    const pagePlayers = players(pageEntities(doc));
    const singleVideo = doc.querySelectorAll("video").length === 1;
    const mediaUrl =
      (video && elementMediaUrl(video)) ||
      (pagePlayers.length === 1 ? mediaFromPlayer(pagePlayers[0]) : "") ||
      (singleVideo ? lastNetworkMediaUrl(networkUrls) : "");
    if (!mediaUrl) return { ok: false, reason: video || pagePlayers.length ? "reload" : "no_video" };
    const root = post?.root || doc.querySelector(POST_ROOT);
    return { ok: true, pageUrl: post?.pageUrl || href, mediaUrl, title: extractTitle(root, doc), author: extractAuthor(root) };
  }

  function start() {
    let networkUrls = [];
    let networkHref = location.href;
    // LinkedIn navigates in-page; media seen on the previous page isn't this page's.
    const currentNetworkUrls = () => {
      if (location.href !== networkHref) {
        networkHref = location.href;
        networkUrls = [];
      }
      return networkUrls;
    };
    const remember = (url) => {
      if (!isNetworkMediaUrl(url)) return;
      currentNetworkUrls();
      const existing = networkUrls.indexOf(url);
      if (existing >= 0) networkUrls.splice(existing, 1);
      networkUrls.push(url);
      if (networkUrls.length > NETWORK_MAX) networkUrls.shift();
    };
    try {
      new PerformanceObserver((list) => list.getEntries().forEach((entry) => remember(entry.name))).observe({
        type: "resource",
        buffered: true,
      });
    } catch {
      // resource timing unavailable; DOM sources still work
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "LINKEDIN_GET_MEDIA") return undefined;
      const viewport = { width: innerWidth, height: innerHeight };
      sendResponse(findMedia(document, location.href, currentNetworkUrls(), viewport));
      return false;
    });
  }

  return { findMedia, readEvent, mediaFromPlayer, isNetworkMediaUrl, start };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = TranscriberLinkedIn;
} else {
  TranscriberLinkedIn.start();
}
