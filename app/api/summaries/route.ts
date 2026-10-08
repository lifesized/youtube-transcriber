import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  LOCAL_SUMMARY_MODEL,
  formatTranscriptForSummary,
  getOpenRouterKey,
  rejectClientApiKey,
  requestLocalSummary,
} from "@/lib/local-summary";
import { SecretsKeyError } from "@/lib/secrets-crypto.js";
import type { TranscriptSegment } from "@/lib/types";
import { summarize } from "@/lib/summarize";
import { SUMMARY_PROMPT_VERSION } from "@/lib/transcript-pipeline";
import { getSecretsFromMainOrEnv } from "@/lib/electron-ipc.js";

export async function GET() {
  try {
    const secrets = await getSecretsFromMainOrEnv();
    const llmReady = Boolean(
      (secrets.llmProvider === "anthropic" || secrets.llmProvider === "openai") &&
        secrets.llmApiKey
    );
    return NextResponse.json({
      available: llmReady || !!(await getOpenRouterKey()),
      model: LOCAL_SUMMARY_MODEL,
    });
  } catch (e) {
    if (e instanceof SecretsKeyError) {
      return NextResponse.json(
        { available: false, model: LOCAL_SUMMARY_MODEL, error: e.message },
        { status: 503 }
      );
    }
    throw e;
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const clientKeyError = rejectClientApiKey(body);
  if (clientKeyError) {
    return NextResponse.json({ error: clientKeyError }, { status: 400 });
  }

  const transcriptId =
    typeof body.transcriptId === "string" ? body.transcriptId : "";
  if (!transcriptId) {
    return NextResponse.json(
      { error: "transcriptId is required" },
      { status: 400 }
    );
  }

  const video = await prisma.video.findUnique({ where: { id: transcriptId } });
  if (!video) {
    return NextResponse.json({ error: "Transcript not found" }, { status: 404 });
  }

  try {
    const summary = await summarize(
      {
        videoId: video.videoId,
        title: video.title,
        transcript: video.transcript,
        captionLanguage: video.captionLanguage || "en",
      },
      SUMMARY_PROMPT_VERSION
    );
    return NextResponse.json({
      summary_md: summary,
      model: "app-llm",
      cached: true,
    });
  } catch (llmError) {
    const llmMessage =
      llmError instanceof Error ? llmError.message : "Summarization failed";
    if (
      !llmMessage.includes("Choose Anthropic or OpenAI") &&
      !llmMessage.includes("Add an API key")
    ) {
      return NextResponse.json({ error: llmMessage }, { status: 502 });
    }
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
          "Choose Anthropic or OpenAI in Settings and add an API key, or set an OpenRouter key.",
      },
      { status: 503 }
    );
  }

  let segments: TranscriptSegment[];
  try {
    segments = JSON.parse(video.transcript);
    if (
      !Array.isArray(segments) ||
      segments.length === 0 ||
      segments.some(
        (segment) =>
          typeof segment.text !== "string" ||
          typeof segment.startMs !== "number"
      )
    ) {
      throw new Error("invalid transcript");
    }
  } catch {
    return NextResponse.json(
      { error: "Transcript is empty or invalid" },
      { status: 400 }
    );
  }

  const promptOverride =
    typeof body.promptOverride === "string"
      ? body.promptOverride.trim().slice(0, 10_000)
      : null;

  try {
    const result = await requestLocalSummary({
      apiKey,
      title: video.title,
      transcript: formatTranscriptForSummary(segments),
      promptOverride,
    });
    const promptHash = createHash("sha256")
      .update(`${LOCAL_SUMMARY_MODEL}:${promptOverride || "default"}`)
      .digest("hex");
    return NextResponse.json({
      summary_md: result.summary,
      model: result.model,
      cached: false,
      cost_usd:
        (result.promptTokens * 0.25 + result.completionTokens * 1.5) /
        1_000_000,
      prompt_hash: promptHash,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Summarization failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
