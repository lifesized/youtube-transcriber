"use strict";

const { randomUUID } = require("node:crypto");
const { channelAllowed, parseChannelAllowlist, normalizeChannelId } = require("./gates.js");
const { fetchYoutubeFeed } = require("./watch-fetch.js");
const { watchUrlForVideoId, feedUrlForSpec } = require("./watch-feeds.js");
const { parseSlackArtifactMarkdown, escapeSlackMrkdwn } = require("./format.js");
const { isTuskAllowedSource } = require("./pipeline.js");
const { buildSlackPrimitivePrompt, resolvePreset } = require("./prompt.js");
const { classifyLocalFailure } = require("./errors.js");

const DEFAULT_POLL_MS = 30 * 60 * 1000;
const DEFAULT_DIGEST_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_VIDEOS = 5;
const DEFAULT_MAX_SUMMARY = 400;
const MAX_VIDEOS_HARD = 10;
const MAX_SUMMARY_HARD = 800;
const BACKOFF_BASE_MS = 30 * 60 * 1000;
const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
const PAUSE_ERRORS = new Set([
  "not_in_channel",
  "channel_not_found",
  "invalid_auth",
  "token_revoked",
]);

const PAUSE_COPY = {
  not_in_channel: "Digest paused: Tusk is not in that channel.",
  channel_not_found: "Digest paused: digest channel was not found.",
  invalid_auth: "Digest paused: Slack token is invalid.",
  token_revoked: "Digest paused: Slack token was revoked.",
};

function slackErrorCode(err) {
  if (!err) return "";
  const code = err.slackError || err.code || err.error || "";
  if (PAUSE_ERRORS.has(code)) return code;
  const message = String(err.message || "").toLowerCase();
  for (const name of PAUSE_ERRORS) {
    if (message.includes(name)) return name;
  }
  return typeof code === "string" ? code : "";
}

function backoffMs(streak) {
  const exp = Math.max(0, Number(streak) - 1);
  return Math.min(BACKOFF_BASE_MS * 2 ** exp, BACKOFF_MAX_MS);
}

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

function escapeSlackBold(value) {
  return escapeSlackMrkdwn(value).replace(/[*_]/g, (ch) => `\\${ch}`);
}

function formatDigestMessage(items, maxSummary) {
  const blocks = ["*Tusk watch digest*"];
  for (const item of items) {
    const title = escapeSlackBold(item.title || "Video");
    const url = item.url || watchUrlForVideoId(item.videoId);
    const summary = item.summary ? clipSummary(item.summary, maxSummary) : "";
    blocks.push(["", `*${title}*`, escapeSlackMrkdwn(url), summary].filter(Boolean).join("\n"));
  }
  return blocks.join("\n");
}

function isLlmCapError(err) {
  if (!err || typeof err !== "object") return false;
  const payloadCode = err.payload && typeof err.payload.code === "string" ? err.payload.code : "";
  const code = err.code || payloadCode;
  if (code === "llm_hourly_cap" || code === "llm_daily_cap" || code === "override_hourly_cap") {
    return true;
  }
  const classified = classifyLocalFailure(err).code;
  return classified === "llm_hourly_cap" || classified === "llm_daily_cap";
}

function isNoAttemptSkip(item) {
  const skipped = item && item.skipped;
  return (
    skipped === "queue_full" ||
    skipped === "deduped" ||
    skipped === "llm_hourly_cap" ||
    skipped === "llm_daily_cap"
  );
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
  let failStreak = 0;
  let paused = false;
  let pauseReason = "";

  function stop() {
    stopped = true;
    if (pollTimer != null) timers.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function pauseCopy(reason) {
    return PAUSE_COPY[reason] || "Digest paused.";
  }

  function emitPause(reason) {
    paused = true;
    pauseReason = reason;
    if (typeof seen.pauseDigest === "function") seen.pauseDigest(reason);
    stop();
    if (typeof options.onPause === "function") {
      options.onPause({ reason, message: pauseCopy(reason) });
    }
  }

  function reportPauseStatus() {
    const persisted = Boolean(seen.isDigestPaused && seen.isDigestPaused());
    const reason = pauseReason || (seen.digestPauseReason && seen.digestPauseReason()) || "";
    if (!paused && !persisted) return false;
    paused = true;
    pauseReason = reason;
    if (typeof options.onPause === "function") {
      options.onPause({ reason, message: pauseCopy(reason) });
    }
    return true;
  }

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
    if (seen.wasCorruptReseed && seen.wasCorruptReseed()) {
      results.push({ reseeds: true, status: "Watch seen-state was corrupt; reseeding without a flood." });
      if (typeof options.onStatus === "function") {
        options.onStatus({
          digest: { message: "Watch seen-state was corrupt; reseeding without a flood." },
        });
      }
      if (typeof seen.clearCorruptReseed === "function") seen.clearCorruptReseed();
    }
    for (const feed of cfg.watchFeeds) {
      try {
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
          seen.setFeedMeta(feed.url, {
            etag: fetched.etag || meta.etag,
            lastModified: fetched.lastModified || meta.lastModified,
          });
        }
        results.push({ url: feed.url, notModified: Boolean(fetched.notModified), seeded: firstPoll });
      } catch (err) {
        results.push({ url: feed.url, error: (err && err.message) || "feed_failed" });
      }
    }
    return { ok: true, results };
  }

  function digestDue(cfg) {
    if (paused || (seen.isDigestPaused && seen.isDigestPaused())) return false;
    const last = seen.lastDigestAt();
    const origin = last || startedAt || now();
    const wait = failStreak > 0 ? backoffMs(failStreak) : cfg.digestIntervalMs;
    return now() - origin >= wait;
  }

  async function summarizeOne(entry, cfg, signal, jobId) {
    const url = watchUrlForVideoId(entry.videoId);
    if (!url) return null;
    const extra = { signal, jobTag: "tusk", jobId: jobId || randomUUID() };
    const video = await local.createTranscript(url, extra);
    if (
      !isTuskAllowedSource({
        platform: (video && video.platform) || "youtube",
        source: video && video.source,
      })
    ) {
      return { skipped: "not_youtube", videoId: entry.videoId };
    }
    let summary = "";
    try {
      const result = await local.createSummary(video && video.id, {
        ...extra,
        promptOverride: buildSlackPrimitivePrompt({
          title: (video && video.title) || entry.title || "Video",
          preset: resolvePreset(cfg.preset),
        }),
      });
      summary = (result && (result.summary_md || result.summary)) || "";
    } catch (err) {
      if (isLlmCapError(err)) {
        return { skipped: err.code === "llm_daily_cap" ? "llm_daily_cap" : "llm_hourly_cap" };
      }
      return null;
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
    if (paused || (seen.isDigestPaused && seen.isDigestPaused())) {
      return { skipped: "paused", reason: pauseReason || (seen.digestPauseReason && seen.digestPauseReason()) };
    }
    if (!cfg.enabled) return { skipped: "disabled" };
    if (!opts.force && !digestDue(cfg)) return { skipped: "not_due" };
    if (!digestChannelAllowed(cfg.digestChannel, cfg.channelAllowlist)) {
      return { skipped: "channel", reason: "digest channel is not on the allowlist" };
    }
    const pending = seen.unpublished(cfg.maxVideos, now());
    if (!pending.length) return { skipped: "empty" };
    const items = [];
    for (const entry of pending) {
      const cached = seen.getCachedSummary && seen.getCachedSummary(entry.videoId);
      if (cached) {
        items.push(cached);
        if (items.length >= cfg.maxVideos) break;
        continue;
      }
      try {
        const item = options.runJob
          ? await options.runJob(`digest:${entry.videoId}`, (signal, jobId) =>
              summarizeOne(entry, cfg, signal, jobId)
            )
          : await summarizeOne(entry, cfg, opts.signal);
        if (item && item.skipped === "not_youtube") {
          seen.markPosted([entry.videoId], { digest: false });
          continue;
        }
        if (isNoAttemptSkip(item)) continue;
        if (!item || item.skipped) {
          if (typeof seen.noteVideoFailure === "function") seen.noteVideoFailure(entry.videoId);
          continue;
        }
        if (typeof seen.cacheSummary === "function") seen.cacheSummary(entry.videoId, item);
        items.push(item);
      } catch (err) {
        if (isLlmCapError(err)) continue;
        if (typeof seen.noteVideoFailure === "function") seen.noteVideoFailure(entry.videoId);
      }
      if (items.length >= cfg.maxVideos) break;
    }
    if (!items.length) {
      if (typeof seen.noteDigestAttempt === "function") seen.noteDigestAttempt();
      return { skipped: "no_items" };
    }
    const text = formatDigestMessage(items, cfg.maxSummaryChars);
    try {
      await slack.postMessage({
        botToken: cfg.botToken,
        channel: cfg.digestChannel,
        text,
        unfurl_links: false,
        unfurl_media: false,
      });
    } catch (err) {
      failStreak += 1;
      if (typeof seen.noteDigestAttempt === "function") seen.noteDigestAttempt();
      const reason = slackErrorCode(err);
      if (PAUSE_ERRORS.has(reason)) {
        emitPause(reason);
        return { ok: false, error: reason, paused: true, message: pauseCopy(reason) };
      }
      return { ok: false, error: "post_failed", backoffMs: backoffMs(failStreak) };
    }
    failStreak = 0;
    seen.markPosted(items.map((item) => item.videoId));
    return { ok: true, count: items.length, channel: cfg.digestChannel, text };
  }

  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      await pollOnce();
      await digestOnce({ signal: options.signal });
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
      pollTimer = null;
      if (reportPauseStatus()) return;
      schedule(0);
    },
    stop,
    pollOnce,
    digestOnce,
    tick,
    formatDigestMessage,
    digestChannelAllowed,
    reportPauseStatus,
    isStopped: () => stopped,
    isPaused: () => paused || Boolean(seen.isDigestPaused && seen.isDigestPaused()),
    hasPollScheduled: () => pollTimer != null,
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
