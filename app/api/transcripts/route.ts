import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractVideoId } from "@/lib/youtube";
import { getVideoTranscript } from "@/lib/transcript";

export async function POST(request: NextRequest) {
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { url } = body;
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
      return NextResponse.json(existing);
    }
    // Existing record has empty transcript — re-fetch and update below
  }

  try {
    const result = await getVideoTranscript(url);

    const data = {
      videoId: result.videoId,
      title: result.title,
      author: result.author,
      channelUrl: result.channelUrl,
      thumbnailUrl: result.thumbnailUrl ?? `https://i.ytimg.com/vi/${result.videoId}/hqdefault.jpg`,
      videoUrl: url,
      transcript: JSON.stringify(result.transcript),
    };

    const video = existing
      ? await prisma.video.update({ where: { videoId }, data })
      : await prisma.video.create({ data });

    return NextResponse.json(video, { status: existing ? 200 : 201 });
  } catch (err: unknown) {
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
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(videos);
}
