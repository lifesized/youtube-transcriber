/**
 * Transcript pipeline versioning.
 * 
 * PIPELINE_VERSION is bumped whenever the caption extraction or Whisper
 * transcription logic changes in a way that produces different output.
 * 
 * This ensures that when we improve the pipeline (e.g. better deduplication,
 * new caption source, updated Whisper model), we re-transcribe videos instead
 * of serving stale cached results.
 * 
 * History:
 * - 1: Initial version (March 2026, yt-dlp + WEB scrape + Whisper fallback)
 */
export const PIPELINE_VERSION = 1;

/**
 * Summary prompt versioning.
 * 
 * SUMMARY_PROMPT_VERSION is bumped when the base summary prompt or generation
 * logic changes. This invalidates cached baseSummary values.
 * 
 * History:
 * - 1: Initial version (YTT-436 base summary caching)
 */
export const SUMMARY_PROMPT_VERSION = 1;

/**
 * Normalize a language preference string to a single canonical language code
 * for cache keying.
 * 
 * Takes the first language from a comma-separated list, or defaults to "en".
 * Examples:
 *   "es,en" -> "es"
 *   "fr" -> "fr"
 *   undefined -> "en"
 */
export function normalizeCaptionLanguage(lang?: string): string {
  if (!lang) return "en";
  const first = lang.split(",")[0]?.trim();
  return first || "en";
}
