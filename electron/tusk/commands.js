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
    "Paste a YouTube, Spotify episode, or LinkedIn post/event link in a public channel Tusk is in. Tusk adds 👀 and replies in the thread with a summary (or a transcript file).",
    "In that thread, `@Tusk <question>` answers only from that video. Tusk does not search the rest of your library.",
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
