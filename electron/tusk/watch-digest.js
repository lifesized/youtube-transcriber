"use strict";

const { channelAllowed, parseChannelAllowlist, normalizeChannelId } = require("./gates.js");
const { fetchYoutubeFeed } = require("./watch-fetch.js");
const { watchUrlForVideoId, feedUrlForSpec } = require("./watch-feeds.js");
const { parseSlackArtifactMarkdown, escapeSlackMrkdwn } = require("./format.js");

const DEFAULT_POLL_MS = 30 * 60 * 1000;
const DEFAULT_DIGEST_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_VIDEOS = 5;
const DEFAULT_MAX_SUMMARY = 400;
const MAX_VIDEOS_HARD = 10;
const MAX_SUMMARY_HARD = 800;

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clipSummary(raw, max) {
  const parsed = parseSlackArtifactMarkdown(raw);
  const body = (parsed.tldr || String(raw || "").replace(/\s+/g, " ")).trim();
  const escaped = escapeSlackMrkdwn(body);
  if (escaped.length <= max) return escaped;
  return `${escaped.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function formatDigestMessage(items, maxSummary) {
  const blocks = ["*Tusk watch digest*"];
  for (const item of items) {
    const title = escapeSlackMrkdwn(item.title || "Video");
    const url = item.url || watchUrlForVideoId(item.videoId);
    const summary = item.summary ? clipSummary(item.summary, maxSummary) : "";
    blocks.push(["", `*${title}*`, escapeSlackMrkdwn(url), summary].filter(Boolean).join("\n"));
  }
  return blocks.join("\n");
}

function digestChannelAllowed(channel, allowlist) {
  const id = normalizeChannelId(channel);
  if (!id) return false;
  return channelAllowed(id, allowlist, "channel");
}

function createWatchDigest(options = {}) {
  const getConfig = options.getConfig || (() => options.config || {});
  const seen = options.seen;
  const slack = options.slackApi;
  const local = options.localClient;
  const fetchFeed = options.fetchFeed || fetchYoutubeFeed;
  const timers = options.timers || {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  const now = options.now || Date.now;
  let pollTimer = null;
  let stopped = true;
  let startedAt = 0;
  let running = false;

  function config() {
    const cfg = getConfig() || {};
    const feeds = Array.isArray(cfg.watchFeeds) ? cfg.watchFeeds : [];
    return {
      enabled: cfg.enabled !== false,
      botToken: cfg.botToken || "",
      watchFeeds: feeds
        .map((feed) => {
          if (feed && feed.url) return feed;
          const url = feedUrlForSpec(feed || {});
          return url ? { ...feed, url } : null;
        })
        .filter(Boolean),
      digestChannel: normalizeChannelId(cfg.digestChannel),
      channelAllowlist: parseChannelAllowlist(cfg.channelAllowlist),
      pollIntervalMs: clamp(cfg.pollIntervalMs, 15 * 60 * 1000, 24 * 60 * 60 * 1000, DEFAULT_POLL_MS),
      digestIntervalMs: clamp(cfg.digestIntervalMs, 30 * 60 * 1000, 7 * 24 * 60 * 60 * 1000, DEFAULT_DIGEST_MS),
      maxVideos: clamp(cfg.maxVideos, 1, MAX_VIDEOS_HARD, DEFAULT_MAX_VIDEOS),
      maxSummaryChars: clamp(cfg.maxSummaryChars, 80, MAX_SUMMARY_HARD, DEFAULT_MAX_SUMMARY),
    };
  }

  async function pollOnce() {
    const cfg = config();
    if (!cfg.enabled || !cfg.watchFeeds.length) return { skipped: "disabled" };
    const results = [];
    for (const feed of cfg.watchFeeds) {
      const meta = seen.getFeedMeta(feed.url);
      const firstPoll = !meta.polledAt;
      const fetched = await fetchFeed(feed.url, {
        etag: meta.etag,
        lastModified: meta.lastModified,
        fetchImpl: options.fetchImpl,
      });
      if (!fetched.ok) {
        results.push({ url: feed.url, error: fetched.error });
        continue;
      }
      if (!fetched.notModified) {
        seen.setFeedMeta(feed.url, { etag: fetched.etag, lastModified: fetched.lastModified });
        const entries = fetched.entries || [];
        seen.rememberVideos(entries);
        if (firstPoll) {
          seen.markPosted(entries.map((entry) => entry.videoId));
        }
      } else {
        seen.setFeedMeta(feed.url, { etag: fetched.etag || meta.etag, lastModified: fetched.lastModified || meta.lastModified });
      }
      results.push({ url: feed.url, notModified: Boolean(fetched.notModified), seeded: firstPoll });
    }
    return { ok: true, results };
  }

  function digestDue(cfg) {
    const last = seen.lastDigestAt();
    const origin = last || startedAt || now();
    return now() - origin >= cfg.digestIntervalMs;
  }

  async function summarizeOne(entry, cfg) {
    const url = watchUrlForVideoId(entry.videoId);
    if (!url) return null;
    const video = await local.createTranscript(url);
    let summary = "";
    try {
      const result = await local.createSummary(video && video.id);
      summary = (result && (result.summary_md || result.summary)) || "";
    } catch {
      summary = "";
    }
    return {
      videoId: entry.videoId,
      title: (video && video.title) || entry.title || "Video",
      url,
      summary,
    };
  }

  async function digestOnce(opts = {}) {
    const cfg = config();
    if (!cfg.enabled) return { skipped: "disabled" };
    if (!opts.force && !digestDue(cfg)) return { skipped: "not_due" };
    if (!digestChannelAllowed(cfg.digestChannel, cfg.channelAllowlist)) {
      return { skipped: "channel", reason: "digest channel is not on the allowlist" };
    }
    const pending = seen.unpublished(cfg.maxVideos);
    if (!pending.length) return { skipped: "empty" };
    const items = [];
    const postedIds = [];
    for (const entry of pending) {
      try {
        const item = await summarizeOne(entry, cfg);
        if (item) {
          items.push(item);
          postedIds.push(entry.videoId);
        }
      } catch {
        postedIds.push(entry.videoId);
      }
      if (items.length >= cfg.maxVideos) break;
    }
    if (!items.length) {
      if (postedIds.length) seen.markPosted(postedIds);
      return { skipped: "no_items" };
    }
    const text = formatDigestMessage(items, cfg.maxSummaryChars);
    await slack.postMessage({
      botToken: cfg.botToken,
      channel: cfg.digestChannel,
      text,
      unfurl_links: false,
      unfurl_media: false,
    });
    seen.markPosted(postedIds);
    return { ok: true, count: items.length, channel: cfg.digestChannel, text };
  }

  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      await pollOnce();
      await digestOnce();
    } finally {
      running = false;
    }
  }

  function schedule(delay) {
    if (stopped) return;
    pollTimer = timers.setTimeout(() => {
      pollTimer = null;
      tick()
        .catch(() => {})
        .finally(() => {
          if (!stopped) schedule(config().pollIntervalMs);
        });
    }, delay);
  }

  return {
    start() {
      stopped = false;
      startedAt = now();
      if (pollTimer != null) timers.clearTimeout(pollTimer);
      schedule(0);
    },
    stop() {
      stopped = true;
      if (pollTimer != null) timers.clearTimeout(pollTimer);
      pollTimer = null;
    },
    pollOnce,
    digestOnce,
    tick,
    formatDigestMessage,
    digestChannelAllowed,
    isStopped: () => stopped,
  };
}

module.exports = {
  createWatchDigest,
  formatDigestMessage,
  digestChannelAllowed,
  clipSummary,
  DEFAULT_POLL_MS,
  DEFAULT_DIGEST_MS,
  DEFAULT_MAX_VIDEOS,
  DEFAULT_MAX_SUMMARY,
};
