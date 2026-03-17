import { promises as fs } from "fs";
import type { TranscriptSegment } from "./types";
import { prisma } from "./prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CloudWhisperProvider = "groq" | "openai";

interface CloudWhisperConfig {
  provider: CloudWhisperProvider;
  apiKey: string;
  model?: string;
}

interface CloudWhisperSegment {
  start: number;
  end: number;
  text: string;
}

interface CloudWhisperResponse {
  segments?: CloudWhisperSegment[];
  text?: string;
  duration?: number; // total audio duration in seconds
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_ENDPOINTS: Record<CloudWhisperProvider, string> = {
  groq: "https://api.groq.com/openai/v1/audio/transcriptions",
  openai: "https://api.openai.com/v1/audio/transcriptions",
};

const DEFAULT_MODELS: Record<CloudWhisperProvider, string> = {
  groq: "whisper-large-v3-turbo",
  openai: "whisper-1",
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export async function getCloudWhisperConfig(): Promise<CloudWhisperConfig | null> {
  // Check DB settings first (priority over env vars)
  try {
    const [dbKey, dbProvider, dbModel] = await Promise.all([
      prisma.setting.findUnique({ where: { key: "groq_api_key" } }),
      prisma.setting.findUnique({ where: { key: "whisper_cloud_provider" } }),
      prisma.setting.findUnique({ where: { key: "whisper_cloud_model" } }),
    ]);

    const apiKey = dbKey?.value?.trim() || process.env.WHISPER_CLOUD_API_KEY?.trim();
    if (!apiKey) return null;

    const raw = dbProvider?.value?.trim().toLowerCase() ||
      process.env.WHISPER_CLOUD_PROVIDER?.trim().toLowerCase() || "groq";
    if (raw !== "groq" && raw !== "openai") {
      console.warn(
        `[whisper-cloud] Invalid WHISPER_CLOUD_PROVIDER="${raw}". Use "groq" or "openai".`
      );
      return null;
    }

    const model = dbModel?.value?.trim() || process.env.WHISPER_CLOUD_MODEL?.trim() || undefined;
    return { provider: raw, apiKey, model };
  } catch (e) {
    console.warn("[whisper-cloud] Failed to read DB settings, falling back to env vars:", e);
  }

  // Fallback: env vars only
  const apiKey = process.env.WHISPER_CLOUD_API_KEY?.trim();
  if (!apiKey) return null;

  const raw = process.env.WHISPER_CLOUD_PROVIDER?.trim().toLowerCase() || "groq";
  if (raw !== "groq" && raw !== "openai") {
    console.warn(
      `[whisper-cloud] Invalid WHISPER_CLOUD_PROVIDER="${raw}". Use "groq" or "openai".`
    );
    return null;
  }

  const model = process.env.WHISPER_CLOUD_MODEL?.trim() || undefined;
  return { provider: raw, apiKey, model };
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseCloudWhisperResponse(
  data: CloudWhisperResponse
): TranscriptSegment[] {
  if (data.segments && data.segments.length > 0) {
    return data.segments.map((seg) => ({
      text: seg.text.trim(),
      startMs: Math.round(seg.start * 1000),
      durationMs: Math.round((seg.end - seg.start) * 1000),
    }));
  }

  if (data.text) {
    return [{ text: data.text.trim(), startMs: 0, durationMs: 0 }];
  }

  throw new Error("[whisper-cloud] API returned no segments or text");
}

// ---------------------------------------------------------------------------
// Usage tracking
// ---------------------------------------------------------------------------

export async function trackGroqUsage(audioSeconds: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const [dateSetting, usageSetting] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "groq_usage_date" } }),
    prisma.setting.findUnique({ where: { key: "groq_usage_seconds" } }),
  ]);

  // Reset if it's a new day
  const currentSeconds =
    dateSetting?.value === today
      ? parseFloat(usageSetting?.value || "0")
      : 0;

  const newSeconds = currentSeconds + audioSeconds;

  await Promise.all([
    prisma.setting.upsert({
      where: { key: "groq_usage_date" },
      update: { value: today },
      create: { key: "groq_usage_date", value: today },
    }),
    prisma.setting.upsert({
      where: { key: "groq_usage_seconds" },
      update: { value: String(newSeconds) },
      create: { key: "groq_usage_seconds", value: String(newSeconds) },
    }),
  ]);

  console.log(
    `[whisper-cloud] Usage: ${newSeconds.toFixed(0)}s / 14400s today`
  );
}

// ---------------------------------------------------------------------------
// Transcription (low-level, reusable)
// ---------------------------------------------------------------------------

/**
 * Send an audio file to any OpenAI-compatible transcription endpoint.
 * Used by both the legacy single-provider path and the new multi-provider chain.
 */
export async function sendCloudTranscription(
  endpoint: string,
  apiKey: string,
  model: string,
  audioPath: string
): Promise<{ segments: TranscriptSegment[]; duration: number }> {
  const startTime = Date.now();

  const audioBuffer = await fs.readFile(audioPath);
  const fileName = audioPath.split("/").pop() || "audio.mp3";

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([audioBuffer], { type: "audio/mpeg" }),
    fileName
  );
  formData.append("model", model);
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "segment");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal: AbortSignal.timeout(300_000), // 5 min
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const message =
      (errBody as Record<string, { message?: string }>)?.error?.message ||
      `API error (HTTP ${res.status})`;
    throw new Error(`[whisper-cloud] Transcription failed: ${message}`);
  }

  const data = (await res.json()) as CloudWhisperResponse;
  const segments = parseCloudWhisperResponse(data);

  // Compute audio duration: prefer top-level duration, fall back to last segment end
  let audioDuration = data.duration ?? 0;
  if (!audioDuration && data.segments && data.segments.length > 0) {
    audioDuration = data.segments[data.segments.length - 1].end;
  }

  const wallTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[whisper-cloud] Done: ${segments.length} segments, model=${model}, audio=${audioDuration.toFixed(0)}s, wall-clock=${wallTime}s`
  );

  return { segments, duration: audioDuration };
}

// ---------------------------------------------------------------------------
// Legacy single-provider transcription (backward compat)
// ---------------------------------------------------------------------------

export async function transcribeWithCloudWhisper(
  audioPath: string
): Promise<{ segments: TranscriptSegment[]; provider: string }> {
  const config = await getCloudWhisperConfig();
  if (!config) {
    throw new Error(
      "Cloud Whisper is not configured (missing WHISPER_CLOUD_API_KEY)"
    );
  }

  const { provider, apiKey, model } = config;
  const resolvedModel = model || DEFAULT_MODELS[provider];
  const endpoint = PROVIDER_ENDPOINTS[provider];

  console.log(
    `[whisper-cloud] Transcribing with ${provider} (model=${resolvedModel})...`
  );

  const { segments, duration } = await sendCloudTranscription(
    endpoint, apiKey, resolvedModel, audioPath
  );

  // Track daily usage for the settings page meter
  if (duration > 0 && provider === "groq") {
    trackGroqUsage(duration).catch((err) =>
      console.warn("[whisper-cloud] Failed to track usage:", err)
    );
  }

  return { segments, provider };
}
