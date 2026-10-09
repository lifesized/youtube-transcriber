/**
 * Transcript cache layer.
 * 
 * Provides cache-aware transcript lookup and creation keyed by
 * (videoId, captionLanguage, pipelineVersion).
 * 
 * Every transcription path (API, extension, future Tusk/watchlist)
 * should use getOrCreateTranscript() to check the cache before
 * fetching from YouTube or running Whisper.
 */

import { prisma } from "./prisma";
import { getVideoTranscript } from "./transcript";
import { PIPELINE_VERSION, normalizeCaptionLanguage } from "./transcript-pipeline";
import type { VideoTranscriptResult } from "./types";

export interface CachedTranscript {
  id: string;
  videoId: string;
  captionLanguage: string;
  pipelineVersion: number;
  title: string;
  author: string;
  channelUrl: string | null;
  thumbnailUrl: string | null;
  videoUrl: string;
  transcript: string; // JSON stringified TranscriptSegment[]
  source: string;
  platform: string;
  baseSummary: string | null;
  summaryPromptVersion: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Get or create a transcript for a video with proper cache keying.
 * 
 * Cache key: (videoId, captionLanguage, pipelineVersion)
 * 
 * If a cached entry exists for this exact cache key and has a non-empty
 * transcript, returns it immediately (cache hit).
 * 
 * Otherwise, fetches/transcribes the video and stores a new cache entry
 * (cache miss).
 * 
 * @param videoId - YouTube video ID (e.g. "dQw4w9WgXcQ")
 * @param url - Full video URL (for fetching if cache miss)
 * @param lang - Caption language preference (e.g. "es,en" or "fr")
 * @param platform - Platform (default: "youtube")
 * @returns Cached or newly created transcript record
 */
export type TranscriptFetcher = (
  url: string,
  lang?: string
) => Promise<VideoTranscriptResult & { source?: string }>;

export async function getOrCreateTranscript(
  videoId: string,
  url: string,
  lang?: string,
  platform: string = "youtube",
  options?: {
    fetcher?: TranscriptFetcher;
    pipelineVersion?: number;
    allowBrowserCookies?: boolean;
  }
): Promise<CachedTranscript> {
  const captionLanguage = normalizeCaptionLanguage(lang);
  const pipelineVersion = options?.pipelineVersion ?? PIPELINE_VERSION;

  // Check cache
  const cached = await prisma.video.findUnique({
    where: {
      videoId_captionLanguage_pipelineVersion: {
        videoId,
        captionLanguage,
        pipelineVersion,
      },
    },
  });

  if (cached) {
    const transcript = cached.transcript;
    const hasTranscript = transcript && transcript !== "[]";
    if (hasTranscript) {
      // Cache hit
      return cached as CachedTranscript;
    }
    // Cached entry has empty transcript — re-fetch and update below
  }

  // Cache miss — fetch/transcribe
  const fetchTranscript =
    options?.fetcher ??
    ((href, language) =>
      getVideoTranscript(href, language, {
        allowBrowserCookies: options?.allowBrowserCookies,
      }));
  const result = await fetchTranscript(url, lang);

  const data = {
    videoId,
    captionLanguage,
    pipelineVersion,
    title: result.title,
    author: result.author,
    channelUrl: result.channelUrl,
    thumbnailUrl: result.thumbnailUrl || (platform === "youtube" ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : ""),
    videoUrl: url,
    transcript: JSON.stringify(result.transcript),
    source: result.source,
    platform,
  };

  if (cached) {
    // Update existing entry
    const updated = await prisma.video.update({
      where: {
        videoId_captionLanguage_pipelineVersion: {
          videoId,
          captionLanguage,
          pipelineVersion,
        },
      },
      data,
    });
    return updated as CachedTranscript;
  } else {
    // Create new entry
    const created = await prisma.video.create({ data });
    return created as CachedTranscript;
  }
}

/**
 * Check if a transcript exists in cache for the given key.
 * 
 * @param videoId - YouTube video ID
 * @param lang - Caption language preference
 * @returns true if cached and has non-empty transcript
 */
export async function hasCachedTranscript(
  videoId: string,
  lang?: string
): Promise<boolean> {
  const captionLanguage = normalizeCaptionLanguage(lang);
  const pipelineVersion = PIPELINE_VERSION;

  const cached = await prisma.video.findUnique({
    where: {
      videoId_captionLanguage_pipelineVersion: {
        videoId,
        captionLanguage,
        pipelineVersion,
      },
    },
    select: { transcript: true },
  });

  if (!cached) return false;
  const transcript = cached.transcript;
  return !!(transcript && transcript !== "[]");
}

/**
 * Get cached base summary for a transcript, if available and current.
 * 
 * Returns null if:
 * - No cached transcript exists
 * - No base summary cached
 * - Cached summary is for an old prompt version
 * 
 * @param videoId - YouTube video ID
 * @param lang - Caption language preference
 * @param promptVersion - Current summary prompt version
 * @returns Cached base summary text or null
 */
export async function getCachedBaseSummary(
  videoId: string,
  lang: string | undefined,
  promptVersion: number
): Promise<string | null> {
  const captionLanguage = normalizeCaptionLanguage(lang);
  const pipelineVersion = PIPELINE_VERSION;

  const cached = await prisma.video.findUnique({
    where: {
      videoId_captionLanguage_pipelineVersion: {
        videoId,
        captionLanguage,
        pipelineVersion,
      },
    },
    select: {
      baseSummary: true,
      summaryPromptVersion: true,
    },
  });

  if (!cached || !cached.baseSummary) return null;
  if (cached.summaryPromptVersion !== promptVersion) return null;

  return cached.baseSummary;
}

/**
 * Store a base summary for a transcript.
 * 
 * @param videoId - YouTube video ID
 * @param lang - Caption language preference
 * @param promptVersion - Summary prompt version
 * @param summary - Base summary text
 */
export async function cacheBaseSummary(
  videoId: string,
  lang: string | undefined,
  promptVersion: number,
  summary: string
): Promise<void> {
  const captionLanguage = normalizeCaptionLanguage(lang);
  const pipelineVersion = PIPELINE_VERSION;

  await prisma.video.update({
    where: {
      videoId_captionLanguage_pipelineVersion: {
        videoId,
        captionLanguage,
        pipelineVersion,
      },
    },
    data: {
      baseSummary: summary,
      summaryPromptVersion: promptVersion,
    },
  });
}
