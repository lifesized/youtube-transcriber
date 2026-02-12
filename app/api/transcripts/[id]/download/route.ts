import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { TranscriptSegment } from "@/lib/types";

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  if (hours > 0) {
    const hh = String(hours).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const video = await prisma.video.findUnique({ where: { id } });
  if (!video) {
    return NextResponse.json({ error: "Transcript not found" }, { status: 404 });
  }

  const segments: TranscriptSegment[] = JSON.parse(video.transcript);
  const capturedDate = new Date(video.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const lines = [
    `# ${video.title}`,
    "",
    `**Author:** ${video.author}`,
    `**URL:** ${video.videoUrl}`,
    `**Captured:** ${capturedDate}`,
    "",
    "---",
    "",
    "## Transcript",
    "",
    ...segments.map(
      (seg) => `[${formatTimestamp(seg.startMs)}] ${seg.text}`
    ),
    "",
  ];

  const markdown = lines.join("\n");
  const safeTitle = video.title.replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "transcript";

  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeTitle}.md"`,
    },
  });
}
