"use strict";

function tuskConfirmDialogOptions({ workspace, resetWorkspace } = {}) {
  const name = typeof workspace === "string" ? workspace.trim() : "";
  let message;
  if (resetWorkspace) {
    message = name
      ? `Reset the Tusk workspace pin for ${name} and change the saved Slack tokens?`
      : "Reset the Tusk workspace pin and change the saved Slack tokens?";
  } else {
    message = name
      ? `Change the saved Slack tokens for ${name}?`
      : "Change the saved Slack tokens?";
  }
  return {
    type: "question",
    buttons: ["Cancel", "Change"],
    defaultId: 0,
    cancelId: 0,
    message,
    detail: "Cancel leaves the current tokens in place.",
  };
}

async function confirmTuskSensitiveChange(dialog, info) {
  if (!dialog || typeof dialog.showMessageBox !== "function") return false;
  const result = await dialog.showMessageBox(tuskConfirmDialogOptions(info));
  return Boolean(result && result.response === 1);
}

function cancelledError(message) {
  const err = new Error(message || "Tusk settings change was cancelled.");
  err.status = 409;
  err.code = "TUSK_SETTINGS_CANCELLED";
  return err;
}

module.exports = {
  tuskConfirmDialogOptions,
  confirmTuskSensitiveChange,
  cancelledError,
};
