"use strict";

const MAX_TIMEDTEXT_BYTES = 5 * 1024 * 1024;
const MAX_TIMEDTEXT_SEGMENTS = 20_000;

function timedtextWithinLimit(text) {
  return typeof text === "string" && text.length <= MAX_TIMEDTEXT_BYTES;
}

function tracksMatchCurrentVideo(tracksResult, currentVid) {
  return Boolean(
    tracksResult &&
      currentVid &&
      tracksResult.videoId === currentVid
  );
}

function isAsrTrack(track) {
  if (!track || typeof track !== "object") return false;
  const vss = String(track.vssId || "");
  const kind = String(track.kind || "");
  return kind === "asr" || vss.startsWith("a.");
}

function trackLang(track) {
  if (!track) return "";
  if (typeof track.languageCode === "string" && track.languageCode) {
    return track.languageCode;
  }
  const vss = String(track.vssId || "");
  return vss.replace(/^a?\./, "");
}

function langMatches(track, lang) {
  const want = String(lang || "").toLowerCase();
  if (!want) return false;
  const have = trackLang(track).toLowerCase();
  return have === want || have.startsWith(`${want}-`) || want.startsWith(`${have}-`);
}

/** Prefer a manual track in the requested language over ASR. */
function selectCaptionTrack(tracks, preferredLangs) {
  const list = Array.isArray(tracks) ? tracks.filter((t) => t && t.baseUrl) : [];
  if (!list.length) return null;
  const langs = Array.isArray(preferredLangs) && preferredLangs.length
    ? preferredLangs
    : ["en"];
  for (const lang of langs) {
    const manual = list.find((t) => !isAsrTrack(t) && langMatches(t, lang));
    if (manual) return manual;
  }
  for (const lang of langs) {
    const asr = list.find((t) => isAsrTrack(t) && langMatches(t, lang));
    if (asr) return asr;
  }
  return list.find((t) => !isAsrTrack(t)) || list[0];
}

function isSameOriginYoutubeTimedText(url) {
  try {
    const parsed = new URL(String(url || ""), "https://www.youtube.com");
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.port) return false;
    const host = parsed.hostname.replace(/^www\./, "");
    if (host !== "youtube.com" && host !== "m.youtube.com") return false;
    const path = parsed.pathname;
    return path === "/api/timedtext" || path === "/timedtext";
  } catch {
    return false;
  }
}

function withCaptionFmt(url, fmt) {
  const parsed = new URL(String(url), "https://www.youtube.com");
  parsed.searchParams.set("fmt", String(fmt || "json3"));
  return parsed.toString();
}

function decodeCaptionEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseJson3(raw) {
  let data = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("<")) return [];
    try {
      data = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!data || !Array.isArray(data.events)) return [];
  const segments = [];
  for (const event of data.events) {
    if (!event || !Array.isArray(event.segs)) continue;
    const text = event.segs
      .map((seg) => (seg && seg.utf8) || "")
      .join("")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    segments.push({
      start: Number(event.tStartMs || 0) / 1000,
      duration: Number(event.dDurationMs || 0) / 1000,
      text,
    });
    if (segments.length >= MAX_TIMEDTEXT_SEGMENTS) break;
  }
  return segments;
}

function vttTsToSeconds(stamp) {
  const m = String(stamp || "").trim().match(
    /(?:(\d+):)?(\d{2}):(\d{2})[.](\d{3})/
  );
  if (!m) return null;
  const hours = Number(m[1] || 0);
  return hours * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

function parseVtt(vtt) {
  const text = String(vtt || "");
  if (!/WEBVTT/i.test(text) && !/\d{2}:\d{2}[.,]\d{3}\s+-->/.test(text)) {
    return [];
  }
  const cueRe =
    /(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})[^\n]*\n([\s\S]*?)(?=\n\n|\n(?:\d{2}:\d{2})|$)/g;
  const segments = [];
  let match;
  while ((match = cueRe.exec(text)) !== null) {
    const start = vttTsToSeconds(match[1].length === 12 ? match[1] : `00:${match[1]}`);
    const end = vttTsToSeconds(match[2].length === 12 ? match[2] : `00:${match[2]}`);
    if (start == null || end == null) continue;
    const cueText = decodeCaptionEntities(match[3])
      .replace(/<[^>]+>/g, "")
      .replace(/^.*-->.*$/gm, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (!cueText) continue;
    if (segments.length && segments[segments.length - 1].text === cueText) continue;
    segments.push({
      start,
      duration: Math.max(0, end - start),
      text: cueText,
    });
    if (segments.length >= MAX_TIMEDTEXT_SEGMENTS) break;
  }
  return segments;
}

function parseTimedText(body, fmt) {
  if (fmt === "vtt") return parseVtt(body);
  const json3 = parseJson3(body);
  if (json3.length) return json3;
  return parseVtt(body);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    isAsrTrack,
    selectCaptionTrack,
    isSameOriginYoutubeTimedText,
    withCaptionFmt,
    parseJson3,
    parseVtt,
    parseTimedText,
    timedtextWithinLimit,
    tracksMatchCurrentVideo,
    MAX_TIMEDTEXT_BYTES,
    MAX_TIMEDTEXT_SEGMENTS,
  };
} else {
  globalThis.CaptionTracks = {
    isAsrTrack,
    selectCaptionTrack,
    isSameOriginYoutubeTimedText,
    withCaptionFmt,
    parseJson3,
    parseVtt,
    parseTimedText,
    timedtextWithinLimit,
    tracksMatchCurrentVideo,
    MAX_TIMEDTEXT_BYTES,
    MAX_TIMEDTEXT_SEGMENTS,
  };
}
