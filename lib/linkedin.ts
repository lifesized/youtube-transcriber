import { getGenericTranscript } from "./generic-video";
import type { VideoTranscriptResult } from "./types";

/** Known LinkedIn failure with a message that is safe to show as-is. */
export class LinkedInMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkedInMediaError";
  }
}

export const LINKEDIN_MESSAGES = {
  eventNeedsBrowser:
    "LinkedIn event recordings need your signed-in browser. Open the event in Chrome and press Transcribe in the Transcriber extension.",
  postNeedsBrowser:
    "LinkedIn didn't share this video without sign-in. Open the post in Chrome and press Transcribe in the Transcriber extension.",
  linkExpired:
    "This LinkedIn video link has expired. Reload the LinkedIn page and press Transcribe again.",
} as const;

/**
 * Signed LinkedIn CDN media URL (dms.licdn.com etc.). The server only ever
 * downloads extension-supplied media from LinkedIn's own CDN.
 */
export function isLinkedInMediaUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4096) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  // yt-dlp parses URLs differently (it reads "https://a.licdn.com\@127.0.0.1/" as host 127.0.0.1),
  // so accept only input that is already in WHATWG form.
  if (parsed.href !== value) return false;
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return false;
  return parsed.hostname === "licdn.com" || parsed.hostname.endsWith(".licdn.com");
}

/** Trim page-supplied text (title/author) to a single short line. */
export function cleanLinkedInText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export interface LinkedInSource {
  /** `linkedin:<activityId>` or `linkedin:event-<eventId>` */
  videoId: string;
  pageUrl: string;
  mediaUrl?: string;
  title?: string;
  author?: string;
}

function isYtDlpFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return (message.startsWith("Command failed:") && message.includes("yt-dlp")) || message.startsWith("yt-dlp ");
}

/**
 * Transcribe a LinkedIn post or event recording.
 * With `mediaUrl` (read by the extension from the user's own tab) yt-dlp
 * downloads that CDN file directly. Without it, public posts go through
 * yt-dlp's LinkedIn extractor; events always need the extension.
 */
export async function getLinkedInTranscript(
  source: LinkedInSource
): Promise<VideoTranscriptResult & { source: string; videoUrl: string }> {
  const isEvent = source.videoId.startsWith("linkedin:event-");
  if (!source.mediaUrl && isEvent) {
    throw new LinkedInMediaError(LINKEDIN_MESSAGES.eventNeedsBrowser);
  }

  let result;
  try {
    result = await getGenericTranscript(source.mediaUrl ?? source.pageUrl, {
      canonicalVideoId: source.videoId,
      platform: "linkedin",
    });
  } catch (err) {
    if (!isYtDlpFailure(err)) throw err;
    console.log(`[linkedin] yt-dlp failed for ${source.videoId}`);
    throw new LinkedInMediaError(
      source.mediaUrl ? LINKEDIN_MESSAGES.linkExpired : LINKEDIN_MESSAGES.postNeedsBrowser
    );
  }

  // A bare CDN download has no metadata (yt-dlp names it after the file).
  const fallbackTitle = isEvent ? "LinkedIn event" : "LinkedIn video";
  return {
    ...result,
    title: source.title || (source.mediaUrl ? fallbackTitle : result.title),
    author: source.author || (source.mediaUrl ? "LinkedIn" : result.author),
    channelUrl: source.mediaUrl ? "" : result.channelUrl,
    thumbnailUrl: source.mediaUrl ? "" : result.thumbnailUrl,
    videoId: source.videoId,
    videoUrl: source.pageUrl,
  };
}
