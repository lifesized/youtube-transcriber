import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractVideoId } from "@/lib/youtube";
import { getVideoTranscript, RateLimitError, BotDetectionError, NoCaptionsError } from "@/lib/transcript";
import { isTranscriptionInProgress } from "@/lib/whisper";

export async function POST(request: NextRequest) {
  let body: { url?: string; lang?: string };
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
      { error: "A YouTube URL is required" },
      { status: 400 }
    );
  }

  let videoId: string;
  try {
    videoId = extractVideoId(url);
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
      thumbnailUrl: result.thumbnailUrl ?? `https://i.ytimg.com/vi/${result.videoId}/hqdefault.jpg`,
      videoUrl: url,
      transcript: JSON.stringify(result.transcript),
      source: result.source,
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
