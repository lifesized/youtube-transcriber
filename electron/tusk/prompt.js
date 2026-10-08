"use strict";

const PRESET_INSTRUCTIONS = {
  general:
    "Create a concise summary first. Then extract only the useful outputs that are actually present: links/docs, decisions, action items, risks/blockers, and follow-up questions.",
  engineering:
    "Create a concise engineering summary first. Then extract only concrete outputs actually present: GitHub repositories/docs, commands/code/APIs, implementation steps, decisions, action items, risks/blockers, and follow-up questions.",
  sales:
    "Create a concise sales/customer summary first. Then extract only concrete outputs actually present: customer pain, objections, competitors, buying signals, stakeholders, next steps, and follow-up questions.",
  support:
    "Create a concise support/debug summary first. Then extract only concrete outputs actually present: repro steps, environment details, suspected root cause, workaround, escalation owner, risks, and follow-up questions.",
  leadership:
    "Create a concise executive summary first. Then extract only concrete outputs actually present: decisions, open asks, metrics, deadlines, risks, and owners.",
};

function buildSlackPrimitivePrompt(options) {
  const presetInstructions =
    options.preset === "custom"
      ? options.customInstructions && options.customInstructions.trim()
      : PRESET_INSTRUCTIONS[options.preset];
  const instructions = presetInstructions || PRESET_INSTRUCTIONS.general;
  return `Analyze this transcript from "${options.title}" and turn it into structured work primitives for Slack.

Customer instructions:
${instructions}

Return concise Slack-friendly markdown with these sections when present:
- ✦ Summary
- ↗ Links
- ⌘ Commands / code
- → Next steps
- ◆ Decisions
- △ Watchouts
- ? Questions

Rules:
- Start with Summary. Keep it to 2–3 short sentences, max 450 characters.
- Omit empty or weak sections. If there are no real commands, code, or APIs, omit that section.
- Cap every non-TL;DR section at 3 bullets. Cap each bullet at 160 characters.
- Keep the whole Slack answer under 1,500 characters when possible.
- Do not invent links, owners, commands, deadlines, or decisions.
- Do not use markdown links like [label](url). Do not use Slack mrkdwn links like <url|label>. Write plain https URLs only.
- If a timestamp is useful, include it as [MM:SS].
- Do not include preamble, caveats, or a closing note.`;
}

function resolvePreset(value) {
  return ["general", "engineering", "sales", "support", "leadership", "custom"].includes(value)
    ? value
    : "engineering";
}

function resolveArtifactMode(text) {
  if (/(?:^|\s)(?:summarize|summary|s)(?:\s|$)/i.test(text)) return "summary";
  return /(?:^|\s)(?:transcript|transcribe|t)(?:\s|$)/i.test(text) ? "transcript" : "summary";
}

function isMentionTriggered(text, botUserId) {
  return Boolean(botUserId && String(text || "").includes(`<@${botUserId}>`));
}

function stripMention(text, botUserId) {
  let out = String(text || "");
  if (botUserId) out = out.replaceAll(`<@${botUserId}>`, "");
  return out.replace(/\s+/g, " ").trim();
}

function buildThreadQuestionPrompt(options) {
  const title = options.title || "this video";
  const question = String(options.question || "").trim() || "What were the key points?";
  return `Answer this question using ONLY the transcript of "${title}".

Question:
${question}

Rules:
- Use only facts present in the transcript. If the transcript does not say, reply that you do not know.
- Do not invent links, people, tools, channels, or URLs.
- Do not use markdown links or Slack mrkdwn links like <url|label>. Write plain text and plain https URLs that already appear in the transcript.
- Keep the answer under 1,200 characters. No preamble.`;
}

module.exports = {
  buildSlackPrimitivePrompt,
  buildThreadQuestionPrompt,
  resolvePreset,
  resolveArtifactMode,
  isMentionTriggered,
  stripMention,
  PRESET_INSTRUCTIONS,
};
