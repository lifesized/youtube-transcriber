import { extractVideoId } from "./youtube";
import { transcribeWithWhisper, type ProgressCallback } from "./whisper";
import type {
  TranscriptSegment,
  VideoMetadata,
  VideoTranscriptResult,
} from "./types";

// Re-export types for convenience
export type { TranscriptSegment, VideoMetadata, VideoTranscriptResult, ProgressCallback };

const INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

/**
 * Custom error class for 429 rate-limit failures.
 */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

/**
 * Custom error class for YouTube bot detection (LOGIN_REQUIRED).
 */
export class BotDetectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BotDetectionError";
  }
}

/**
 * Custom error class for videos that have no caption tracks available.
 */
export class NoCaptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoCaptionsError";
  }
}

/**
 * Fetch with retry on HTTP 429 (rate-limit) and timeout responses.
 * Max 3 retries with exponential backoff: 2s, 4s, 8s.
 */
async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  maxRetries = 3,
  timeoutMs = 10000
): Promise<Response> {
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.status !== 429) {
        return res;
      }

      lastResponse = res;

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
        console.log(
          `[transcript] 429 rate-limited on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${delay / 1000}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        console.log(
          `[transcript] Request timed out on attempt ${attempt + 1}/${maxRetries + 1}`
        );
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt + 1) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new Error(`Request timed out after ${maxRetries + 1} attempts`);
      }
      throw err;
    }
  }

  // All retries exhausted with 429
  return lastResponse!;
}

/**
 * Fetch video metadata using the YouTube oEmbed API (no API key required).
 */
async function fetchMetadata(videoId: string): Promise<VideoMetadata> {
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

  const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });

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
 * Select the best caption track from a list of tracks.
 * Prefers manual English, then auto-generated English, then first available.
 */
function selectCaptionTrack(
  captionTracks: Array<{ vssId?: string; baseUrl: string }>
): { vssId?: string; baseUrl: string } {
  return (
    captionTracks.find((t) => t.vssId === ".en") ??
    captionTracks.find((t) => t.vssId === "a.en") ??
    captionTracks[0]
  );
}

/**
 * Parse caption XML into TranscriptSegment[].
 * Handles both srv3 format (Android) and classic format (WEB).
 */
function parseCaptionXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  if (xml.includes('<timedtext format="3">')) {
    // srv3 format: <p t="ms" d="ms"> with <s> children containing text
    const pRegex = /<p t="(\d+)" d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
    let match;
    while ((match = pRegex.exec(xml)) !== null) {
      const startMs = parseInt(match[1], 10);
      const durationMs = parseInt(match[2], 10);
      const rawContent = match[3];
      const text = decodeEntities(rawContent.replace(/<[^>]+>/g, "")).trim();
      if (text) {
        segments.push({ text, startMs, durationMs });
      }
    }
  } else {
    // Classic format: <text start="seconds" dur="seconds">text</text>
    const textRegex =
      /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
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
 * Fetch transcript via the InnerTube ANDROID client.
 * Returns segments, or throws RateLimitError on 429 (after retries).
 */
async function fetchTranscriptAndroid(
  videoId: string
): Promise<TranscriptSegment[]> {
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

  const playerRes = await fetchWithRetry(
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

  if (playerRes.status === 429) {
    throw new RateLimitError(
      `YouTube rate-limited the InnerTube player API for video ${videoId}.`
    );
  }

  if (!playerRes.ok) {
    throw new Error(
      `Failed to fetch video info for ${videoId} (HTTP ${playerRes.status}).`
    );
  }

  const playerData = await playerRes.json();

  const status = playerData.playabilityStatus?.status;
  if (status === "LOGIN_REQUIRED") {
    throw new BotDetectionError(
      `YouTube bot detection triggered for video ${videoId} (ANDROID client).`
    );
  }

  const captionTracks =
    playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    throw new NoCaptionsError(
      `Captions are disabled for video ${videoId}. The video owner has turned off captions.`
    );
  }

  const track = selectCaptionTrack(captionTracks);

  const captionRes = await fetchWithRetry(track.baseUrl, undefined, 1);

  if (captionRes.status === 429) {
    throw new RateLimitError(
      `YouTube rate-limited the caption download for video ${videoId}.`
    );
  }

  if (!captionRes.ok) {
    throw new Error(
      `Failed to fetch captions for video ${videoId} (HTTP ${captionRes.status}).`
    );
  }

  const xml = await captionRes.text();

  if (!xml.trim()) {
    throw new NoCaptionsError(
      `Captions are disabled for video ${videoId}. The video owner has turned off captions.`
    );
  }

  return parseCaptionXml(xml);
}

/**
 * Fetch transcript via the InnerTube WEB client.
 * Uses a browser-like User-Agent and WEB client context.
 * Middle fallback between ANDROID and page scrape.
 */
async function fetchTranscriptWebClient(
  videoId: string
): Promise<TranscriptSegment[]> {
  console.log(`[transcript] Trying WEB InnerTube client for ${videoId}...`);

  const playerPayload = {
    context: {
      client: {
        hl: "en",
        gl: "US",
        clientName: "WEB",
        clientVersion: "2.20241126.01.00",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  };

  const playerRes = await fetchWithRetry(
    `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body: JSON.stringify(playerPayload),
    },
    1 // Only 1 retry for the player API — it's not what's failing
  );

  if (playerRes.status === 429) {
    throw new RateLimitError(
      `YouTube rate-limited the WEB InnerTube player API for video ${videoId}.`
    );
  }

  if (!playerRes.ok) {
    throw new Error(
      `Failed to fetch video info via WEB client for ${videoId} (HTTP ${playerRes.status}).`
    );
  }

  const playerData = await playerRes.json();

  const status = playerData.playabilityStatus?.status;
  if (status === "LOGIN_REQUIRED") {
    throw new BotDetectionError(
      `YouTube bot detection triggered for video ${videoId} (WEB client).`
    );
  }

  const captionTracks =
    playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    throw new NoCaptionsError(
      `Captions are disabled for video ${videoId}. The video owner has turned off captions.`
    );
  }

  const track = selectCaptionTrack(captionTracks);

  const captionRes = await fetchWithRetry(track.baseUrl, undefined, 1);

  if (captionRes.status === 429) {
    throw new RateLimitError(
      `YouTube rate-limited the caption download (WEB client) for video ${videoId}.`
    );
  }

  if (!captionRes.ok) {
    throw new Error(
      `Failed to fetch captions via WEB client for video ${videoId} (HTTP ${captionRes.status}).`
    );
  }

  const xml = await captionRes.text();

  if (!xml.trim()) {
    throw new NoCaptionsError(
      `Captions are disabled for video ${videoId}. The video owner has turned off captions.`
    );
  }

  return parseCaptionXml(xml);
}

/**
 * Fallback: fetch transcript by scraping the YouTube watch page (WEB client).
 * Used when the ANDROID client gets rate-limited.
 */
async function fetchTranscriptWebFallback(
  videoId: string
): Promise<TranscriptSegment[]> {
  console.log(
    `[transcript] ANDROID client blocked (rate-limit or bot detection), trying WEB fallback for ${videoId}...`
  );

  const watchRes = await fetchWithRetry(
    `https://www.youtube.com/watch?v=${videoId}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    }
  );

  if (watchRes.status === 429) {
    throw new RateLimitError(
      `YouTube rate-limited the watch page for video ${videoId}.`
    );
  }

  if (!watchRes.ok) {
    throw new Error(
      `Failed to fetch watch page for video ${videoId} (HTTP ${watchRes.status}).`
    );
  }

  const html = await watchRes.text();

  // Extract ytInitialPlayerResponse JSON from the page HTML
  const jsonMatch = html.match(
    /ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});\s*(?:<\/script>|var\s)/
  );

  if (!jsonMatch) {
    throw new Error(
      `Could not extract player response from watch page for video ${videoId}.`
    );
  }

  let playerData: Record<string, unknown>;
  try {
    playerData = JSON.parse(jsonMatch[1]);
  } catch {
    throw new Error(
      `Failed to parse player response JSON from watch page for video ${videoId}.`
    );
  }

  const playabilityStatus = (playerData.playabilityStatus as { status?: string })?.status;
  if (playabilityStatus === "LOGIN_REQUIRED") {
    throw new BotDetectionError(
      `YouTube bot detection triggered for video ${videoId}. YouTube is flagging requests from this network as automated. Try from a different network or without VPN.`
    );
  }

  const captions = playerData.captions as
    | { playerCaptionsTracklistRenderer?: { captionTracks?: Array<{ vssId?: string; baseUrl: string }> } }
    | undefined;
  const captionTracks = captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    throw new NoCaptionsError(
      `Captions are disabled for video ${videoId}. The video owner has turned off captions.`
    );
  }

  const track = selectCaptionTrack(captionTracks);

  const captionRes = await fetchWithRetry(track.baseUrl, undefined, 1);

  if (captionRes.status === 429) {
    throw new RateLimitError(
      `YouTube rate-limited the caption download (WEB fallback) for video ${videoId}.`
    );
  }

  if (!captionRes.ok) {
    throw new Error(
      `Failed to fetch captions (WEB fallback) for video ${videoId} (HTTP ${captionRes.status}).`
    );
  }

  const xml = await captionRes.text();

  if (!xml.trim()) {
    throw new NoCaptionsError(
      `Captions are disabled for video ${videoId}. The video owner has turned off captions.`
    );
  }

  return parseCaptionXml(xml);
}

/**
 * Fetch time-coded transcript segments for a YouTube video.
 * Fallback chain: ANDROID InnerTube → WEB InnerTube → WEB page scrape.
 * Returns the segments and source ("youtube_captions" or "whisper_local").
 */
async function fetchTranscript(
  videoId: string
): Promise<{ segments: TranscriptSegment[]; source: string }> {
  try {
    const segments = await fetchTranscriptAndroid(videoId);
    return { segments, source: "youtube_captions" };
  } catch (err) {
    if (err instanceof NoCaptionsError) {
      console.log(
        `[transcript] No captions available for ${videoId}, falling back to local Whisper transcription...`
      );
      const segments = await transcribeWithWhisper(videoId);
      return { segments, source: "whisper_local" };
    }
    console.log(
      `[transcript] ANDROID client failed for ${videoId}: ${err instanceof Error ? err.message : err}. Trying WEB InnerTube...`
    );
    try {
      const segments = await fetchTranscriptWebClient(videoId);
      return { segments, source: "youtube_captions" };
    } catch (err2) {
      if (err2 instanceof NoCaptionsError) {
        console.log(
          `[transcript] No captions available for ${videoId}, falling back to local Whisper transcription...`
        );
        const segments = await transcribeWithWhisper(videoId);
        return { segments, source: "whisper_local" };
      }
      console.log(
        `[transcript] WEB InnerTube failed for ${videoId}: ${err2 instanceof Error ? err2.message : err2}. Trying WEB page scrape...`
      );
      const segments = await fetchTranscriptWebFallback(videoId);
      return { segments, source: "youtube_captions" };
    }
  }
}

/**
 * Fetch the full transcript and metadata for a YouTube video.
 *
 * @param url - A YouTube video URL (watch, short, embed, youtu.be)
 * @returns Structured result with metadata + time-coded transcript + source
 */
export async function getVideoTranscript(
  url: string
): Promise<VideoTranscriptResult & { source: string }> {
  const videoId = extractVideoId(url);

  // Use a longer timeout when Whisper fallback might be needed (up to 10 minutes)
  const result = await Promise.race([
    (async () => {
      const [metadata, transcriptResult] = await Promise.all([
        fetchMetadata(videoId),
        fetchTranscript(videoId),
      ]);
      return {
        ...metadata,
        transcript: transcriptResult.segments,
        source: transcriptResult.source,
      };
    })(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "Transcript capture timed out. Please try again."
            )
          ),
        600000
      )
    ),
  ]);

  return result;
}
