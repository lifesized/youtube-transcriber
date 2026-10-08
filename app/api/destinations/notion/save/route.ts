import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSecretsFromMainOrEnv } from "@/lib/electron-ipc.js";
import { saveVideoToNotion } from "@/lib/notion-save";
import { normalizeCaptionLanguage, PIPELINE_VERSION } from "@/lib/transcript-pipeline";
import { formatTranscriptForSummary } from "@/lib/local-summary-core.js";
import type { TranscriptSegment } from "@/lib/types";

export async function POST(request: NextRequest) {
  let body: { videoId?: string; lang?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const videoId = typeof body.videoId === "string" ? body.videoId.trim() : "";
  if (!videoId) {
    return NextResponse.json({ error: "videoId is required" }, { status: 400 });
  }
  const captionLanguage = normalizeCaptionLanguage(body.lang);

  const secrets = await getSecretsFromMainOrEnv();
  if (!secrets.notionToken) {
    return NextResponse.json(
      { error: "Add a Notion integration token in Settings" },
      { status: 400 }
    );
  }
  if (!secrets.notionDatabaseId) {
    return NextResponse.json(
      { error: "Add a Notion database ID or URL in Settings" },
      { status: 400 }
    );
  }

  const video = await prisma.video.findUnique({
    where: {
      videoId_captionLanguage_pipelineVersion: {
        videoId,
        captionLanguage,
        pipelineVersion: PIPELINE_VERSION,
      },
    },
  });
  if (!video) {
    return NextResponse.json({ error: "Transcript not found" }, { status: 404 });
  }

  let transcriptText = video.transcript;
  try {
    const segments = JSON.parse(video.transcript) as TranscriptSegment[];
    if (Array.isArray(segments)) {
      transcriptText = formatTranscriptForSummary(segments);
    }
  } catch {
    // keep raw transcript
  }

  try {
    const result = await saveVideoToNotion({
      token: secrets.notionToken,
      databaseIdOrUrl: secrets.notionDatabaseId,
      video: {
        title: video.title,
        author: video.author,
        videoUrl: video.videoUrl,
        createdAt: video.createdAt,
        baseSummary: video.baseSummary,
        transcript: transcriptText,
      },
    });
    return NextResponse.json({ ok: true, pageId: result.pageId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Notion save failed" },
      { status: 502 }
    );
  }
}
