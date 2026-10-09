"use strict";

const { parseWatchlistText } = require("./watch-feeds.js");

function cleanDialogField(value, max = 80) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function feedUrls(feeds) {
  return (feeds || [])
    .map((feed) => (feed && feed.url) || "")
    .filter(Boolean)
    .join("\n");
}

function watchFeedsChanged(currentFeeds, nextFeeds) {
  return feedUrls(currentFeeds) !== feedUrls(nextFeeds);
}

function feedIdsFromWatchlist(text) {
  return parseWatchlistText(text)
    .map((feed) => feed.id)
    .filter(Boolean);
}

function feedIdDiff(oldWatchlist, newWatchlist) {
  const before = new Set(feedIdsFromWatchlist(oldWatchlist));
  const after = new Set(feedIdsFromWatchlist(newWatchlist));
  return {
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
  };
}

function formatFeedIds(ids) {
  if (!ids || !ids.length) return "(none)";
  return ids.map((id) => cleanDialogField(id, 80)).filter(Boolean).join(", ") || "(none)";
}

function tuskConfirmDialogOptions({
  workspace,
  resetWorkspace,
  tokensChanged,
  allowlistAdded,
  enabledOn,
  watchlistChanged,
  digestChannelChanged,
  teamId,
  authUrl,
  currentPin,
  newPin,
  oldDigestChannel,
  newDigestChannel,
  oldWatchlist,
  newWatchlist,
} = {}) {
  const name = cleanDialogField(workspace);
  const oldTeam = cleanDialogField(currentPin);
  const newTeam = cleanDialogField(newPin || teamId);
  const url = cleanDialogField(authUrl);
  const named = name || newTeam || oldTeam;
  const changingTokens = Boolean(
    tokensChanged ||
      resetWorkspace ||
      (!allowlistAdded && !enabledOn && !watchlistChanged && !digestChannelChanged)
  );

  let message;
  if (resetWorkspace) {
    message = named
      ? `Reset the Tusk workspace pin for ${named} and change the saved Slack tokens?`
      : "Reset the Tusk workspace pin and change the saved Slack tokens?";
  } else if (changingTokens) {
    message = named
      ? `Change the saved Slack tokens for ${named}?`
      : "Change the saved Slack tokens?";
  } else if (enabledOn) {
    message = named ? `Turn on Tusk for ${named}?` : "Turn on Tusk?";
  } else if (allowlistAdded) {
    message = named
      ? `Add channel(s) to the Tusk allowlist for ${named}?`
      : "Add channel(s) to the Tusk allowlist?";
  } else if (watchlistChanged || digestChannelChanged) {
    message = named
      ? `Change the Tusk watchlist or digest channel for ${named}?`
      : "Change the Tusk watchlist or digest channel?";
  } else {
    message = "Confirm this Tusk settings change?";
  }

  const detail = [
    "Cancel leaves the current settings in place.",
    `Old team ID: ${oldTeam || "(none)"}`,
    `New team ID: ${newTeam || "(none)"}`,
    url ? `auth.test URL: ${url}` : null,
    watchlistChanged || digestChannelChanged
      ? `Old digest channel: ${cleanDialogField(oldDigestChannel) || "(none)"}`
      : null,
    watchlistChanged || digestChannelChanged
      ? `New digest channel: ${cleanDialogField(newDigestChannel) || "(none)"}`
      : null,
    watchlistChanged || digestChannelChanged
      ? `Added feeds: ${formatFeedIds(feedIdDiff(oldWatchlist, newWatchlist).added)}`
      : null,
    watchlistChanged || digestChannelChanged
      ? `Removed feeds: ${formatFeedIds(feedIdDiff(oldWatchlist, newWatchlist).removed)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    type: "question",
    buttons: ["Cancel", "Change"],
    defaultId: 0,
    cancelId: 0,
    message,
    detail,
  };
}

function resolveConfirmHost(dialogOrHost) {
  if (dialogOrHost && typeof dialogOrHost.showMessageBox === "function") {
    return { dialog: dialogOrHost };
  }
  return dialogOrHost && typeof dialogOrHost === "object" ? dialogOrHost : {};
}

function parentWindowFrom(host) {
  if (host.parentWindow && !host.parentWindow.isDestroyed?.()) return host.parentWindow;
  if (typeof host.getParentWindow === "function") {
    const win = host.getParentWindow();
    if (win && !win.isDestroyed?.()) return win;
  }
  return null;
}

async function confirmTuskSensitiveChange(dialogOrHost, info) {
  const host = resolveConfirmHost(dialogOrHost);
  const dialog = host.dialog;
  if (!dialog || typeof dialog.showMessageBox !== "function") return false;
  if (host.app && typeof host.app.focus === "function") {
    try {
      host.app.focus({ steal: true });
    } catch {
      // focus is best-effort; the dialog still opens
    }
  }
  const opts = tuskConfirmDialogOptions(info);
  const parent = parentWindowFrom(host);
  const result = parent
    ? await dialog.showMessageBox(parent, opts)
    : await dialog.showMessageBox(opts);
  return Boolean(result && result.response === 1);
}

function cancelledError(message) {
  const err = new Error(message || "Tusk settings change was cancelled.");
  err.status = 409;
  err.code = "TUSK_SETTINGS_CANCELLED";
  return err;
}

function busyError(message) {
  const err = new Error(message || "A Tusk confirmation is already open. Finish or cancel it first.");
  err.status = 409;
  err.code = "TUSK_SETTINGS_BUSY";
  return err;
}

function allowlistIdsAdded(currentList, nextList) {
  const before = new Set(currentList || []);
  return (nextList || []).some((id) => id && !before.has(id));
}

module.exports = {
  cleanDialogField,
  tuskConfirmDialogOptions,
  confirmTuskSensitiveChange,
  cancelledError,
  busyError,
  allowlistIdsAdded,
  watchFeedsChanged,
  feedUrls,
  feedIdsFromWatchlist,
  feedIdDiff,
};
