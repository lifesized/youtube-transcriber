import type { TranscriptSegment } from "./types";

export const LOCAL_SUMMARY_MODEL: string;

export function neutralizePromptData(text: string | null | undefined): string;

export function rejectClientApiKey(
  body: Record<string, unknown> | null | undefined
): string | null;

export function formatTranscriptForSummary(
  segments: TranscriptSegment[]
): string;

export function requestLocalSummary(opts: {
  apiKey: string;
  title: string;
  transcript: string;
  promptOverride?: string | null;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{
  summary: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}>;
