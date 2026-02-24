import { promises as fs } from "fs";
import type { TranscriptSegment } from "./types";

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

export function getCloudWhisperConfig(): CloudWhisperConfig | null {
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
// Transcription
// ---------------------------------------------------------------------------

export async function transcribeWithCloudWhisper(
  audioPath: string
): Promise<{ segments: TranscriptSegment[]; provider: string }> {
  const config = getCloudWhisperConfig();
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
  const startTime = Date.now();

  const audioBuffer = await fs.readFile(audioPath);
  const fileName = audioPath.split("/").pop() || "audio.mp3";

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([audioBuffer], { type: "audio/mpeg" }),
    fileName
  );
  formData.append("model", resolvedModel);
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
      `${provider} API error (HTTP ${res.status})`;
    throw new Error(`[whisper-cloud] ${provider} transcription failed: ${message}`);
  }

  const data = (await res.json()) as CloudWhisperResponse;
  const segments = parseCloudWhisperResponse(data);

  const wallTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[whisper-cloud] Done: ${segments.length} segments, provider=${provider}, model=${resolvedModel}, wall-clock=${wallTime}s`
  );

  return { segments, provider };
}
