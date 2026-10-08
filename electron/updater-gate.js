"use strict";

/**
 * Whether this running process may initialize electron-updater.
 * Ad-hoc, unsigned, and electron:dev builds must stay off — this is a
 * local-only app and the updater is the only outbound GitHub call.
 */

const UPDATE_FEED = Object.freeze({
  provider: "github",
  owner: "lifesized",
  repo: "youtube-transcriber",
});

function pinnedFeed() {
  return {
    provider: UPDATE_FEED.provider,
    owner: UPDATE_FEED.owner,
    repo: UPDATE_FEED.repo,
    private: false,
  };
}

function feedFromEnvOrSettings(env, settings) {
  void env;
  void settings;
  return pinnedFeed();
}

function readExpectedTeamId(json) {
  if (!json || typeof json !== "object") return "";
  const teamId = typeof json.teamId === "string" ? json.teamId.trim() : "";
  return /^[A-Z0-9]{10}$/.test(teamId) ? teamId : "";
}

function evaluateUpdaterGate(input) {
  const {
    isPackaged = false,
    isDev = false,
    signature = null,
    expectedTeamId = "",
  } = input || {};

  if (isDev) return { enabled: false, reason: "dev", feed: null };
  if (!isPackaged) return { enabled: false, reason: "unpackaged", feed: null };
  if (!expectedTeamId) return { enabled: false, reason: "no-team-id", feed: null };
  if (!signature) return { enabled: false, reason: "no-signature", feed: null };
  if (signature.notSigned) return { enabled: false, reason: "unsigned", feed: null };
  if (signature.adhoc) return { enabled: false, reason: "adhoc", feed: null };
  if (!signature.developerId) {
    return { enabled: false, reason: "not-developer-id", feed: null };
  }
  if (signature.teamId !== expectedTeamId) {
    return { enabled: false, reason: "team-mismatch", feed: null };
  }
  return { enabled: true, reason: "developer-id", feed: pinnedFeed() };
}

module.exports = {
  UPDATE_FEED,
  pinnedFeed,
  feedFromEnvOrSettings,
  readExpectedTeamId,
  evaluateUpdaterGate,
};
