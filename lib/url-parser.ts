import { extractVideoId } from "./youtube";

export type Platform = "youtube" | "spotify" | "linkedin" | "generic";

export interface ParsedUrl {
  platform: Platform;
  contentId: string;
  originalUrl: string;
}

const SPOTIFY_EPISODE_REGEX = /^[a-zA-Z0-9]{22}$/;

// LinkedIn snowflake IDs are 19 digits. Event slugs end with the ID
// ("...energyclub7295762520814874625"), so take the trailing 19 digits.
const LINKEDIN_EVENT_PATH = /^\/events\/[^/]*?(\d{19})(?:\/|$)/;
const LINKEDIN_ACTIVITY = /(?:activity|ugcPost|share)[-:]([0-9]+)/;
const LINKEDIN_POST_PATH = /^\/(?:feed\/update|posts)\//;

/**
 * LinkedIn post or event page → `linkedin:<activityId>` / `linkedin:event-<eventId>`.
 * Keep in sync with extension/linkedin-url.js.
 */
export function extractLinkedInContentId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname.replace(/^www\./, "") !== "linkedin.com") return null;

  let path = parsed.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the raw path
  }

  const event = path.match(LINKEDIN_EVENT_PATH);
  if (event) return `linkedin:event-${event[1]}`;

  const highlighted = parsed.searchParams
    .get("highlightedUpdateUrn")
    ?.match(LINKEDIN_ACTIVITY);
  if (highlighted) return `linkedin:${highlighted[1]}`;

  if (LINKEDIN_POST_PATH.test(path)) {
    const activity = path.match(LINKEDIN_ACTIVITY);
    if (activity) return `linkedin:${activity[1]}`;
  }
  return null;
}

/**
 * Parse a content URL and detect the platform.
 * Supports YouTube, Spotify episodes, and LinkedIn posts/events.
 */
export function parseContentUrl(url: string): ParsedUrl {
  if (!url || typeof url !== "string") {
    throw new Error("A URL is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  const host = parsed.hostname.replace(/^www\./, "");

  // Spotify episode URL: open.spotify.com/episode/{id}
  if (host === "open.spotify.com" && parsed.pathname.startsWith("/episode/")) {
    const episodeId = parsed.pathname.split("/episode/")[1]?.split("/")[0]?.split("?")[0];
    if (!episodeId || !SPOTIFY_EPISODE_REGEX.test(episodeId)) {
      throw new Error(
        `Could not extract episode ID from URL. Supported format: open.spotify.com/episode/{id}`
      );
    }
    return { platform: "spotify", contentId: episodeId, originalUrl: url };
  }

  // YouTube — delegate to existing parser
  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtu.be"
  ) {
    const videoId = extractVideoId(url);
    return { platform: "youtube", contentId: videoId, originalUrl: url };
  }

  const linkedInId = extractLinkedInContentId(parsed.href);
  if (linkedInId) {
    return { platform: "linkedin", contentId: linkedInId, originalUrl: url };
  }

  // Fall back to generic yt-dlp handler (Twitch, Vimeo, TikTok, Twitter/X,
  // Dailymotion, Reddit, Instagram, Facebook, Rumble, BiliBili, Odysee,
  // Streamable, etc. — any of the ~1,800 sites yt-dlp supports).
  return { platform: "generic", contentId: url, originalUrl: url };
}
