"use strict";

const fs = require("fs");
const path = require("path");
const { getStateDir } = require("../../lib/local-api-token.js");
const { writeFileAtomic } = require("../utils.js");
const { VIDEO_ID_RE } = require("./watch-feeds.js");

const FILE_NAME = "tusk-watch-seen.json";
const MAX_VIDEOS = 2000;

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
      videos: parsed.videos && typeof parsed.videos === "object" ? parsed.videos : {},
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
      return meta && typeof meta === "object" ? { ...meta } : { etag: "", lastModified: "", polledAt: 0 };
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
    unpublished(limit) {
      const state = load();
      const items = Object.entries(state.videos)
        .filter(([, row]) => row && !row.postedAt)
        .map(([videoId, row]) => ({ videoId, ...row }))
        .sort((a, b) => String(b.published || "").localeCompare(String(a.published || "")));
      if (limit == null) return items;
      return items.slice(0, Math.max(0, Number(limit) || 0));
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
        url: row.summaryUrl || row.url || "",
        summary: row.summary,
      };
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
    isDigestPaused() {
      return Boolean(load().digestPaused);
    },
    digestPauseReason() {
      return load().digestPauseReason || "";
    },
    wasCorruptReseed() {
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

module.exports = { createWatchSeen, FILE_NAME, MAX_VIDEOS, seenPath };
