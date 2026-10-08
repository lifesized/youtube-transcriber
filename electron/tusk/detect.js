"use strict";

/**
 * Slack text → supported Transcriber URLs.
 * Parse Slack <target|label> structurally, use ONLY the target, decode
 * HTML entities once (&amp; last), then rebuild a canonical URL from IDs.
 */

const BARE_URL_REGEX = /https?:\/\/[^\s<>()]+/g;
const SLACK_MRKDWN_LINK = /<([^<>]+)>/g;
const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const SPOTIFY_EPISODE_REGEX = /^[a-zA-Z0-9]{22}$/;
const LINKEDIN_EVENT_PATH = /^\/events\/[^/]*?(\d{19})(?:\/|$)/;
const LINKEDIN_ACTIVITY = /(activity|ugcPost|share)[-:]([0-9]+)/;
const LINKEDIN_POST_PATH = /^\/(?:feed\/update|posts)\//;
const LINKEDIN_HOSTS = ["www.linkedin.com", "linkedin.com"];

function decodeHtmlEntitiesOnce(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, "&");
}

function slackLinkTarget(inner) {
  const raw = String(inner || "");
  const pipe = raw.indexOf("|");
  const target = pipe === -1 ? raw : raw.slice(0, pipe);
  return decodeHtmlEntitiesOnce(target).trim();
}

function stripTrailingPunctuation(url) {
  return String(url || "").replace(/[.,;:!?)]+$/g, "");
}

function extractRawUrls(text) {
  const raw = String(text || "");
  const urls = [];
  const seen = new Set();

  for (const match of raw.matchAll(SLACK_MRKDWN_LINK)) {
    const target = stripTrailingPunctuation(slackLinkTarget(match[1]));
    if (/^https?:\/\//i.test(target) && !seen.has(target)) {
      seen.add(target);
      urls.push(target);
    }
  }

  const withoutWrapped = raw.replace(SLACK_MRKDWN_LINK, " ");
  const decoded = decodeHtmlEntitiesOnce(withoutWrapped);
  const bare = decoded.match(BARE_URL_REGEX) || [];
  for (const url of bare) {
    const cleaned = stripTrailingPunctuation(url);
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      urls.push(cleaned);
    }
  }
  return urls;
}

function extractYoutubeVideoId(url) {
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  let videoId = null;
  if (host === "youtube.com" || host === "m.youtube.com") {
    if (parsed.pathname === "/watch") videoId = parsed.searchParams.get("v");
    else if (parsed.pathname.startsWith("/embed/")) {
      videoId = parsed.pathname.split("/embed/")[1]?.split("/")[0] ?? null;
    } else if (parsed.pathname.startsWith("/v/")) {
      videoId = parsed.pathname.split("/v/")[1]?.split("/")[0] ?? null;
    } else if (parsed.pathname.startsWith("/shorts/")) {
      videoId = parsed.pathname.split("/shorts/")[1]?.split("/")[0] ?? null;
    }
  } else if (host === "youtu.be") {
    videoId = parsed.pathname.slice(1).split("/")[0] ?? null;
  }
  if (!videoId) return null;
  videoId = videoId.split("?")[0].split("&")[0];
  return VIDEO_ID_REGEX.test(videoId) ? videoId : null;
}

function parseLinkedInPage(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    !LINKEDIN_HOSTS.includes(parsed.hostname) ||
    parsed.port ||
    parsed.username ||
    parsed.password
  ) {
    return null;
  }
  let path = parsed.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the raw path
  }
  const event = path.match(LINKEDIN_EVENT_PATH);
  if (event) {
    const canonicalUrl = `https://www.linkedin.com/events/${event[1]}/`;
    return {
      platform: "linkedin",
      contentId: `linkedin:event-${event[1]}`,
      url: canonicalUrl,
      canonicalUrl,
    };
  }
  const activity =
    parsed.searchParams.get("highlightedUpdateUrn")?.match(LINKEDIN_ACTIVITY) ??
    (LINKEDIN_POST_PATH.test(path) ? path.match(LINKEDIN_ACTIVITY) : null);
  if (activity) {
    const canonicalUrl = `https://www.linkedin.com/feed/update/urn:li:${activity[1]}:${activity[2]}/`;
    return {
      platform: "linkedin",
      contentId: `linkedin:${activity[2]}`,
      url: canonicalUrl,
      canonicalUrl,
    };
  }
  return null;
}

function parseSpotifyEpisode(url) {
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  if (host !== "open.spotify.com" || !parsed.pathname.startsWith("/episode/")) return null;
  const episodeId = parsed.pathname.split("/episode/")[1]?.split("/")[0]?.split("?")[0];
  if (!episodeId || !SPOTIFY_EPISODE_REGEX.test(episodeId)) return null;
  const canonicalUrl = `https://open.spotify.com/episode/${episodeId}`;
  return { platform: "spotify", contentId: episodeId, url: canonicalUrl };
}

function classifySupportedUrl(url) {
  const videoId = extractYoutubeVideoId(url);
  if (videoId) {
    return {
      platform: "youtube",
      contentId: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      videoId,
    };
  }
  const spotify = parseSpotifyEpisode(url);
  if (spotify) return spotify;
  const linkedin = parseLinkedInPage(url);
  if (linkedin) return linkedin;
  return null;
}

function extractYouTubeUrlsFromSlackText(text) {
  const seen = new Set();
  const urls = [];
  for (const url of extractRawUrls(text)) {
    const videoId = extractYoutubeVideoId(url);
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    urls.push({ url: `https://www.youtube.com/watch?v=${videoId}`, videoId });
  }
  return urls;
}

function extractSupportedSlackUrls(text) {
  const seen = new Set();
  const urls = [];
  for (const url of extractRawUrls(text)) {
    const hit = classifySupportedUrl(url);
    if (!hit) continue;
    const key = `${hit.platform}:${hit.contentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(hit);
  }
  return urls;
}

module.exports = {
  decodeHtmlEntitiesOnce,
  slackLinkTarget,
  extractRawUrls,
  extractYouTubeUrlsFromSlackText,
  extractSupportedSlackUrls,
  classifySupportedUrl,
  extractYoutubeVideoId,
};
