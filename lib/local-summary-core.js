"use strict";

/** @typedef {{ text: string, startMs: number, durationMs: number, speaker?: string }} TranscriptSegment */

const LOCAL_SUMMARY_MODEL = "google/gemini-2.5-flash-lite";

const DEFAULT_PROMPT = `Summarize this transcript from "{title}".

Return markdown with:
- **TL;DR:** one sentence
- **Key points:** 3–5 bullets with the actual takeaways
- **Notable quotes:** 1–3 only if genuinely quotable; include the transcript timestamp
- **Action items:** only if the video gives concrete things to do

Skip preamble and focus on substance.`;

/**
 * Reject client-supplied LLM keys (open-proxy / key-burn).
 * @param {Record<string, unknown> | null | undefined} body
 * @returns {string | null}
 */
function rejectClientApiKey(body) {
  if (!body || typeof body !== "object") return null;
  if (!Object.prototype.hasOwnProperty.call(body, "apiKey")) return null;
  const value = body.apiKey;
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim().length === 0) return null;
  return "Client-supplied apiKey is not allowed. Configure an OpenRouter key in Settings or OPENROUTER_API_KEY.";
}

/**
 * @param {TranscriptSegment[]} segments
 */
function formatTranscriptForSummary(segments) {
  return segments
    .map((segment) => {
      const totalSeconds = Math.floor(Math.max(0, segment.startMs) / 1000);
      const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
      const seconds = String(totalSeconds % 60).padStart(2, "0");
      const speaker = segment.speaker ? `${segment.speaker}: ` : "";
      return `[${minutes}:${seconds}] ${speaker}${segment.text.trim()}`;
    })
    .join("\n");
}

/**
 * @param {{
 *   apiKey: string,
 *   title: string,
 *   transcript: string,
 *   promptOverride?: string | null,
 *   fetchImpl?: typeof fetch,
 * }} opts
 */
async function requestLocalSummary({
  apiKey,
  title,
  transcript,
  promptOverride,
  fetchImpl = fetch,
}) {
  const instruction = (promptOverride?.trim() || DEFAULT_PROMPT).replace(
    /\{title\}/g,
    title
  );
  const response = await fetchImpl(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: LOCAL_SUMMARY_MODEL,
        messages: [
          {
            role: "system",
            content: "You summarize video transcripts into structured markdown.",
          },
          {
            role: "user",
            content: `${instruction}\n\nTranscript:\n\n${transcript}`,
          },
        ],
        max_tokens: 2048,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(120_000),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data?.error?.message || `OpenRouter error (${response.status})`;
    throw new Error(message);
  }
  const summary = data?.choices?.[0]?.message?.content?.trim();
  if (!summary) throw new Error("The summary model returned no text.");
  return {
    summary,
    model: data.model || LOCAL_SUMMARY_MODEL,
    promptTokens: data.usage?.prompt_tokens || 0,
    completionTokens: data.usage?.completion_tokens || 0,
  };
}

module.exports = {
  LOCAL_SUMMARY_MODEL,
  rejectClientApiKey,
  formatTranscriptForSummary,
  requestLocalSummary,
};
