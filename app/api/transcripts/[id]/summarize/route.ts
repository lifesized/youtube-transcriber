import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { TranscriptSegment } from "@/lib/types";

interface SummarizeRequestBody {
  provider: "openai" | "anthropic";
  apiKey: string;
  model?: string;
  prompt?: string;
  format?: "markdown" | "text" | "bullets";
}

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-5-20250929",
};

const FORMAT_INSTRUCTIONS: Record<string, string> = {
  markdown:
    "Format your response as clean Markdown with headings and bullet points.",
  text: "Format your response as plain text paragraphs.",
  bullets:
    "Format your response as a concise bullet-point list of the key points.",
};

function buildPrompt(
  title: string,
  transcript: string,
  customPrompt?: string,
  format: string = "markdown"
): string {
  if (customPrompt) return `${customPrompt}\n\nTranscript from "${title}":\n\n${transcript}`;

  const formatInstruction = FORMAT_INSTRUCTIONS[format] || FORMAT_INSTRUCTIONS.markdown;

  return [
    `Summarize the following transcript from "${title}".`,
    formatInstruction,
    "Focus on the main topics, key insights, and any actionable takeaways.",
    "",
    "Transcript:",
    "",
    transcript,
  ].join("\n");
}

function flattenTranscript(segments: TranscriptSegment[]): string {
  return segments.map((s, idx) => {
    const prev = segments[idx - 1];
    const speakerChanged = s.speaker && (!prev || prev.speaker !== s.speaker);
    return speakerChanged ? `\n${s.speaker}: ${s.text}` : s.text;
  }).join(" ");
}

async function callOpenAI(
  apiKey: string,
  model: string,
  prompt: string
): Promise<{ summary: string; model_used: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message = err?.error?.message || `OpenAI API error (${res.status})`;
    throw new Error(message);
  }

  const data = await res.json();
  return {
    summary: data.choices[0]?.message?.content ?? "",
    model_used: data.model,
    usage: {
      prompt_tokens: data.usage?.prompt_tokens ?? 0,
      completion_tokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

async function callAnthropic(
  apiKey: string,
  model: string,
  prompt: string
): Promise<{ summary: string; model_used: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message = err?.error?.message || `Anthropic API error (${res.status})`;
    throw new Error(message);
  }

  const data = await res.json();
  const text = data.content
    ?.filter((c: { type: string }) => c.type === "text")
    .map((c: { text: string }) => c.text)
    .join("") ?? "";

  return {
    summary: text,
    model_used: data.model,
    usage: {
      prompt_tokens: data.usage?.input_tokens ?? 0,
      completion_tokens: data.usage?.output_tokens ?? 0,
    },
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Validate request body
  let body: SummarizeRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { provider, apiKey, model, prompt: customPrompt, format = "markdown" } = body;

  if (!provider || !["openai", "anthropic"].includes(provider)) {
    return NextResponse.json(
      { error: 'provider must be "openai" or "anthropic"' },
      { status: 400 }
    );
  }

  if (!apiKey || typeof apiKey !== "string") {
    return NextResponse.json(
      { error: "apiKey is required" },
      { status: 400 }
    );
  }

  if (!["markdown", "text", "bullets"].includes(format)) {
    return NextResponse.json(
      { error: 'format must be "markdown", "text", or "bullets"' },
      { status: 400 }
    );
  }

  // Fetch transcript
  const video = await prisma.video.findUnique({ where: { id } });
  if (!video) {
    return NextResponse.json({ error: "Transcript not found" }, { status: 404 });
  }

  const segments: TranscriptSegment[] = JSON.parse(video.transcript);
  if (segments.length === 0) {
    return NextResponse.json(
      { error: "Transcript is empty" },
      { status: 400 }
    );
  }

  const transcriptText = flattenTranscript(segments);
  const resolvedModel = model || DEFAULT_MODELS[provider];
  const fullPrompt = buildPrompt(video.title, transcriptText, customPrompt, format);

  try {
    const callProvider = provider === "openai" ? callOpenAI : callAnthropic;
    const result = await callProvider(apiKey, resolvedModel, fullPrompt);

    return NextResponse.json({
      summary: result.summary,
      model_used: result.model_used,
      provider,
      format,
      token_count: {
        prompt_tokens: result.usage.prompt_tokens,
        completion_tokens: result.usage.completion_tokens,
      },
      video: {
        id: video.id,
        title: video.title,
        videoUrl: video.videoUrl,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Summarization failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
