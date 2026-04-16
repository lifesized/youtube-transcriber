import { extractVideoId } from "./youtube";

export type Platform = "youtube" | "spotify" | "generic";

export interface ParsedUrl {
  platform: Platform;
  contentId: string;
  originalUrl: string;
}

const SPOTIFY_EPISODE_REGEX = /^[a-zA-Z0-9]{22}$/;

/**
 * Parse a content URL and detect the platform.
 * Supports YouTube and Spotify episode URLs.
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

  // Fall back to generic yt-dlp handler (Twitch, Vimeo, TikTok, Twitter/X,
  // Dailymotion, Reddit, Instagram, Facebook, Rumble, BiliBili, Odysee,
  // Streamable, etc. — any of the ~1,800 sites yt-dlp supports).
  return { platform: "generic", contentId: url, originalUrl: url };
}
