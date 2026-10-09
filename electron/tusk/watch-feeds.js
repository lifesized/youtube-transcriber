"use strict";

/**
 * YouTube watchlist feed specs. Only the public videos.xml Atom feed,
 * rebuilt from a channel_id or playlist_id. No other hosts or params.
 */

const FEED_ORIGIN = "https://www.youtube.com";
const FEED_PATH = "/feeds/videos.xml";
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const PLAYLIST_ID_RE = /^(PL|UU|LL|FL|OL)[A-Za-z0-9_-]{10,64}$/;
const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const ALLOWED_FEED_HOSTS = new Set(["www.youtube.com", "youtube.com", "m.youtube.com"]);

function decodeXmlEntities(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number.parseInt(code, 10);
      return Number.isFinite(n) && n >= 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => {
      const n = Number.parseInt(code, 16);
      return Number.isFinite(n) && n >= 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]+>/g, "");
}

function watchUrlForVideoId(videoId) {
  if (!VIDEO_ID_RE.test(videoId)) return "";
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function feedUrlForSpec(spec) {
  if (!spec || !spec.kind || !spec.id) return "";
  const url = new URL(FEED_PATH, FEED_ORIGIN);
  if (spec.kind === "channel" && CHANNEL_ID_RE.test(spec.id)) {
    url.searchParams.set("channel_id", spec.id);
    return url.href;
  }
  if (spec.kind === "playlist" && PLAYLIST_ID_RE.test(spec.id)) {
    url.searchParams.set("playlist_id", spec.id);
    return url.href;
  }
  return "";
}

function isAllowedYoutubeHost(hostname) {
  return ALLOWED_FEED_HOSTS.has(String(hostname || "").toLowerCase());
}

function isValidFeedUrl(value) {
  return Boolean(parseFeedUrl(value).ok);
}

function parseFeedUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    return { ok: false, error: "not_a_url" };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "https_only" };
  if (parsed.username || parsed.password) return { ok: false, error: "userinfo" };
  if (parsed.port) return { ok: false, error: "port" };
  if (!isAllowedYoutubeHost(parsed.hostname)) return { ok: false, error: "host" };
  if (parsed.pathname !== FEED_PATH) return { ok: false, error: "path" };
  const channelId = parsed.searchParams.get("channel_id") || "";
  const playlistId = parsed.searchParams.get("playlist_id") || "";
  if (channelId && playlistId) return { ok: false, error: "both_ids" };
  if (channelId) {
    if (!CHANNEL_ID_RE.test(channelId)) return { ok: false, error: "channel_id" };
    return {
      ok: true,
      kind: "channel",
      id: channelId,
      url: feedUrlForSpec({ kind: "channel", id: channelId }),
    };
  }
  if (playlistId) {
    if (!PLAYLIST_ID_RE.test(playlistId)) return { ok: false, error: "playlist_id" };
    return {
      ok: true,
      kind: "playlist",
      id: playlistId,
      url: feedUrlForSpec({ kind: "playlist", id: playlistId }),
    };
  }
  return { ok: false, error: "missing_id" };
}

function parseWatchFeedInput(raw) {
  const s = String(raw || "").trim();
  if (!s) return { ok: false, error: "empty" };
  if (CHANNEL_ID_RE.test(s)) {
    return { ok: true, kind: "channel", id: s, url: feedUrlForSpec({ kind: "channel", id: s }) };
  }
  if (PLAYLIST_ID_RE.test(s)) {
    return { ok: true, kind: "playlist", id: s, url: feedUrlForSpec({ kind: "playlist", id: s }) };
  }
  let parsed;
  try {
    parsed = new URL(s);
  } catch {
    return { ok: false, error: "unrecognized" };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "https_only" };
  if (parsed.username || parsed.password || parsed.port) return { ok: false, error: "url" };
  if (!isAllowedYoutubeHost(parsed.hostname)) return { ok: false, error: "host" };

  if (parsed.pathname === FEED_PATH) return parseFeedUrl(s);

  const channelMatch = parsed.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/);
  if (channelMatch) {
    return {
      ok: true,
      kind: "channel",
      id: channelMatch[1],
      url: feedUrlForSpec({ kind: "channel", id: channelMatch[1] }),
    };
  }
  if (parsed.pathname === "/playlist" || parsed.pathname === "/playlist/") {
    const list = parsed.searchParams.get("list") || "";
    if (!PLAYLIST_ID_RE.test(list)) return { ok: false, error: "playlist_id" };
    return { ok: true, kind: "playlist", id: list, url: feedUrlForSpec({ kind: "playlist", id: list }) };
  }
  return { ok: false, error: "unrecognized" };
}

function parseWatchlistText(value) {
  const lines = String(value || "")
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const feeds = [];
  const seen = new Set();
  for (const line of lines) {
    const parsed = parseWatchFeedInput(line);
    if (!parsed.ok) continue;
    if (seen.has(parsed.url)) continue;
    seen.add(parsed.url);
    feeds.push({ kind: parsed.kind, id: parsed.id, url: parsed.url });
  }
  return feeds;
}

function tagText(block, names, cap = 8 * 1024) {
  const list = Array.isArray(names) ? names : [names];
  const raw = String(block || "");
  const lower = raw.toLowerCase();
  for (const name of list) {
    const open = `<${String(name).toLowerCase()}`;
    const close = `</${String(name).toLowerCase()}>`;
    const start = lower.indexOf(open, 0);
    if (start < 0) continue;
    const gt = raw.indexOf(">", start);
    if (gt < 0 || gt - start > 256) continue;
    const end = lower.indexOf(close, gt + 1);
    if (end < 0 || end - (gt + 1) > cap) continue;
    return decodeXmlEntities(stripTags(raw.slice(gt + 1, end))).trim();
  }
  return "";
}

function parseYoutubeAtom(xml, options = {}) {
  const maxBytes = options.maxBytes ?? 512 * 1024;
  const maxEntries = options.maxEntries ?? 50;
  const maxBlock = options.maxBlock ?? 32 * 1024;
  const raw = String(xml || "");
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    return { ok: false, error: "too_large", entries: [] };
  }
  const lower = raw.toLowerCase();
  const entries = [];
  const seen = new Set();
  let from = 0;
  while (entries.length < maxEntries) {
    const start = lower.indexOf("<entry", from);
    if (start < 0) break;
    const openEnd = raw.indexOf(">", start);
    if (openEnd < 0) break;
    if (openEnd - start > 256) {
      from = start + 6;
      continue;
    }
    const close = lower.indexOf("</entry>", openEnd + 1);
    if (close < 0) break;
    if (close - (openEnd + 1) > maxBlock) {
      from = openEnd + 1;
      continue;
    }
    const block = raw.slice(openEnd + 1, close);
    from = close + 8;
    let videoId = tagText(block, ["yt:videoId", "yt:videoid"], 256);
    if (!VIDEO_ID_RE.test(videoId)) {
      const idText = tagText(block, "id", 256);
      const fromId = idText.match(/yt:video:([A-Za-z0-9_-]{11})/);
      videoId = fromId ? fromId[1] : "";
    }
    if (!VIDEO_ID_RE.test(videoId) || seen.has(videoId)) continue;
    seen.add(videoId);
    const title = tagText(block, "title");
    const published = tagText(block, "published");
    const author = tagText(block, "name");
    entries.push({
      videoId,
      title,
      published,
      author,
      url: watchUrlForVideoId(videoId),
    });
  }
  return { ok: true, entries };
}

module.exports = {
  CHANNEL_ID_RE,
  PLAYLIST_ID_RE,
  VIDEO_ID_RE,
  FEED_ORIGIN,
  FEED_PATH,
  decodeXmlEntities,
  watchUrlForVideoId,
  feedUrlForSpec,
  isValidFeedUrl,
  parseFeedUrl,
  parseWatchFeedInput,
  parseWatchlistText,
  parseYoutubeAtom,
};
