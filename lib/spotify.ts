import path from "path";
import { promises as fs } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import type { TranscriptSegment, VideoMetadata, VideoTranscriptResult } from "./types";
import { transcriptionProgress } from "./progress";
import { isWhisperEnabled, getWhisperPriority, getEnabledProviders, transcribeWithProvider } from "./providers";
import { transcribeAudioFileWithWhisper } from "./whisper";

const execFileAsync = promisify(execFile);
const FFMPEG_PATH = process.env.FFMPEG_PATH?.trim() || "ffmpeg";

// Groq/OpenAI Whisper APIs cap uploads at 25MB. Re-encode anything larger
// to mono 48kbps MP3 (plenty for speech) so long podcasts fit.
const CLOUD_UPLOAD_LIMIT_BYTES = 24 * 1024 * 1024;

async function reencodeForCloud(inputPath: string, episodeId: string): Promise<string> {
  const outputPath = path.join(path.dirname(inputPath), `${episodeId}.compressed.mp3`);
  await fs.unlink(outputPath).catch(() => {});

  console.log(`[spotify] Re-encoding audio to 48kbps mono for cloud upload...`);
  await execFileAsync(FFMPEG_PATH, [
    "-y",
    "-i", inputPath,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-b:a", "48k",
    "-f", "mp3",
    outputPath,
  ], { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 });

  const { size } = await fs.stat(outputPath);
  console.log(`[spotify] Re-encoded to ${(size / 1024 / 1024).toFixed(1)} MB`);
  return outputPath;
}

// ---------------------------------------------------------------------------
// Spotify Web API — Client Credentials auth + metadata
// ---------------------------------------------------------------------------

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getSpotifyApiToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Spotify transcription requires API credentials. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to your .env file."
    );
  }

  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token;
  }

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(
      `Failed to authenticate with Spotify API (HTTP ${res.status}). Check your SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.`
    );
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.token;
}

interface SpotifyEpisodeData extends VideoMetadata {
  showName: string;
  durationMs: number;
  releaseDate: string;
  isExternallyHosted: boolean;
}

export async function fetchSpotifyMetadata(episodeId: string): Promise<SpotifyEpisodeData> {
  const token = await getSpotifyApiToken();

  const res = await fetch(
    `https://api.spotify.com/v1/episodes/${episodeId}?market=US`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    }
  );

  if (res.status === 404) {
    throw new Error(
      "Spotify episode not found — it may have been removed or is not available in your market."
    );
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After") || "30";
    throw new Error(
      `Spotify API rate limit hit. Try again in ${retryAfter} seconds.`
    );
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch Spotify episode metadata (HTTP ${res.status}).`);
  }

  const data = await res.json();

  return {
    videoId: episodeId,
    title: data.name ?? "Untitled Episode",
    author: data.show?.name ?? "Unknown Show",
    channelUrl: data.show?.external_urls?.spotify ?? "",
    thumbnailUrl: data.images?.[0]?.url ?? "",
    showName: data.show?.name ?? "",
    durationMs: data.duration_ms ?? 0,
    releaseDate: data.release_date ?? "",
    isExternallyHosted: data.show?.is_externally_hosted ?? true,
  };
}

// ---------------------------------------------------------------------------
// RSS feed discovery via iTunes Search API
// ---------------------------------------------------------------------------

interface RssFeedResult {
  feedUrl: string;
  collectionName: string;
}

async function findRssFeed(showName: string): Promise<RssFeedResult> {
  const query = encodeURIComponent(showName);
  const res = await fetch(
    `https://itunes.apple.com/search?term=${query}&media=podcast&entity=podcast&limit=10`,
    { signal: AbortSignal.timeout(10000) }
  );

  if (!res.ok) {
    throw new Error(`iTunes Search API failed (HTTP ${res.status}).`);
  }

  const data = await res.json();
  const results = data.results as Array<{
    collectionName: string;
    feedUrl?: string;
    artistName?: string;
  }>;

  if (!results || results.length === 0) {
    throw new Error(
      `Could not find a podcast feed for "${showName}". This podcast may be exclusive to Spotify.`
    );
  }

  // Try exact match first, then fuzzy
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalized = normalize(showName);

  const exact = results.find(
    (r) => r.feedUrl && normalize(r.collectionName) === normalized
  );
  if (exact?.feedUrl) {
    return { feedUrl: exact.feedUrl, collectionName: exact.collectionName };
  }

  // Fuzzy: find the closest match that has a feedUrl
  const withFeed = results.filter((r) => r.feedUrl);
  if (withFeed.length === 0) {
    throw new Error(
      `Found "${results[0].collectionName}" on iTunes but no RSS feed URL is available. This podcast may be exclusive to Spotify.`
    );
  }

  // Pick the one whose name is most similar
  const scored = withFeed.map((r) => ({
    ...r,
    score: normalize(r.collectionName).includes(normalized) ? 2
      : normalized.includes(normalize(r.collectionName)) ? 1
      : 0,
  }));
  scored.sort((a, b) => b.score - a.score);

  return {
    feedUrl: scored[0].feedUrl!,
    collectionName: scored[0].collectionName,
  };
}

// ---------------------------------------------------------------------------
// RSS feed parsing — find episode audio URL
// ---------------------------------------------------------------------------

interface RssEpisode {
  title: string;
  audioUrl: string;
  durationMs: number;
  pubDate: string;
}

function parseRssFeed(xml: string): RssEpisode[] {
  const episodes: RssEpisode[] = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];

    const title = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() ?? "";
    const enclosure = item.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*>/)?.[1] ?? "";
    const pubDate = item.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1]?.trim() ?? "";

    // Duration can be in <itunes:duration> as seconds or HH:MM:SS
    const durationRaw = item.match(/<itunes:duration>([^<]+)<\/itunes:duration>/)?.[1]?.trim() ?? "";
    let durationMs = 0;
    if (durationRaw.includes(":")) {
      const parts = durationRaw.split(":").map(Number);
      if (parts.length === 3) {
        durationMs = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
      } else if (parts.length === 2) {
        durationMs = (parts[0] * 60 + parts[1]) * 1000;
      }
    } else if (durationRaw) {
      durationMs = parseInt(durationRaw, 10) * 1000;
    }

    if (title && enclosure) {
      episodes.push({
        title: decodeXmlEntities(title),
        audioUrl: enclosure,
        durationMs,
        pubDate,
      });
    }
  }

  return episodes;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Match a Spotify episode to an RSS episode by title similarity and duration.
 */
function findMatchingEpisode(
  rssEpisodes: RssEpisode[],
  spotifyTitle: string,
  spotifyDurationMs: number
): RssEpisode | null {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = normalize(spotifyTitle);

  // Score each episode by title similarity + duration proximity
  const scored = rssEpisodes.map((ep) => {
    const epNorm = normalize(ep.title);
    let titleScore = 0;
    if (epNorm === target) titleScore = 100;
    else if (epNorm.includes(target) || target.includes(epNorm)) titleScore = 80;
    else {
      // Check word overlap
      const targetWords = new Set(target.match(/[a-z0-9]+/g) ?? []);
      const epWords = epNorm.match(/[a-z0-9]+/g) ?? [];
      const overlap = epWords.filter((w) => targetWords.has(w)).length;
      titleScore = targetWords.size > 0 ? (overlap / targetWords.size) * 60 : 0;
    }

    // Duration match bonus (within 10% = good match)
    let durationScore = 0;
    if (spotifyDurationMs > 0 && ep.durationMs > 0) {
      const ratio = Math.abs(ep.durationMs - spotifyDurationMs) / spotifyDurationMs;
      if (ratio < 0.02) durationScore = 20;
      else if (ratio < 0.05) durationScore = 15;
      else if (ratio < 0.10) durationScore = 10;
      else if (ratio < 0.20) durationScore = 5;
    }

    return { ...ep, score: titleScore + durationScore };
  });

  scored.sort((a, b) => b.score - a.score);

  // Require at least a decent title match
  if (scored[0] && scored[0].score >= 40) {
    return scored[0];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Audio download from RSS
// ---------------------------------------------------------------------------

async function downloadPodcastAudio(
  audioUrl: string,
  episodeId: string
): Promise<string> {
  const audioDir = path.join("/tmp", "podcast-audio");
  await fs.mkdir(audioDir, { recursive: true });

  // Determine extension from URL or default to mp3
  const urlPath = new URL(audioUrl).pathname;
  const ext = path.extname(urlPath) || ".mp3";
  const outputPath = path.join(audioDir, `${episodeId}${ext}`);

  // Clean up any existing file
  await fs.unlink(outputPath).catch(() => {});

  console.log(`[spotify] Downloading podcast audio from RSS: ${audioUrl.substring(0, 100)}...`);

  const res = await fetch(audioUrl, {
    signal: AbortSignal.timeout(600000), // 10 min timeout for large files
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download podcast audio (HTTP ${res.status}).`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outputPath, buffer);

  const sizeMb = (buffer.length / 1024 / 1024).toFixed(1);
  console.log(`[spotify] Downloaded ${sizeMb} MB to ${outputPath}`);

  return outputPath;
}

// ---------------------------------------------------------------------------
// Transcription — reuse existing provider pipeline
// ---------------------------------------------------------------------------

async function transcribeSpotifyAudio(
  audioPath: string,
  episodeId: string
): Promise<{ segments: TranscriptSegment[]; source: string }> {
  const [whisperEnabled, whisperPriority, providers] = await Promise.all([
    isWhisperEnabled(),
    getWhisperPriority(),
    getEnabledProviders(),
  ]);

  type Step = { type: "local" } | { type: "cloud"; index: number };
  const steps: Step[] = [];

  for (let i = 0; i < providers.length; i++) {
    steps.push({ type: "cloud", index: i });
  }
  if (whisperEnabled) {
    steps.push({ type: "local" });
  }

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
  let reencodedPath: string | null = null;

  try {
    for (const step of steps) {
      if (step.type === "cloud") {
        const config = providers[step.index];
        try {
          transcriptionProgress.emit("progress", {
            stage: "transcribing",
            progress: 50,
            statusText: `Transcribing with ${config.provider}...`,
            videoId: episodeId,
          });

          let uploadPath = audioPath;
          const { size } = await fs.stat(audioPath);
          if (size > CLOUD_UPLOAD_LIMIT_BYTES) {
            if (!reencodedPath) {
              reencodedPath = await reencodeForCloud(audioPath, episodeId);
            }
            uploadPath = reencodedPath;
          }

          const result = await transcribeWithProvider(uploadPath, config);
          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`[spotify] ${config.provider} failed: ${msg}`);
          errors.push(`${config.provider}: ${msg}`);
        }
      } else {
        try {
          console.log(`[spotify] Trying local Whisper for ${episodeId}...`);
          const segments = await transcribeAudioFileWithWhisper(audioPath, "base", (evt) => {
            transcriptionProgress.emit("progress", {
              stage: evt.stage,
              progress: evt.progress,
              statusText: evt.statusText,
              videoId: episodeId,
            });
          });
          return { segments, source: "local_whisper" };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`[spotify] local Whisper failed: ${msg}`);
          errors.push(`local-whisper: ${msg}`);
        }
      }
    }

    throw new Error(
      `All transcription methods failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  } finally {
    if (reencodedPath) {
      await fs.unlink(reencodedPath).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function getSpotifyTranscript(
  episodeId: string,
  originalUrl: string
): Promise<VideoTranscriptResult & { source: string; platform: string; videoUrl: string }> {
  // 1. Fetch metadata from Spotify API
  transcriptionProgress.emit("progress", {
    stage: "fetching_captions",
    progress: 5,
    statusText: "Fetching episode info from Spotify...",
    videoId: episodeId,
  });

  const metadata = await fetchSpotifyMetadata(episodeId);

  // 2. Find RSS feed via iTunes
  transcriptionProgress.emit("progress", {
    stage: "fetching_captions",
    progress: 10,
    statusText: "Finding podcast feed...",
    videoId: episodeId,
  });

  let rssFeed: RssFeedResult;
  try {
    rssFeed = await findRssFeed(metadata.showName);
  } catch {
    throw new Error(
      `Could not find a public RSS feed for "${metadata.showName}". This podcast may be exclusive to Spotify and cannot be transcribed.`
    );
  }

  console.log(`[spotify] Found RSS feed for "${rssFeed.collectionName}": ${rssFeed.feedUrl}`);

  // 3. Fetch and parse RSS feed
  transcriptionProgress.emit("progress", {
    stage: "fetching_captions",
    progress: 15,
    statusText: "Searching for episode in feed...",
    videoId: episodeId,
  });

  const feedRes = await fetch(rssFeed.feedUrl, {
    signal: AbortSignal.timeout(15000),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; YouTubeTranscriber/1.0)",
    },
  });

  if (!feedRes.ok) {
    throw new Error(`Failed to fetch RSS feed (HTTP ${feedRes.status}).`);
  }

  const feedXml = await feedRes.text();
  const rssEpisodes = parseRssFeed(feedXml);

  if (rssEpisodes.length === 0) {
    throw new Error("RSS feed is empty or could not be parsed.");
  }

  console.log(`[spotify] Parsed ${rssEpisodes.length} episodes from RSS feed`);

  // 4. Match Spotify episode to RSS episode
  const matched = findMatchingEpisode(rssEpisodes, metadata.title, metadata.durationMs);

  if (!matched) {
    throw new Error(
      `Could not find "${metadata.title}" in the podcast's RSS feed. The episode may be Spotify-exclusive or the feed may be outdated.`
    );
  }

  console.log(`[spotify] Matched: "${matched.title}" (${matched.audioUrl.substring(0, 80)}...)`);

  // 5. Download audio
  transcriptionProgress.emit("progress", {
    stage: "downloading",
    progress: 20,
    statusText: "Downloading podcast audio...",
    videoId: episodeId,
  });

  let audioPath: string;
  try {
    audioPath = await downloadPodcastAudio(matched.audioUrl, episodeId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to download podcast audio: ${msg}`);
  }

  // 6. Transcribe
  try {
    transcriptionProgress.emit("progress", {
      stage: "transcribing",
      progress: 40,
      statusText: "Transcribing podcast audio...",
      videoId: episodeId,
    });

    const { segments, source } = await transcribeSpotifyAudio(audioPath, episodeId);

    transcriptionProgress.emit("progress", {
      stage: "done",
      progress: 100,
      statusText: "Transcription complete",
      videoId: episodeId,
    });

    return {
      ...metadata,
      transcript: segments,
      source: `spotify_${source}`,
      platform: "spotify",
      videoUrl: originalUrl,
    };
  } finally {
    // Clean up audio file
    await fs.unlink(audioPath).catch(() => {});
  }
}
