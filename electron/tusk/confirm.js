"use strict";

function tuskConfirmDialogOptions({
  workspace,
  resetWorkspace,
  tokensChanged,
  allowlistAdded,
  enabledOn,
  teamId,
  authUrl,
  currentPin,
  newPin,
} = {}) {
  const name = typeof workspace === "string" ? workspace.trim() : "";
  const id = typeof teamId === "string" ? teamId.trim() : "";
  const named = name || id;
  const changingTokens = Boolean(tokensChanged || resetWorkspace || (!allowlistAdded && !enabledOn));

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
  } else {
    message = "Confirm this Tusk settings change?";
  }

  const detail = [
    "Cancel leaves the current settings in place.",
    id ? `Team ID: ${id}` : null,
    authUrl ? `auth.test URL: ${authUrl}` : null,
    currentPin || newPin
      ? `Workspace pin: ${currentPin || "(none)"} → ${newPin || "(none)"}`
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
  tuskConfirmDialogOptions,
  confirmTuskSensitiveChange,
  cancelledError,
  busyError,
  allowlistIdsAdded,
};
