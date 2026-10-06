import { prisma } from "./prisma";
import {
  LOCAL_SUMMARY_MODEL,
  formatTranscriptForSummary,
  rejectClientApiKey,
  requestLocalSummary,
} from "./local-summary-core.js";
import {
  decryptApiKeyForUse,
  SecretsKeyError,
} from "./secrets-store.js";

export {
  LOCAL_SUMMARY_MODEL,
  formatTranscriptForSummary,
  rejectClientApiKey,
  requestLocalSummary,
};

/**
 * Server-held OpenRouter key for built-in summarize (YTT-436 / YTT-437).
 * Never read a client-supplied apiKey — env or ProviderConfig only.
 * DB-stored keys are decrypted in-process; never returned to clients.
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
  if (!provider?.apiKey?.trim()) return null;
  try {
    return decryptApiKeyForUse(provider.apiKey);
  } catch (err) {
    if (err instanceof SecretsKeyError) {
      console.error(`[local-summary] ${err.message}`);
      throw err;
    }
    throw err;
  }
}
