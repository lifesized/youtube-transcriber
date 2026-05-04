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

type ClientSegment = { start: number; duration?: number; text: string };

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
    lang?: string;
    segments?: unknown;
    title?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { url, lang } = body;
  if (!url || typeof url !== "string") {
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

  // Duplicate detection: return existing record if already saved and has a non-empty transcript
  const existing = await prisma.video.findUnique({ where: { videoId } });
  if (existing) {
    const transcript = existing.transcript as string;
    const hasTranscript = transcript && transcript !== "[]";
    if (hasTranscript) {
      return NextResponse.json({ ...existing, duplicate: true });
    }
    // Existing record has empty transcript — re-fetch and update below
  }

  // Client-supplied segments (extension panel-scrape fast path). Skip
  // yt-dlp / Whisper entirely — pull metadata via oEmbed (~200ms) and
  // persist the supplied transcript. This is what makes cloud match local
  // speed: no Railway worker hop, no audio download, no transcription job.
  if (platform === "youtube" && isValidClientSegments(body.segments)) {
    try {
      const meta = await fetchMetadata(videoId);
      // Normalize extension's seconds-based shape to the canonical
      // {text, startMs, durationMs} stored everywhere else (lib/types.ts,
      // download/summarize routes, app/page.tsx all read startMs/durationMs).
      const normalized = body.segments.map((s) => ({
        text: s.text,
        startMs: Math.round(s.start * 1000),
        durationMs: Math.round((s.duration ?? 0) * 1000),
      }));
      const data = {
        videoId,
        title: body.title || meta.title,
        author: meta.author,
        channelUrl: meta.channelUrl,
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
      // Fall through to the server fetch path on metadata failure rather
      // than failing the whole request — the supplied segments are still
      // valid, but we need title/thumbnail before persisting.
      console.warn("[transcripts] client-segment fast path metadata failed", err);
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

    const data = {
      videoId: result.videoId,
      title: result.title,
      author: result.author,
      channelUrl: result.channelUrl,
      thumbnailUrl: result.thumbnailUrl || (platform === "youtube" ? `https://i.ytimg.com/vi/${result.videoId}/hqdefault.jpg` : ""),
      videoUrl: url,
      transcript: JSON.stringify(result.transcript),
      source: result.source,
      platform,
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

    return NextResponse.json(
      { error: `Failed to fetch transcript: ${message}` },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();

  const videos = await prisma.video.findMany({
    where: q
      ? {
          OR: [
            { title: { contains: q } },
            { author: { contains: q } },
          ],
        }
      : undefined,
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
  });

  return NextResponse.json(videos);
}
