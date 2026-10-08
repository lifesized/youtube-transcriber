import {
  cacheBaseSummary,
  getCachedBaseSummary,
  type CachedTranscript,
} from "./transcript-cache";
import { formatTranscriptForSummary } from "./local-summary-core.js";
import { SUMMARY_PROMPT_VERSION } from "./transcript-pipeline";
import { getSecretsFromMainOrEnv } from "./electron-ipc.js";
import type { TranscriptSegment } from "./types";
import {
  callLlmProvider,
  LLM_DEFAULT_MODELS,
  type LlmProvider,
} from "./llm-provider";

export type { LlmProvider };
export { callLlmProvider, LLM_DEFAULT_MODELS as DEFAULT_MODELS };

export async function resolveLlmConfig(overrides?: {
  provider?: LlmProvider;
  apiKey?: string;
}): Promise<{ provider: LlmProvider; apiKey: string }> {
  if (overrides?.provider && overrides?.apiKey) {
    return { provider: overrides.provider, apiKey: overrides.apiKey };
  }
  const secrets = await getSecretsFromMainOrEnv();
  const provider = (overrides?.provider || secrets.llmProvider) as LlmProvider;
  if (provider !== "anthropic" && provider !== "openai") {
    throw new Error("Choose Anthropic or OpenAI in Settings to generate summaries.");
  }
  const apiKey = overrides?.apiKey || secrets.llmApiKey || "";
  if (!apiKey.trim()) {
    throw new Error("Add an API key in Settings for the selected summary provider.");
  }
  return { provider, apiKey: apiKey.trim() };
}

function segmentsFromTranscript(transcript: string | TranscriptSegment[]): TranscriptSegment[] {
  if (Array.isArray(transcript)) return transcript;
  const parsed = JSON.parse(transcript);
  if (!Array.isArray(parsed)) throw new Error("invalid transcript");
  return parsed;
}

/**
 * Summarize a cached transcript and store baseSummary for promptVersion.
 */
export async function summarize(
  transcript: Pick<
    CachedTranscript,
    "videoId" | "title" | "transcript" | "captionLanguage"
  >,
  promptVersion: number = SUMMARY_PROMPT_VERSION,
  options?: {
    fetchImpl?: typeof fetch;
    provider?: LlmProvider;
    apiKey?: string;
  }
): Promise<string> {
  const lang = transcript.captionLanguage;
  const cached = await getCachedBaseSummary(
    transcript.videoId,
    lang,
    promptVersion
  );
  if (cached) return cached;

  const { provider, apiKey } = await resolveLlmConfig(options);
  const segments = segmentsFromTranscript(transcript.transcript);
  const transcriptText = formatTranscriptForSummary(segments);
  const summary = await callLlmProvider({
    provider,
    apiKey,
    title: transcript.title,
    transcriptText,
    fetchImpl: options?.fetchImpl,
  });
  await cacheBaseSummary(transcript.videoId, lang, promptVersion, summary);
  return summary;
}
