import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Fetches a video by ID or returns a 404 response if not found.
 * Use this helper to avoid duplicating the video lookup + error handling pattern.
 */
export async function getVideoOr404(id: string) {
  const video = await prisma.video.findUnique({ where: { id } });

  if (!video) {
    return {
      video: null,
      response: NextResponse.json(
        { error: "Transcript not found" },
        { status: 404 }
      )
    };
  }

  return { video, response: null };
}
