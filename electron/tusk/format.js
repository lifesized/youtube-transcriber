"use strict";

function escapeSlackMrkdwn(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function bulletList(items) {
  return (items ?? [])
    .filter(Boolean)
    .map((item) => `• ${item}`)
    .join("\n");
}

function section(label, body) {
  if (!body || !String(body).trim()) return null;
  return `*${label}*\n${escapeSlackMrkdwn(String(body).trim())}`;
}

function truncateSlackMarkdown(text, maxLength) {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength - 2);
  const splitAt = Math.max(
    slice.lastIndexOf("\n\n"),
    slice.lastIndexOf("\n"),
    slice.lastIndexOf(" ")
  );
  return `${slice.slice(0, splitAt > 0 ? splitAt : slice.length).trim()}…`;
}

function renderSlackArtifactMarkdown(artifact) {
  const title = artifact.title && String(artifact.title).trim();
  const sourceUrl = artifact.sourceUrl ? String(artifact.sourceUrl).trim() : "";
  const header = title
    ? `*${escapeSlackMrkdwn(title)}*${sourceUrl ? `\n${escapeSlackMrkdwn(sourceUrl)}` : ""}`
    : sourceUrl
      ? escapeSlackMrkdwn(sourceUrl)
      : null;

  const sections = [
    header,
    section("✦ Summary", artifact.tldr),
    section("↗ Links", bulletList(artifact.links)),
    section("⌘ Commands / code", bulletList(artifact.commands)),
    section("→ Next steps", bulletList(artifact.actionItems)),
    section("◆ Decisions", bulletList(artifact.decisions)),
    section("△ Watchouts", bulletList(artifact.risks)),
    section("? Questions", bulletList(artifact.followUpQuestions)),
  ].filter(Boolean);

  return truncateSlackMarkdown(sections.join("\n\n"), 3800);
}

const SECTION_PATTERNS = [
  { pattern: /^(summary|tl\s*[;,:/]?\s*dr)$/i, key: "tldr", bulletize: false },
  { pattern: /^links?(\s*\/\s*(repos?|docs?))*$/i, key: "links", bulletize: true },
  { pattern: /^commands?(\s*\/\s*(code|apis?))*$/i, key: "commands", bulletize: true },
  { pattern: /^(action items?|next steps?|do next)$/i, key: "actionItems", bulletize: true },
  { pattern: /^decisions?$/i, key: "decisions", bulletize: true },
  { pattern: /^(risks?(\s*\/\s*blockers?)?|watchouts?)$/i, key: "risks", bulletize: true },
  { pattern: /^(follow[- ]?up questions?|questions?)$/i, key: "followUpQuestions", bulletize: true },
];

function stripLabel(line) {
  return line
    .replace(/^[#*\s]+/, "")
    .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*/u, "")
    .replace(/^[✦↗⌘→◆△?]+\s*/u, "")
    .replace(/[*:]+\s*$/, "")
    .trim();
}

function isBulletLine(line) {
  return /^\s*([-*•]|\d+[.)])\s+/.test(line);
}

function stripBullet(line) {
  return line.replace(/^\s*([-*•]|\d+[.)])\s+/, "").trim();
}

function matchSectionLabel(line) {
  const label = stripLabel(line);
  if (!label) return null;
  for (const candidate of SECTION_PATTERNS) {
    if (candidate.pattern.test(label)) {
      return { key: candidate.key, bulletize: candidate.bulletize };
    }
  }
  return null;
}

function parseSlackArtifactMarkdown(raw, meta = {}) {
  const result = {
    title: meta.title ?? null,
    sourceUrl: meta.sourceUrl ?? null,
  };
  const lines = String(raw || "").split(/\r?\n/);
  let currentKey = null;
  let currentBulletize = false;
  let buffer = [];

  const flush = () => {
    if (!currentKey) return;
    const cleaned = buffer.map((line) => line.trim()).filter((line) => line.length > 0);
    if (cleaned.length === 0) {
      buffer = [];
      return;
    }
    if (currentBulletize) {
      result[currentKey] = cleaned
        .map((line) => (isBulletLine(line) ? stripBullet(line) : line))
        .filter((line) => line.length > 0);
    } else {
      result[currentKey] = cleaned.join(" ");
    }
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const match = matchSectionLabel(line);
    if (match) {
      flush();
      currentKey = match.key;
      currentBulletize = match.bulletize;
      continue;
    }
    if (currentKey) buffer.push(line);
  }
  flush();
  return result;
}

function artifactHasBody(parsed) {
  return Boolean(
    parsed.tldr ||
      (parsed.links && parsed.links.length) ||
      (parsed.commands && parsed.commands.length) ||
      (parsed.actionItems && parsed.actionItems.length) ||
      (parsed.decisions && parsed.decisions.length) ||
      (parsed.risks && parsed.risks.length) ||
      (parsed.followUpQuestions && parsed.followUpQuestions.length)
  );
}

function renderSummaryMarkdown(raw, meta) {
  const parsed = parseSlackArtifactMarkdown(raw, meta);
  if (!artifactHasBody(parsed)) {
    parsed.tldr = String(raw || "").trim() || "Summary ready.";
  }
  return renderSlackArtifactMarkdown(parsed);
}

module.exports = {
  escapeSlackMrkdwn,
  renderSlackArtifactMarkdown,
  parseSlackArtifactMarkdown,
  renderSummaryMarkdown,
  artifactHasBody,
};
