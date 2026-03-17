import { prisma } from "./prisma";
import { sendCloudTranscription, trackGroqUsage, getCloudWhisperConfig } from "./whisper-cloud";
import type { TranscriptSegment } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderType = "openrouter" | "groq" | "custom";

export interface ProviderEndpointConfig {
  id: string;
  provider: ProviderType;
  endpoint: string;
  apiKey: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_TRANSCRIPTION_ENDPOINTS: Record<Exclude<ProviderType, "custom">, string> = {
  groq: "https://api.groq.com/openai/v1/audio/transcriptions",
  openrouter: "https://openrouter.ai/api/v1/audio/transcriptions",
};

const PROVIDER_MODELS_ENDPOINTS: Record<Exclude<ProviderType, "custom">, string> = {
  groq: "https://api.groq.com/openai/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models",
};

export const DEFAULT_MODELS: Record<Exclude<ProviderType, "custom">, string> = {
  groq: "whisper-large-v3-turbo",
  openrouter: "google/gemini-2.5-flash",
};

export const OPENROUTER_MODELS = [
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", tag: "recommended" },
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", tag: "budget" },
  { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash", tag: "google" },
  { id: "mistralai/voxtral-small-24b-2507", label: "Voxtral Small 24B", tag: "transcription" },
  { id: "openai/gpt-audio-mini", label: "GPT Audio Mini", tag: "openai" },
];

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Get all enabled provider configs in priority order.
 * Falls back to legacy groq_api_key Setting if no ProviderConfig rows exist.
 */
export async function getEnabledProviders(): Promise<ProviderEndpointConfig[]> {
  const rows = await prisma.providerConfig.findMany({
    where: { enabled: true },
    orderBy: { priority: "asc" },
  });

  if (rows.length > 0) {
    return rows.map((row) => {
      let endpoint: string;
      let model: string;

      if (row.provider === "custom") {
        const base = (row.baseUrl || "").replace(/\/+$/, "");
        endpoint = `${base}/audio/transcriptions`;
        model = row.model || "whisper-1";
      } else {
        const p = row.provider as Exclude<ProviderType, "custom">;
        endpoint = PROVIDER_TRANSCRIPTION_ENDPOINTS[p];
        model = row.model || DEFAULT_MODELS[p];
      }

      return {
        id: row.id,
        provider: row.provider as ProviderType,
        endpoint,
        apiKey: row.apiKey,
        model,
      };
    });
  }

  // Backward compat: check legacy groq_api_key Setting
  const legacyConfig = await getCloudWhisperConfig();
  if (legacyConfig) {
    const p = legacyConfig.provider as Exclude<ProviderType, "custom">;
    return [{
      id: "__legacy__",
      provider: p,
      endpoint: PROVIDER_TRANSCRIPTION_ENDPOINTS[p],
      apiKey: legacyConfig.apiKey,
      model: legacyConfig.model || DEFAULT_MODELS[p],
    }];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

/**
 * Transcribe audio using a specific provider config.
 */
export async function transcribeWithProvider(
  audioPath: string,
  config: ProviderEndpointConfig
): Promise<{ segments: TranscriptSegment[]; source: string }> {
  console.log(
    `[providers] Transcribing with ${config.provider} (model=${config.model})...`
  );

  const { segments, duration } = await sendCloudTranscription(
    config.endpoint,
    config.apiKey,
    config.model,
    audioPath
  );

  // Track Groq daily usage
  if (config.provider === "groq" && duration > 0) {
    trackGroqUsage(duration).catch((err) =>
      console.warn("[providers] Failed to track Groq usage:", err)
    );
  }

  return { segments, source: `whisper_cloud_${config.provider}` };
}

/**
 * Try each enabled provider in priority order. Return first success.
 */
export async function transcribeWithProviderChain(
  audioPath: string
): Promise<{ segments: TranscriptSegment[]; source: string }> {
  const providers = await getEnabledProviders();

  if (providers.length === 0) {
    throw new Error("No cloud transcription providers are configured.");
  }

  const errors: string[] = [];

  for (const config of providers) {
    try {
      return await transcribeWithProvider(audioPath, config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        `[providers] ${config.provider} failed: ${msg}. Trying next provider...`
      );
      errors.push(`${config.provider}: ${msg}`);
    }
  }

  throw new Error(
    `All cloud providers failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`
  );
}

// ---------------------------------------------------------------------------
// Connection testing
// ---------------------------------------------------------------------------

/**
 * Test a provider's API key by hitting their models endpoint.
 */
export async function testProviderConnection(
  provider: ProviderType,
  apiKey: string,
  baseUrl?: string | null
): Promise<{ success: boolean; error?: string }> {
  let modelsUrl: string;

  if (provider === "custom") {
    if (!baseUrl) return { success: false, error: "Base URL is required for custom providers" };
    modelsUrl = `${baseUrl.replace(/\/+$/, "")}/models`;
  } else {
    modelsUrl = PROVIDER_MODELS_ENDPOINTS[provider];
  }

  try {
    const res = await fetch(modelsUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message =
        (body as Record<string, { message?: string }>)?.error?.message ||
        `HTTP ${res.status}`;
      return { success: false, error: message };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Whisper toggle
// ---------------------------------------------------------------------------

/**
 * Check if local Whisper is enabled (default: true).
 */
export async function isWhisperEnabled(): Promise<boolean> {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: "whisper_enabled" },
    });
    if (!setting) return true; // default
    return setting.value !== "false";
  } catch {
    return true;
  }
}
