"use strict";

const { isValidFeedUrl, parseFeedUrl, parseYoutubeAtom } = require("./watch-feeds.js");

const MAX_FEED_BYTES = 512 * 1024;
const MAX_REDIRECTS = 2;
const USER_AGENT = "Transcriber-Tusk/0.4 (local watchlist)";

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") {
    const value = headers.get(name);
    return value == null ? "" : String(value);
  }
  const key = String(name).toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === key) return v == null ? "" : String(v);
  }
  return "";
}

function resolveRedirect(currentUrl, location) {
  if (!location) return { ok: false, error: "redirect_missing" };
  let next;
  try {
    next = new URL(String(location), currentUrl);
  } catch {
    return { ok: false, error: "redirect_invalid" };
  }
  const parsed = parseFeedUrl(next.href);
  if (!parsed.ok) return { ok: false, error: "redirect_host" };
  return { ok: true, url: parsed.url };
}

async function readCappedBody(res, maxBytes) {
  const declared = Number.parseInt(headerValue(res.headers, "content-length"), 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, error: "too_large" };
  }
  if (typeof res.arrayBuffer === "function") {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) return { ok: false, error: "too_large" };
    return { ok: true, text: buf.toString("utf8") };
  }
  const text = await res.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) return { ok: false, error: "too_large" };
  return { ok: true, text };
}

async function fetchYoutubeFeed(url, options = {}) {
  const parsed = parseFeedUrl(url);
  if (!parsed.ok) return { ok: false, error: parsed.error || "invalid_feed" };
  const fetchImpl = options.fetchImpl || fetch;
  const maxBytes = options.maxBytes ?? MAX_FEED_BYTES;
  const headers = {
    Accept: "application/atom+xml, application/xml, text/xml",
    "User-Agent": USER_AGENT,
  };
  if (options.etag) headers["If-None-Match"] = String(options.etag);
  if (options.lastModified) headers["If-Modified-Since"] = String(options.lastModified);

  let current = parsed.url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetchImpl(current, {
      method: "GET",
      headers,
      redirect: "manual",
    });
    const status = res.status;
    if (status === 304) {
      return { ok: true, notModified: true, url: current, etag: options.etag || "", lastModified: options.lastModified || "" };
    }
    if (status >= 300 && status < 400) {
      const next = resolveRedirect(current, headerValue(res.headers, "location"));
      if (!next.ok) return { ok: false, error: next.error, status };
      current = next.url;
      continue;
    }
    if (!res.ok) return { ok: false, error: "http_error", status };
    const body = await readCappedBody(res, maxBytes);
    if (!body.ok) return body;
    const atom = parseYoutubeAtom(body.text, { maxBytes });
    if (!atom.ok) return { ok: false, error: atom.error };
    return {
      ok: true,
      notModified: false,
      url: current,
      etag: headerValue(res.headers, "etag"),
      lastModified: headerValue(res.headers, "last-modified"),
      entries: atom.entries,
    };
  }
  return { ok: false, error: "too_many_redirects" };
}

module.exports = {
  MAX_FEED_BYTES,
  USER_AGENT,
  fetchYoutubeFeed,
  resolveRedirect,
  isValidFeedUrl,
};
