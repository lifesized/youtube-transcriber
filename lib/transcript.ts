import { extractVideoId } from "./youtube";
import type {
  TranscriptSegment,
  VideoMetadata,
  VideoTranscriptResult,
} from "./types";

// Re-export types for convenience
export type { TranscriptSegment, VideoMetadata, VideoTranscriptResult };

const INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

/**
 * Fetch video metadata using the YouTube oEmbed API (no API key required).
 */
async function fetchMetadata(videoId: string): Promise<VideoMetadata> {
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

  const res = await fetch(oembedUrl);

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        `Video ${videoId} is private or restricted — metadata unavailable.`
      );
    }
    if (res.status === 404) {
      throw new Error(
        `Video ${videoId} not found — it may have been removed.`
      );
    }
    throw new Error(
      `Failed to fetch metadata for video ${videoId} (HTTP ${res.status}).`
    );
  }

  const data = await res.json();

  return {
    videoId,
    title: data.title ?? "Untitled",
    author: data.author_name ?? "Unknown",
    channelUrl: data.author_url ?? "",
    thumbnailUrl:
      data.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

/**
 * Decode HTML entities in caption text.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Fetch time-coded transcript segments for a YouTube video using the
 * InnerTube API with the Android client (which reliably returns caption URLs).
 */
async function fetchTranscript(videoId: string): Promise<TranscriptSegment[]> {
  // Step 1: Get caption track URLs via InnerTube player API (Android client)
  const playerPayload = {
    context: {
      client: {
        hl: "en",
        gl: "US",
        clientName: "ANDROID",
        clientVersion: "19.35.36",
        androidSdkVersion: 34,
        userAgent:
          "com.google.android.youtube/19.35.36 (Linux; U; Android 14) gzip",
      },
    },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  };

  const playerRes = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "com.google.android.youtube/19.35.36 (Linux; U; Android 14) gzip",
      },
      body: JSON.stringify(playerPayload),
    }
  );

  if (!playerRes.ok) {
    throw new Error(
      `Failed to fetch video info for ${videoId} (HTTP ${playerRes.status}).`
    );
  }

  const playerData = await playerRes.json();

  const status = playerData.playabilityStatus?.status;
  if (status === "LOGIN_REQUIRED") {
    throw new Error(
      `Video ${videoId} is unavailable — it may be private, age-restricted, or removed.`
    );
  }

  const captionTracks =
    playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    throw new Error(
      `Captions are disabled for video ${videoId}. The video owner has turned off captions.`
    );
  }

  // Prefer manual English captions, fall back to auto-generated, then first available
  const track =
    captionTracks.find(
      (t: { vssId?: string }) => t.vssId === ".en"
    ) ??
    captionTracks.find(
      (t: { vssId?: string }) => t.vssId === "a.en"
    ) ??
    captionTracks[0];

  // Step 2: Fetch caption XML
  const captionRes = await fetch(track.baseUrl);

  if (!captionRes.ok) {
    throw new Error(
      `Failed to fetch captions for video ${videoId} (HTTP ${captionRes.status}).`
    );
  }

  const xml = await captionRes.text();

  if (!xml.trim()) {
    throw new Error(
      `Captions are disabled for video ${videoId}. The video owner has turned off captions.`
    );
  }

  // Step 3: Parse the XML into TranscriptSegment[]
  // The Android client returns srv3 format: <p t="timeMs" d="durMs">...<s>text</s>...</p>
  // The WEB client would return: <text start="sec" dur="sec">text</text>
  const segments: TranscriptSegment[] = [];

  if (xml.includes('<timedtext format="3">')) {
    // srv3 format: <p t="ms" d="ms"> with <s> children containing text
    const pRegex = /<p t="(\d+)" d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
    let match;
    while ((match = pRegex.exec(xml)) !== null) {
      const startMs = parseInt(match[1], 10);
      const durationMs = parseInt(match[2], 10);
      const rawContent = match[3];
      // Extract text from <s> elements or use raw content
      const text = decodeEntities(rawContent.replace(/<[^>]+>/g, "")).trim();
      if (text) {
        segments.push({ text, startMs, durationMs });
      }
    }
  } else {
    // Classic format: <text start="seconds" dur="seconds">text</text>
    const textRegex = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
    let match;
    while ((match = textRegex.exec(xml)) !== null) {
      const startSec = parseFloat(match[1]);
      const durSec = parseFloat(match[2]);
      const rawText = match[3];
      const text = decodeEntities(rawText).replace(/<[^>]+>/g, "").trim();
      if (text) {
        segments.push({
          text,
          startMs: Math.round(startSec * 1000),
          durationMs: Math.round(durSec * 1000),
        });
      }
    }
  }

  return segments;
}

/**
 * Fetch the full transcript and metadata for a YouTube video.
 *
 * @param url - A YouTube video URL (watch, short, embed, youtu.be)
 * @returns Structured result with metadata + time-coded transcript
 */
export async function getVideoTranscript(
  url: string
): Promise<VideoTranscriptResult> {
  const videoId = extractVideoId(url);

  const [metadata, transcript] = await Promise.all([
    fetchMetadata(videoId),
    fetchTranscript(videoId),
  ]);

  return {
    ...metadata,
    transcript,
  };
}
