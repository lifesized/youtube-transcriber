"use strict";

/**
 * Map local API / network failures to short thread copy.
 * Never include stack traces or tokens.
 */

const COPY = {
  unreachable: "Transcriber isn’t reachable on this Mac. Open it from the menu bar and try again.",
  unauthorized: "Tusk couldn’t use the local API token. Restart Transcriber and try again.",
  no_captions: "No captions for this video, and local transcription didn’t produce a transcript.",
  too_long: "This video is too long for Tusk to handle in one go.",
  rate_limit: "The site is rate-limiting fetches. Wait a moment and paste the link again.",
  no_llm:
    "Add a summary provider in Transcriber › Settings › Summaries, then paste the link again. I attached the transcript in the meantime.",
  timeout: "Tusk timed out waiting for Transcriber. Try again.",
  cancelled: "Tusk stopped that job.",
  llm_hourly_cap: "Tusk hit the hourly summary cap. Try again in a bit.",
  llm_daily_cap: "Tusk hit the daily summary cap. Try again tomorrow.",
  not_youtube:
    "Tusk only summarizes public YouTube videos, not LinkedIn, Spotify, or library items captured while signed in.",
  generic: "Tusk couldn’t finish that. Check Transcriber and try again.",
};

function bodyError(payload) {
  if (!payload || typeof payload !== "object") return "";
  return typeof payload.error === "string" ? payload.error : "";
}

function classifyLocalFailure(err) {
  if (!err) return { code: "generic", message: COPY.generic };
  if (err.name === "AbortError" || err.code === "ABORT_ERR") {
    return { code: "timeout", message: COPY.timeout };
  }
  if (err.code === "LOCAL_AUTH_REQUIRED") {
    return { code: "unauthorized", message: COPY.unauthorized };
  }
  const status = err.status || err.statusCode;
  const raw = String(err.message || "");
  const lower = raw.toLowerCase();
  if (
    err.code === "ECONNREFUSED" ||
    err.code === "ENOTFOUND" ||
    err.code === "ECONNRESET" ||
    lower.includes("econnrefused") ||
    lower.includes("fetch failed") ||
    lower.includes("network")
  ) {
    return { code: "unreachable", message: COPY.unreachable };
  }
  if (status === 401 || status === 403 && /unauthor|token|forbidden/i.test(raw)) {
    if (status === 403 && /bot detection|vpn/i.test(raw)) {
      return { code: "generic", message: "YouTube blocked the fetch. Try again from this Mac without a VPN." };
    }
    if (status === 401) return { code: "unauthorized", message: COPY.unauthorized };
  }
  if (status === 404 || /caption|disabled|not found|unavailable/i.test(raw)) {
    return { code: "no_captions", message: COPY.no_captions };
  }
  if (status === 413 || /too long|too large|payload/i.test(raw)) {
    return { code: "too_long", message: COPY.too_long };
  }
  if (status === 429 || /rate.?limit/i.test(raw)) {
    return { code: "rate_limit", message: COPY.rate_limit };
  }
  if (status === 503 && /anthropic|openai|api key|openrouter|summar/i.test(raw)) {
    return { code: "no_llm", message: COPY.no_llm };
  }
  if (err.code === "llm_hourly_cap" || err.code === "llm_daily_cap") {
    return { code: err.code, message: COPY[err.code] || raw };
  }
  if (err.code === "tusk_not_youtube" || /signed in|not linkedin|public youtube/i.test(raw)) {
    return { code: "not_youtube", message: COPY.not_youtube };
  }
  if (status === 422 && raw && raw.length < 280 && !/stack|token|xoxb|xapp|bearer/i.test(raw)) {
    return { code: "generic", message: raw };
  }
  return { code: "generic", message: COPY.generic };
}

function safeErrorMessage(err) {
  return classifyLocalFailure(err).message;
}

module.exports = {
  COPY,
  classifyLocalFailure,
  safeErrorMessage,
  bodyError,
};
