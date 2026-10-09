"use strict";

const fs = require("fs");
const path = require("path");
const { getStateDir } = require("../../lib/local-api-token.js");
const { writeFileAtomic } = require("../utils.js");
const { VIDEO_ID_RE, watchUrlForVideoId } = require("./watch-feeds.js");

const FILE_NAME = "tusk-watch-seen.json";
const MAX_VIDEOS = 2000;
const MAX_VIDEO_ATTEMPTS = 3;
const VIDEO_BACKOFF_BASE_MS = 30 * 60 * 1000;
const VIDEO_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;

function videoBackoffMs(attempts) {
  const exp = Math.max(0, Number(attempts) - 1);
  return Math.min(VIDEO_BACKOFF_BASE_MS * 2 ** exp, VIDEO_BACKOFF_MAX_MS);
}

function seenPath(dir) {
  return path.join(dir || getStateDir(), FILE_NAME);
}

function emptyState() {
  return {
    version: 1,
    videos: {},
    feeds: {},
    lastDigestAt: 0,
    digestPaused: false,
    digestPauseReason: "",
  };
}

function sanitizeHeaderValue(value) {
  return String(value || "").replace(/[\r\n\0]+/g, "").slice(0, 256);
}

function clampAttempts(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_VIDEO_ATTEMPTS, Math.max(0, Math.trunc(n)));
}

function clampNextAttemptAt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

function sanitizeVideos(videos) {
  if (!videos || typeof videos !== "object" || Array.isArray(videos)) return {};
  const out = {};
  for (const [id, row] of Object.entries(videos)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    out[id] = {
      ...row,
      attempts: clampAttempts(row.attempts),
      nextAttemptAt: clampNextAttemptAt(row.nextAttemptAt),
    };
  }
  return out;
}

function createWatchSeen(options = {}) {
  const dir = options.stateDir || null;
  const nowFn = options.now || Date.now;
  let memory = null;
  let corruptReseed = false;
  const onCorrupt = options.onCorrupt;

  function file() {
    return seenPath(dir);
  }

  function load() {
    if (memory) return memory;
    const filePath = file();
    if (!fs.existsSync(filePath)) {
      memory = emptyState();
      return memory;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.version !== 1) {
      const aside = `${filePath}.corrupt-${nowFn()}`;
      try {
        fs.renameSync(filePath, aside);
      } catch {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // best-effort
        }
      }
      memory = emptyState();
      corruptReseed = true;
      persist();
      if (typeof onCorrupt === "function") {
        onCorrupt({ path: aside, message: "Watch seen-state was corrupt; reseeding without a flood." });
      }
      return memory;
    }
    memory = {
      version: 1,
      videos: sanitizeVideos(parsed.videos),
      feeds: parsed.feeds && typeof parsed.feeds === "object" ? parsed.feeds : {},
      lastDigestAt: Number(parsed.lastDigestAt) || 0,
      digestPaused: Boolean(parsed.digestPaused),
      digestPauseReason: parsed.digestPauseReason ? String(parsed.digestPauseReason).slice(0, 80) : "",
    };
    return memory;
  }

  function persist() {
    const state = load();
    prune(state);
    writeFileAtomic(file(), JSON.stringify(state, null, 2) + "\n", 0o600);
    return state;
  }

  function prune(state) {
    const ids = Object.keys(state.videos);
    if (ids.length <= MAX_VIDEOS) return;
    const posted = ids
      .filter((id) => state.videos[id] && state.videos[id].postedAt)
      .sort((a, b) => (state.videos[a].postedAt || 0) - (state.videos[b].postedAt || 0));
    let extra = ids.length - MAX_VIDEOS;
    for (const id of posted) {
      if (extra <= 0) break;
      delete state.videos[id];
      extra -= 1;
    }
  }

  return {
    path: file,
    load,
    getFeedMeta(url) {
      const state = load();
      const meta = state.feeds[url];
      if (!meta || typeof meta !== "object") {
        return { etag: "", lastModified: "", polledAt: 0 };
      }
      return {
        etag: sanitizeHeaderValue(meta.etag),
        lastModified: sanitizeHeaderValue(meta.lastModified),
        polledAt: Number(meta.polledAt) || 0,
      };
    },
    setFeedMeta(url, meta) {
      const state = load();
      state.feeds[String(url)] = {
        etag: sanitizeHeaderValue(meta && meta.etag),
        lastModified: sanitizeHeaderValue(meta && meta.lastModified),
        polledAt: nowFn(),
      };
      persist();
    },
    rememberVideos(entries) {
      const state = load();
      const now = nowFn();
      const fresh = [];
      for (const entry of entries || []) {
        const videoId = entry && entry.videoId;
        if (!VIDEO_ID_RE.test(videoId)) continue;
        if (!state.videos[videoId]) {
          state.videos[videoId] = {
            firstSeenAt: now,
            postedAt: 0,
            attempts: 0,
            nextAttemptAt: 0,
            title: entry.title ? String(entry.title).slice(0, 200) : "",
            url: entry.url || "",
            published: entry.published || "",
            author: entry.author || "",
          };
          fresh.push({ ...state.videos[videoId], videoId });
        }
      }
      persist();
      return fresh;
    },
    unpublished(limit, when) {
      const state = load();
      const at = Number.isFinite(when) ? when : nowFn();
      const items = Object.entries(state.videos)
        .filter(([, row]) => {
          if (!row || row.postedAt) return false;
          const next = Number(row.nextAttemptAt) || 0;
          return next <= at;
        })
        .map(([videoId, row]) => ({ videoId, ...row }))
        .sort((a, b) => String(b.published || "").localeCompare(String(a.published || "")));
      if (limit == null) return items;
      return items.slice(0, Math.max(0, Number(limit) || 0));
    },
    noteVideoFailure(videoId) {
      const state = load();
      const row = state.videos[videoId];
      if (!row) return { attempts: 0, dropped: false };
      const attempts = (Number(row.attempts) || 0) + 1;
      row.attempts = attempts;
      if (attempts >= MAX_VIDEO_ATTEMPTS) {
        row.postedAt = nowFn();
        row.nextAttemptAt = 0;
        persist();
        return { attempts, dropped: true };
      }
      row.nextAttemptAt = nowFn() + videoBackoffMs(attempts);
      persist();
      return { attempts, dropped: false };
    },
    videoAttempts(videoId) {
      const row = load().videos[videoId];
      return row ? Number(row.attempts) || 0 : 0;
    },
    markPosted(videoIds, opts = {}) {
      const state = load();
      const now = nowFn();
      for (const id of videoIds || []) {
        if (state.videos[id]) state.videos[id].postedAt = now;
      }
      if (opts.digest !== false) state.lastDigestAt = now;
      persist();
    },
    cacheSummary(videoId, item) {
      const state = load();
      if (!state.videos[videoId]) return;
      state.videos[videoId].summary = String((item && item.summary) || "").slice(0, 4000);
      state.videos[videoId].summaryTitle = String((item && item.title) || "").slice(0, 200);
      state.videos[videoId].summaryUrl = String((item && item.url) || "").slice(0, 300);
      persist();
    },
    getCachedSummary(videoId) {
      const row = load().videos[videoId];
      if (!row || typeof row.summary !== "string" || !row.summary) return null;
      return {
        videoId,
        title: row.summaryTitle || row.title || "Video",
        url: watchUrlForVideoId(videoId),
        summary: row.summary,
      };
    },
    clearCorruptReseed() {
      corruptReseed = false;
    },
    noteDigestAttempt() {
      const state = load();
      state.lastDigestAt = nowFn();
      persist();
    },
    pauseDigest(reason) {
      const state = load();
      state.digestPaused = true;
      state.digestPauseReason = String(reason || "").slice(0, 80);
      persist();
    },
    clearDigestPause() {
      const state = load();
      state.digestPaused = false;
      state.digestPauseReason = "";
      persist();
    },
    isDigestPaused() {
      return Boolean(load().digestPaused);
    },
    digestPauseReason() {
      return load().digestPauseReason || "";
    },
    wasCorruptReseed() {
      load();
      return corruptReseed;
    },
    lastDigestAt() {
      return load().lastDigestAt || 0;
    },
    isPosted(videoId) {
      const row = load().videos[videoId];
      return Boolean(row && row.postedAt);
    },
  };
}

module.exports = {
  createWatchSeen,
  FILE_NAME,
  MAX_VIDEOS,
  MAX_VIDEO_ATTEMPTS,
  seenPath,
};
