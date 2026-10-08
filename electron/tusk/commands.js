"use strict";

function parseSlashText(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t || t === "help") return "help";
  if (t === "status") return "status";
  return "unknown";
}

function helpText() {
  return [
    "*Tusk* runs on this Mac inside Transcriber. No cloud bot.",
    "Paste a YouTube, Spotify episode, or LinkedIn post/event link in this channel. Tusk adds 👀 when it recognizes the URL.",
    "Threaded summaries and `@Tusk` questions come in a later update.",
    "`/tusk status` — connection",
    "`/tusk help` — this message",
  ].join("\n");
}

function statusText(info) {
  const state = info && info.state ? info.state : "off";
  const workspace = info && info.workspace ? info.workspace : "";
  const botName = info && info.botName ? info.botName : "";
  const allowlist = Array.isArray(info && info.channelAllowlist) ? info.channelAllowlist : [];
  const lines = [
    state === "connected" && workspace
      ? `Tusk is connected to *${workspace}*.`
      : state === "error"
        ? "Tusk is on, but the Slack socket is in *error*."
        : "Tusk is *off*.",
  ];
  if (botName) lines.push(`Bot: @${botName.replace(/^@/, "")}`);
  lines.push(
    allowlist.length
      ? `Channel allowlist: ${allowlist.length} id(s).`
      : "Channel allowlist: public channels Tusk is invited to. DMs, MPIMs, and private channels are denied."
  );
  return lines.join("\n");
}

function slashReply(command, info) {
  if (command === "status") return statusText(info);
  if (command === "unknown") {
    return `${helpText()}\n\nUnknown subcommand. Try \`help\` or \`status\`.`;
  }
  return helpText();
}

module.exports = {
  parseSlashText,
  helpText,
  statusText,
  slashReply,
};
