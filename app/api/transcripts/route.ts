import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseContentUrl } from "@/lib/url-parser";
import {
  getVideoTranscript,
  fetchMetadata,
  RateLimitError,
  BotDetectionError,
  NoCaptionsError,
} from "@/lib/transcript";
import { isTranscriptionInProgress } from "@/lib/whisper";
import { parseRequestLimit } from "@/lib/request-limit";

type ClientSegment = { start: number; duration?: number; text: string };

function cleanSuppliedMetadata(value: unknown, maxLen: number): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLen)
    : "";
}

function isSpotifyUrl(value: string): boolean {
  try {
    return new URL(value).hostname.replace(/^www\./, "") === "open.spotify.com";
  } catch {
    return false;
  }
}

function isGenericSpotifyTitle(value: string): boolean {
  return /^spotify\s*[-–]\s*web player$/i.test(value.trim());
}

function cleanSuppliedTitle(value: unknown, maxLen: number, sourceUrl: string): string {
  const cleaned = cleanSuppliedMetadata(value, maxLen);
  if (cleaned && isSpotifyUrl(sourceUrl) && isGenericSpotifyTitle(cleaned)) {
    return "";
  }
  return cleaned;
}

function cleanSuppliedHttpUrl(value: unknown, maxLen: number): string {
  const cleaned = cleanSuppliedMetadata(value, maxLen);
  if (!cleaned) return "";
  try {
    const parsed = new URL(cleaned);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? cleaned : "";
  } catch {
    return "";
  }
}

function preferRealMetadata(metaValue: string | null | undefined, suppliedValue: string): string {
  const normalized = metaValue?.trim();
  if (!normalized || normalized.toLowerCase() === "unknown") return suppliedValue;
  return normalized;
}

function isValidClientSegments(value: unknown): value is ClientSegment[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (s) =>
      s &&
      typeof s === "object" &&
      typeof (s as ClientSegment).start === "number" &&
      typeof (s as ClientSegment).text === "string"
  );
}

export async function POST(request: NextRequest) {
  let body: {
    url?: string;
    pageUrl?: string;
    videoId?: string;
    lang?: string;
    segments?: unknown;
    title?: string;
    author?: string;
    channelUrl?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { lang } = body;
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json(
      { error: "A YouTube or Spotify URL is required" },
      { status: 400 }
    );
  }

  let videoId: string;
  let platform: string;
  try {
    const parsed = parseContentUrl(url);
    videoId = parsed.contentId;
    platform = parsed.platform;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid URL";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const suppliedVideoId =
    typeof body.videoId === "string" && /^[A-Za-z0-9_:-]{1,160}$/.test(body.videoId)
      ? body.videoId
      : "";
  const host = new URL(url).hostname.replace(/^www\./, "");
  const isLinkedInSource =
    host === "linkedin.com" || host === "licdn.com" || host.endsWith(".licdn.com");
  const isTwitterSource =
    host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com";
  const useSuppliedGenericVideoId =
    platform === "generic" &&
    ((isLinkedInSource && suppliedVideoId.startsWith("linkedin:")) ||
      (isTwitterSource && suppliedVideoId.startsWith("twitter:")));
  if (useSuppliedGenericVideoId) {
    videoId = suppliedVideoId;
  }

  // Duplicate detection: return existing record if already saved and has a non-empty transcript
  const existing = await prisma.video.findUnique({ where: { videoId } });
  if (existing) {
    const transcript = existing.transcript as string;
    const hasTranscript = transcript && transcript !== "[]";
    if (hasTranscript) {
      const suppliedTitle = cleanSuppliedTitle(body.title, 512, url);
      const suppliedAuthor = cleanSuppliedMetadata(body.author, 256);
      const suppliedChannelUrl = cleanSuppliedMetadata(body.channelUrl, 1024);
      const suppliedPageUrl = cleanSuppliedHttpUrl(body.pageUrl, 2048);
      const nextData = {
        title: suppliedTitle || existing.title,
        author: suppliedAuthor || existing.author,
        channelUrl: suppliedChannelUrl || existing.channelUrl,
        videoUrl: suppliedPageUrl || existing.videoUrl,
      };
      const shouldUpdate =
        nextData.title !== existing.title ||
        nextData.author !== existing.author ||
        nextData.channelUrl !== existing.channelUrl ||
        nextData.videoUrl !== existing.videoUrl;
      const video = shouldUpdate
        ? await prisma.video.update({ where: { videoId }, data: nextData })
        : existing;
      return NextResponse.json({ ...video, duplicate: true });
    }
    // Existing record has empty transcript — re-fetch and update below
  }

  // Client-supplied segments (extension panel-scrape fast path). Skip
  // yt-dlp / Whisper entirely — pull metadata via oEmbed (~200ms) and
  // persist the supplied transcript. This is what makes cloud match local
  // speed: no Railway worker hop, no audio download, no transcription job.
  if (platform === "youtube" && isValidClientSegments(body.segments)) {
    const normalized = body.segments.map((s) => ({
      text: s.text,
      startMs: Math.round(s.start * 1000),
      durationMs: Math.round((s.duration ?? 0) * 1000),
    }));
    const suppliedAuthor = cleanSuppliedMetadata(body.author, 256);
    const suppliedChannelUrl = cleanSuppliedMetadata(body.channelUrl, 1024);
    try {
      const meta = await fetchMetadata(videoId);
      const data = {
        videoId,
        title: body.title || meta.title,
        author: preferRealMetadata(meta.author, suppliedAuthor),
        channelUrl: preferRealMetadata(meta.channelUrl, suppliedChannelUrl),
        thumbnailUrl: meta.thumbnailUrl,
        videoUrl: url,
        transcript: JSON.stringify(normalized),
        source: "client_panel_scrape",
        platform,
      };
      const video = existing
        ? await prisma.video.update({ where: { videoId }, data })
        : await prisma.video.create({ data });
      return NextResponse.json(video, { status: existing ? 200 : 201 });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("not found")) {
        console.warn("[transcripts] client-segment fast path metadata not found", err);
      } else {
        console.warn("[transcripts] client-segment fast path metadata failed", err);
        const data = {
          videoId,
          title:
            typeof body.title === "string" && body.title.trim()
              ? body.title.trim().slice(0, 512)
              : "Untitled",
          author: suppliedAuthor,
          channelUrl: suppliedChannelUrl,
          thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          videoUrl: url,
          transcript: JSON.stringify(normalized),
          source: "client_panel_scrape",
          platform,
        };
        const video = existing
          ? await prisma.video.update({ where: { videoId }, data })
          : await prisma.video.create({ data });
        return NextResponse.json(video, { status: existing ? 200 : 201 });
      }
    }
  }

  if (isTranscriptionInProgress()) {
    return NextResponse.json(
      { error: "A transcription is already in progress. Please wait and try again." },
      { status: 429 }
    );
  }

  try {
    const result = await getVideoTranscript(url, lang);
    const suppliedTitle = cleanSuppliedTitle(body.title, 512, url);
    const suppliedAuthor = cleanSuppliedMetadata(body.author, 256);
    const suppliedChannelUrl = cleanSuppliedMetadata(body.channelUrl, 1024);
    const suppliedPageUrl = cleanSuppliedHttpUrl(body.pageUrl, 2048);
    const persistedPlatform =
      videoId.startsWith("linkedin:") ? "linkedin" : videoId.startsWith("twitter:") ? "twitter" : platform;
    const title = useSuppliedGenericVideoId
      ? suppliedTitle || result.title
      : preferRealMetadata(result.title, suppliedTitle);
    const author = useSuppliedGenericVideoId
      ? suppliedAuthor || result.author
      : preferRealMetadata(result.author, suppliedAuthor);
    const channelUrl = useSuppliedGenericVideoId
      ? suppliedChannelUrl || result.channelUrl
      : preferRealMetadata(result.channelUrl, suppliedChannelUrl);

    const data = {
      videoId: useSuppliedGenericVideoId ? suppliedVideoId : result.videoId,
      title,
      author,
      channelUrl,
      thumbnailUrl: result.thumbnailUrl || (platform === "youtube" ? `https://i.ytimg.com/vi/${result.videoId}/hqdefault.jpg` : ""),
      videoUrl: suppliedPageUrl || url,
      transcript: JSON.stringify(result.transcript),
      source: result.source,
      platform: persistedPlatform,
    };

    const video = existing
      ? await prisma.video.update({ where: { videoId }, data })
      : await prisma.video.create({ data });

    return NextResponse.json(video, { status: existing ? 200 : 201 });
  } catch (err: unknown) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        {
          error:
            "YouTube is temporarily rate-limiting requests. Please wait a moment and try again.",
        },
        { status: 429 }
      );
    }

    if (err instanceof BotDetectionError) {
      return NextResponse.json(
        {
          error:
            "YouTube is detecting automated requests from your network. This commonly happens with VPN or datacenter IPs. Try disabling your VPN or connecting to a different server.",
        },
        { status: 403 }
      );
    }

    const message = err instanceof Error ? err.message : "Unknown error";

    if (
      message.includes("disabled") ||
      message.includes("Captions are disabled") ||
      message.includes("not found") ||
      message.includes("unavailable")
    ) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    if (message.includes("No transcription services enabled")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (
      message.includes("does not include an audio track") ||
      message.includes("nothing to transcribe")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json(
      { error: `Failed to fetch transcript: ${message}` },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  const videoId = request.nextUrl.searchParams.get("videoId")?.trim();
  const parsedLimit = parseRequestLimit(request.nextUrl.searchParams.get("limit"));
  if (!parsedLimit.ok) {
    return NextResponse.json(
      { error: "limit must be a positive integer" },
      { status: 400 }
    );
  }
  const limit = parsedLimit.value;

  const filters = [];
  if (q) {
    filters.push({
      OR: [
        { title: { contains: q } },
        { author: { contains: q } },
      ],
    });
  }
  if (videoId) filters.push({ videoId });

  const videos = await prisma.video.findMany({
    where: filters.length ? { AND: filters } : undefined,
    select: {
      id: true,
      videoId: true,
      title: true,
      author: true,
      channelUrl: true,
      thumbnailUrl: true,
      videoUrl: true,
      source: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(videos);
}
