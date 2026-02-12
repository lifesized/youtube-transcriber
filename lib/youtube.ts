/**
 * Extract a YouTube video ID from various URL formats.
 *
 * Supported formats:
 *  - https://www.youtube.com/watch?v=VIDEO_ID
 *  - https://youtu.be/VIDEO_ID
 *  - https://www.youtube.com/embed/VIDEO_ID
 *  - URLs with extra query params (t, list, index, etc.)
 */

const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

export function extractVideoId(url: string): string {
  if (!url || typeof url !== "string") {
    throw new Error("A YouTube URL is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  const { hostname, pathname, searchParams } = parsed;

  // Normalise hostname (strip www.)
  const host = hostname.replace(/^www\./, "");

  let videoId: string | null = null;

  if (host === "youtube.com" || host === "m.youtube.com") {
    if (pathname === "/watch") {
      videoId = searchParams.get("v");
    } else if (pathname.startsWith("/embed/")) {
      videoId = pathname.split("/embed/")[1]?.split("/")[0] ?? null;
    } else if (pathname.startsWith("/v/")) {
      videoId = pathname.split("/v/")[1]?.split("/")[0] ?? null;
    } else if (pathname.startsWith("/shorts/")) {
      videoId = pathname.split("/shorts/")[1]?.split("/")[0] ?? null;
    }
  } else if (host === "youtu.be") {
    // https://youtu.be/VIDEO_ID or https://youtu.be/VIDEO_ID?t=120
    videoId = pathname.slice(1).split("/")[0] ?? null;
  }

  if (!videoId) {
    throw new Error(
      `Could not extract video ID from URL: ${url}. Supported formats: youtube.com/watch?v=, youtu.be/, youtube.com/embed/, youtube.com/shorts/`
    );
  }

  // Strip any trailing query-like fragments that leaked through
  videoId = videoId.split("?")[0].split("&")[0];

  if (!VIDEO_ID_REGEX.test(videoId)) {
    throw new Error(
      `Extracted video ID "${videoId}" is invalid. YouTube video IDs are 11 characters (letters, digits, - and _).`
    );
  }

  return videoId;
}
