import { prisma } from "./prisma";
import {
  LOCAL_SUMMARY_MODEL,
  formatTranscriptForSummary,
  rejectClientApiKey,
  requestLocalSummary,
} from "./local-summary-core.js";

export {
  LOCAL_SUMMARY_MODEL,
  formatTranscriptForSummary,
  rejectClientApiKey,
  requestLocalSummary,
};

/**
 * Server-held OpenRouter key for built-in summarize (YTT-436).
 * Never read a client-supplied apiKey — env or ProviderConfig only.
 */
export async function getOpenRouterKey(): Promise<string | null> {
  const envKey = process.env.OPENROUTER_API_KEY?.trim();
  if (envKey) return envKey;

  // enabled flag controls transcription priority; a saved OpenRouter key
  // can still power this separate summarize action.
  const provider = await prisma.providerConfig.findFirst({
    where: { provider: "openrouter" },
    orderBy: { priority: "asc" },
    select: { apiKey: true },
  });
  return provider?.apiKey?.trim() || null;
}
