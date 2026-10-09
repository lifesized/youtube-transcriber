"use strict";

const fs = require("fs");
const path = require("path");
const { getStateDir } = require("../../lib/local-api-token.js");
const { writeFileAtomic } = require("../utils.js");

const FILE_NAME = "tusk-no-key-notice.json";
const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function noticePath(dir) {
  return path.join(dir || getStateDir(), FILE_NAME);
}

function createNoKeyNotice(options = {}) {
  const dir = options.stateDir || null;
  const cooldownMs = Number.isFinite(options.cooldownMs) ? options.cooldownMs : DEFAULT_COOLDOWN_MS;
  const nowFn = options.now || Date.now;
  let memory = null;

  function file() {
    return noticePath(dir);
  }

  function empty() {
    return { version: 1, channels: {} };
  }

  function load() {
    if (memory) return memory;
    const filePath = file();
    if (!fs.existsSync(filePath)) {
      memory = empty();
      return memory;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.version !== 1) {
        memory = empty();
        return memory;
      }
      memory = {
        version: 1,
        channels: parsed.channels && typeof parsed.channels === "object" ? parsed.channels : {},
      };
    } catch {
      memory = empty();
    }
    return memory;
  }

  function persist() {
    const state = load();
    writeFileAtomic(file(), JSON.stringify(state, null, 2) + "\n", 0o600);
  }

  return {
    path: file,
    cooldownMs,
    shouldPost(channel) {
      const id = String(channel || "").trim();
      if (!id) return false;
      const last = Number(load().channels[id]) || 0;
      if (!last) return true;
      return nowFn() - last >= cooldownMs;
    },
    markPosted(channel) {
      const id = String(channel || "").trim();
      if (!id) return;
      const state = load();
      state.channels[id] = nowFn();
      persist();
    },
  };
}

module.exports = {
  createNoKeyNotice,
  FILE_NAME,
  DEFAULT_COOLDOWN_MS,
  noticePath,
};
