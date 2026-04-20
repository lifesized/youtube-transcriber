import path from "path";
import os from "os";
import { promises as fs } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { extractVideoId } from "./youtube";
import { parseContentUrl } from "./url-parser";
import { getSpotifyTranscript } from "./spotify";
import { getGenericTranscript } from "./generic-video";
import { transcribeWithWhisper, downloadAudio, type ProgressCallback, getYtdlpPath } from "./whisper";
import { transcribeWithCloudWhisper, getCloudWhisperConfig } from "./whisper-cloud";
import { isWhisperEnabled, getWhisperPriority, getEnabledProviders, transcribeWithProvider } from "./providers";
import { transcriptionProgress } from "./progress";

const execFileAsync = promisify(execFile);
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
 * Get preferred caption languages from env var or parameter.
 * Returns an array of language codes, e.g. ["en", "zh-Hans", "zh-Hant"].
 * Defaults to ["en"] if not configured.
 */
function getCaptionLangs(langOverride?: string): string[] {
  const raw = langOverride || process.env.YTT_CAPTION_LANGS || "en";
  return raw.split(",").map((l) => l.trim()).filter(Boolean);
}

/**
 * Select the best caption track from a list of tracks.
 * Tries preferred languages in order (manual first, then auto-generated).
 * Falls back to first available if no preferred language is found.
 */
function selectCaptionTrack(
  captionTracks: Array<{ vssId?: string; languageCode?: string; baseUrl: string }>,
  preferredLangs?: string[]
): { vssId?: string; baseUrl: string } {
  const langs = preferredLangs ?? getCaptionLangs();

  for (const lang of langs) {
    // Try manual track (vssId like ".en" or languageCode match)
    const manual = captionTracks.find(
      (t) => t.vssId === `.${lang}` || t.languageCode === lang
    );
    if (manual) return manual;
    // Try auto-generated track (vssId like "a.en")
    const auto = captionTracks.find((t) => t.vssId === `a.${lang}`);
    if (auto) return auto;
  }

  return captionTracks[0];
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
  videoId: string,
  lang?: string
): Promise<TranscriptSegment[]> {
  const playerPayload = {
    context: {
      client: {
        hl: "en",
        gl: "US",
        clientName: "ANDROID",
        clientVersion: "19.47.53",
        androidSdkVersion: 34,
        userAgent:
          "com.google.android.youtube/19.47.53 (Linux; U; Android 14) gzip",
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
          "com.google.android.youtube/19.47.53 (Linux; U; Android 14) gzip",
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

  const track = selectCaptionTrack(captionTracks, lang ? getCaptionLangs(lang) : undefined);

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
  videoId: string,
  lang?: string
): Promise<TranscriptSegment[]> {
  console.log(`[transcript] Trying WEB InnerTube client for ${videoId}...`);

  const playerPayload = {
    context: {
      client: {
        hl: "en",
        gl: "US",
        clientName: "WEB",
        clientVersion: "2.20250312.04.00",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
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
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
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

  const track = selectCaptionTrack(captionTracks, lang ? getCaptionLangs(lang) : undefined);

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
  videoId: string,
  lang?: string
): Promise<TranscriptSegment[]> {
  console.log(
    `[transcript] ANDROID client blocked (rate-limit or bot detection), trying WEB fallback for ${videoId}...`
  );

  const watchRes = await fetchWithRetry(
    `https://www.youtube.com/watch?v=${videoId}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
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
    | { playerCaptionsTracklistRenderer?: { captionTracks?: Array<{ vssId?: string; languageCode?: string; baseUrl: string }> } }
    | undefined;
  const captionTracks = captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    throw new NoCaptionsError(
      `Captions are disabled for video ${videoId}. The video owner has turned off captions.`
    );
  }

  const track = selectCaptionTrack(captionTracks, lang ? getCaptionLangs(lang) : undefined);

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
 * Audio transcription fallback — respects user-defined priority order.
 * Local Whisper and cloud providers are interleaved based on their priority.
 * Called when YouTube captions are unavailable.
 */
async function transcribeAudioFallback(
  videoId: string
): Promise<{ segments: TranscriptSegment[]; source: string }> {
  const [whisperEnabled, whisperPriority, providers] = await Promise.all([
    isWhisperEnabled(),
    getWhisperPriority(),
    getEnabledProviders(),
  ]);

  // Build a unified ordered list of steps
  type Step = { type: "local" } | { type: "cloud"; index: number };
  const steps: Step[] = [];

  for (let i = 0; i < providers.length; i++) {
    steps.push({ type: "cloud", index: i });
  }
  if (whisperEnabled) {
    steps.push({ type: "local" });
  }

  // Sort by priority: cloud providers use their array index (already sorted by DB priority),
  // local whisper uses its stored priority position
  steps.sort((a, b) => {
    const pa = a.type === "local" ? whisperPriority : a.index;
    const pb = b.type === "local" ? whisperPriority : b.index;
    return pa - pb;
  });

  if (steps.length === 0) {
    throw new Error(
      "No transcription services enabled. Turn on at least one provider in Settings."
    );
  }

  const errors: string[] = [];
  let audioPath: string | null = null;

  for (const step of steps) {
    if (step.type === "local") {
      try {
        console.log(`[transcript] Trying local Whisper for ${videoId}...`);
        transcriptionProgress.emit("progress", {
          stage: "downloading",
          progress: 15,
          statusText: "Downloading audio from YouTube...",
          videoId,
        });
        const segments = await transcribeWithWhisper(videoId, "base", (evt) => {
          if (evt.stage === "transcribing") {
            transcriptionProgress.emit("progress", {
              stage: "transcribing",
              progress: 40,
              statusText: "Transcribing audio with Whisper...",
              videoId,
            });
          } else if (evt.stage === "diarizing") {
            transcriptionProgress.emit("progress", {
              stage: "diarizing",
              progress: 85,
              statusText: "Identifying speakers...",
              videoId,
            });
          }
        });
        // Clean up cloud audio file if we downloaded one
        if (audioPath) await fs.unlink(audioPath).catch(() => {});
        return { segments, source: "whisper_local" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[transcript] Local Whisper failed: ${msg}`);
        errors.push(`local-whisper: ${msg}`);
      }
    } else {
      const config = providers[step.index];
      try {
        // Download audio once for all cloud providers
        if (!audioPath) {
          transcriptionProgress.emit("progress", {
            stage: "downloading",
            progress: 15,
            statusText: "Downloading audio from YouTube...",
            videoId,
          });
          const audioDir = path.join("/tmp", "yt-audio");
          audioPath = await downloadAudio(videoId, audioDir);
        }
        transcriptionProgress.emit("progress", {
          stage: "transcribing",
          progress: 40,
          statusText: `Transcribing with ${config.provider}...`,
          videoId,
        });
        const result = await transcribeWithProvider(audioPath, config);
        await fs.unlink(audioPath).catch(() => {});
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[transcript] ${config.provider} failed: ${msg}`);
        errors.push(`${config.provider}: ${msg}`);
      }
    }
  }

  // Clean up
  if (audioPath) await fs.unlink(audioPath).catch(() => {});

  throw new Error(
    `All transcription methods failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`
  );
}

/**
 * Parse a WebVTT (.vtt) file into TranscriptSegment[].
 * Handles cue timestamps like "00:01:23.456 --> 00:01:26.789".
 */
function parseVtt(vtt: string): TranscriptSegment[] {
  const rawSegments: TranscriptSegment[] = [];
  const cueRegex = /(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})[^\n]*\n([\s\S]*?)(?=\n\n|\n\d{2}:\d{2}:\d{2}|$)/g;
  let match;

  while ((match = cueRegex.exec(vtt)) !== null) {
    const startMs = vttTimestampToMs(match[1]);
    const endMs = vttTimestampToMs(match[2]);

    // Skip near-zero-duration "holding" cues (≤10ms) from YouTube auto-captions.
    // These are transitional cues that duplicate the previous line's text.
    if (endMs - startMs <= 10) continue;

    // Decode HTML entities first, then strip VTT/XML tags and clean up
    const text = decodeEntities(match[3])
      .replace(/&nbsp;/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/^.*-->.*$/gm, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (text) {
      rawSegments.push({ text, startMs, durationMs: endMs - startMs });
    }
  }

  // Deduplicate: YouTube auto-generated VTT captions produce overlapping/rolling
  // cues where each line appears multiple times with slightly different timestamps.
  // 1. Remove consecutive segments with identical text
  const deduped: TranscriptSegment[] = [];
  for (const seg of rawSegments) {
    if (deduped.length === 0 || seg.text !== deduped[deduped.length - 1].text) {
      deduped.push(seg);
    }
  }

  // 2. Remove rolling overlap: YouTube auto-captions produce two-line cues where
  //    each cue repeats the tail of the previous cue. Strip the repeated prefix.
  const segments: TranscriptSegment[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const seg = deduped[i];
    if (i === 0) {
      segments.push(seg);
      continue;
    }
    const prev = deduped[i - 1];
    // Check if current text starts with previous text (full containment)
    if (seg.text.startsWith(prev.text)) {
      const newText = seg.text.slice(prev.text.length).trim();
      if (newText) {
        segments.push({ text: newText, startMs: seg.startMs, durationMs: seg.durationMs });
      }
      continue;
    }
    // Check for partial suffix/prefix overlap (prev tail = curr head)
    let overlapLen = 0;
    const minLen = Math.min(prev.text.length, seg.text.length);
    for (let len = minLen; len > 10; len--) {
      if (seg.text.startsWith(prev.text.slice(-len))) {
        overlapLen = len;
        break;
      }
    }
    if (overlapLen > 0) {
      const newText = seg.text.slice(overlapLen).trim();
      if (newText) {
        segments.push({ text: newText, startMs: seg.startMs, durationMs: seg.durationMs });
      }
    } else {
      segments.push(seg);
    }
  }

  return segments;
}

function vttTimestampToMs(ts: string): number {
  const [h, m, s] = ts.split(":");
  const [sec, ms] = s.split(".");
  return parseInt(h) * 3600000 + parseInt(m) * 60000 + parseInt(sec) * 1000 + parseInt(ms);
}

/**
 * Fetch subtitles using yt-dlp --write-auto-subs.
 * This leverages yt-dlp's PO token plugin ecosystem to access
 * auto-generated captions that require BotGuard attestation.
 */
async function fetchSubtitlesViaYtdlp(
  videoId: string,
  lang?: string
): Promise<TranscriptSegment[]> {
  const ytdlpPath = getYtdlpPath();
  const langs = lang ? getCaptionLangs(lang) : getCaptionLangs();
  const subLang = langs[0] || "en";
  const tmpDir = path.join(os.tmpdir(), "yt-subs");
  await fs.mkdir(tmpDir, { recursive: true });

  const outputTemplate = path.join(tmpDir, videoId);

  // Clean up any previous subtitle files for this video
  const cleanup = async () => {
    try {
      const files = await fs.readdir(tmpDir);
      for (const f of files) {
        if (f.startsWith(videoId)) {
          await fs.unlink(path.join(tmpDir, f)).catch(() => {});
        }
      }
    } catch {}
  };
  await cleanup();

  const args = [
    "--write-auto-subs",
    "--write-subs",
    "--sub-lang", subLang,
    "--sub-format", "vtt",
    "--skip-download",
    "--no-playlist",
    "-o", outputTemplate,
    `https://www.youtube.com/watch?v=${videoId}`,
  ];

  console.log(`[transcript] Trying yt-dlp subtitle download for ${videoId} (lang: ${subLang})...`);

  try {
    const { stderr } = await execFileAsync(ytdlpPath, args, { timeout: 30000 });
    if (stderr) {
      console.log(`[transcript] yt-dlp subs stderr: ${stderr.slice(0, 500)}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[transcript] yt-dlp subtitle download failed: ${msg.slice(0, 300)}`);
    await cleanup();
    throw new Error(`yt-dlp subtitle download failed: ${msg.slice(0, 300)}`);
  }

  // Look for the downloaded subtitle file (.vtt)
  const files = await fs.readdir(tmpDir);
  const subFile = files.find(
    (f) => f.startsWith(videoId) && f.endsWith(".vtt")
  );

  if (!subFile) {
    await cleanup();
    throw new NoCaptionsError(
      `yt-dlp found no subtitle files for video ${videoId}.`
    );
  }

  const vttContent = await fs.readFile(path.join(tmpDir, subFile), "utf-8");
  await cleanup();

  const segments = parseVtt(vttContent);
  if (segments.length === 0) {
    throw new NoCaptionsError(
      `yt-dlp downloaded subtitles for ${videoId} but they were empty.`
    );
  }

  console.log(`[transcript] yt-dlp subtitles: ${segments.length} segments from ${subFile}`);
  return segments;
}

// InnerTube methods are disabled by default — YouTube requires PO tokens as of March 2026.
// Set YTT_INNERTUBE_ENABLED=1 to re-enable if YouTube relaxes enforcement.
const INNERTUBE_ENABLED = process.env.YTT_INNERTUBE_ENABLED === "1";

/**
 * Fetch time-coded transcript segments for a YouTube video.
 * Caption methods race in parallel via Promise.any — fastest wins:
 *   - WEB page scrape (works for manually uploaded captions)
 *   - yt-dlp subtitle download (handles auto-captions via PO tokens)
 *   - [disabled] ANDROID / WEB InnerTube (broken without PO tokens since March 2026)
 * If all caption methods fail, fall back to Cloud Whisper / Local Whisper.
 */
async function fetchTranscript(
  videoId: string,
  lang?: string
): Promise<{ segments: TranscriptSegment[]; source: string }> {
  type CaptionResult = { segments: TranscriptSegment[]; source: string };

  transcriptionProgress.emit("progress", {
    stage: "fetching_captions",
    progress: 5,
    statusText: "Checking all YouTube caption sources...",
    videoId,
  });

  const attempt = (
    label: string,
    source: string,
    fn: () => Promise<TranscriptSegment[]>
  ): Promise<CaptionResult> =>
    fn().then(
      (segments) => ({ segments, source }),
      (err) => {
        if (!(err instanceof NoCaptionsError)) {
          console.log(
            `[transcript] ${label} failed for ${videoId}: ${err instanceof Error ? err.message : err}`
          );
        }
        throw err;
      }
    );

  const attempts: Promise<CaptionResult>[] = [
    attempt("WEB scrape", "youtube_captions", () =>
      fetchTranscriptWebFallback(videoId, lang)
    ),
    attempt("yt-dlp subtitles", "youtube_captions_ytdlp", () =>
      fetchSubtitlesViaYtdlp(videoId, lang)
    ),
  ];

  if (INNERTUBE_ENABLED) {
    attempts.push(
      attempt("ANDROID client", "youtube_captions", () =>
        fetchTranscriptAndroid(videoId, lang)
      ),
      attempt("WEB InnerTube", "youtube_captions", () =>
        fetchTranscriptWebClient(videoId, lang)
      )
    );
  }

  try {
    return await Promise.any(attempts);
  } catch {
    console.log(
      `[transcript] All caption methods failed for ${videoId}, falling back to audio transcription...`
    );
    return await transcribeAudioFallback(videoId);
  }
}

/**
 * Fetch the full transcript and metadata for a YouTube video.
 *
 * @param url - A YouTube video URL (watch, short, embed, youtu.be)
 * @returns Structured result with metadata + time-coded transcript + source
 */
export async function getVideoTranscript(
  url: string,
  lang?: string
): Promise<VideoTranscriptResult & { source: string }> {
  const parsed = parseContentUrl(url);

  if (parsed.platform === "spotify") {
    return getSpotifyTranscript(parsed.contentId, parsed.originalUrl);
  }

  if (parsed.platform === "generic") {
    return getGenericTranscript(parsed.originalUrl);
  }

  const videoId = parsed.contentId;

  // Use a longer timeout when Whisper fallback might be needed (up to 10 minutes)
  const result = await Promise.race([
    (async () => {
      const [metadata, transcriptResult] = await Promise.all([
        fetchMetadata(videoId),
        fetchTranscript(videoId, lang),
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

  transcriptionProgress.emit("progress", {
    stage: "done",
    progress: 100,
    statusText: "Transcription complete",
    videoId,
  });

  return result;
}
