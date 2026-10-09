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
import { beginServerJob } from "./in-flight-jobs";

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
    promptOverride?: string | null;
    signal?: AbortSignal;
  }
): Promise<string> {
  const lang = transcript.captionLanguage;
  const promptOverride = options?.promptOverride?.trim() || "";
  if (!promptOverride) {
    const cached = await getCachedBaseSummary(
      transcript.videoId,
      lang,
      promptVersion
    );
    if (cached) return cached;
  }

  const job = beginServerJob(options?.signal);
  try {
    if (job.signal.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      (err as Error & { code?: string }).code = "ABORT_ERR";
      throw err;
    }
    const { provider, apiKey } = await resolveLlmConfig(options);
    const segments = segmentsFromTranscript(transcript.transcript);
    const transcriptText = formatTranscriptForSummary(segments);
    const summary = await callLlmProvider({
      provider,
      apiKey,
      title: transcript.title,
      transcriptText,
      promptOverride: promptOverride || null,
      fetchImpl: options?.fetchImpl,
      signal: job.signal,
    });
    if (!promptOverride) {
      await cacheBaseSummary(transcript.videoId, lang, promptVersion, summary);
    }
    return summary;
  } finally {
    job.finish();
  }
}
