import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  formatTranscriptForSummary,
  getOpenRouterKey,
  rejectClientApiKey,
  requestLocalSummary,
} from "@/lib/local-summary";
import { SecretsKeyError } from "@/lib/secrets-crypto.js";
import type { TranscriptSegment } from "@/lib/types";

/**
 * Legacy summarize path (YTT-436).
 * Client-supplied apiKey is rejected. Uses the same server OpenRouter key
 * as POST /api/summaries. Prefer /api/summaries for new clients.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: Record<string, unknown> = {};
  try {
    const raw = await request.json();
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      body = raw as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const clientKeyError = rejectClientApiKey(body);
  if (clientKeyError) {
    return NextResponse.json({ error: clientKeyError }, { status: 400 });
  }

  const format =
    typeof body.format === "string" ? body.format : "markdown";
  if (!["markdown", "text", "bullets"].includes(format)) {
    return NextResponse.json(
      { error: 'format must be "markdown", "text", or "bullets"' },
      { status: 400 }
    );
  }

  let apiKey: string | null;
  try {
    apiKey = await getOpenRouterKey();
  } catch (e) {
    if (e instanceof SecretsKeyError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    throw e;
  }
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Add an OpenRouter key in Settings (or set OPENROUTER_API_KEY) to enable summaries.",
      },
      { status: 503 }
    );
  }

  const video = await prisma.video.findUnique({ where: { id } });
  if (!video) {
    return NextResponse.json({ error: "Transcript not found" }, { status: 404 });
  }

  let segments: TranscriptSegment[];
  try {
    segments = JSON.parse(video.transcript);
    if (!Array.isArray(segments) || segments.length === 0) {
      throw new Error("empty");
    }
  } catch {
    return NextResponse.json(
      { error: "Transcript is empty" },
      { status: 400 }
    );
  }

  const customPrompt =
    typeof body.prompt === "string" && body.prompt.trim()
      ? body.prompt.trim().slice(0, 10_000)
      : format === "bullets"
        ? 'Summarize "{title}" as a concise bullet-point list of the key points.'
        : format === "text"
          ? 'Summarize "{title}" as plain text paragraphs. Focus on main topics and takeaways.'
          : null;

  try {
    const result = await requestLocalSummary({
      apiKey,
      title: video.title,
      transcript: formatTranscriptForSummary(segments),
      promptOverride: customPrompt,
    });

    return NextResponse.json({
      summary: result.summary,
      model_used: result.model,
      provider: "openrouter",
      format,
      token_count: {
        prompt_tokens: result.promptTokens,
        completion_tokens: result.completionTokens,
      },
      video: {
        id: video.id,
        title: video.title,
        videoUrl: video.videoUrl,
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Summarization failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
