export interface SlackArtifactSections {
  title?: string | null;
  sourceUrl?: string | null;
  tldr?: string | null;
  links?: string[];
  commands?: string[];
  actionItems?: string[];
  decisions?: string[];
  risks?: string[];
  followUpQuestions?: string[];
}

function bulletList(items: string[] | undefined): string {
  return (items ?? []).filter(Boolean).map((item) => `• ${item}`).join("\n");
}

function section(label: string, body: string | null | undefined): string | null {
  if (!body?.trim()) return null;
  return `*${label}*\n${body.trim()}`;
}

function truncateSlackMarkdown(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength - 2);
  const splitAt = Math.max(
    slice.lastIndexOf("\n\n"),
    slice.lastIndexOf("\n"),
    slice.lastIndexOf(" "),
  );
  return `${slice.slice(0, splitAt > 0 ? splitAt : slice.length).trim()}…`;
}

export function renderSlackArtifactMarkdown(artifact: SlackArtifactSections): string {
  const header = artifact.title?.trim()
    ? `*${artifact.title.trim()}*${artifact.sourceUrl ? `\n${artifact.sourceUrl}` : ""}`
    : artifact.sourceUrl ?? null;

  const sections = [
    header,
    section("✦ Summary", artifact.tldr),
    section("↗ Links", bulletList(artifact.links)),
    section("⌘ Commands / code", bulletList(artifact.commands)),
    section("→ Next steps", bulletList(artifact.actionItems)),
    section("◆ Decisions", bulletList(artifact.decisions)),
    section("△ Watchouts", bulletList(artifact.risks)),
    section("? Questions", bulletList(artifact.followUpQuestions)),
  ].filter((part): part is string => Boolean(part));

  return truncateSlackMarkdown(sections.join("\n\n"), 3800);
}

// Mapping from prompt-template section labels (with or without leading
// markdown emphasis / hash) to fields on SlackArtifactSections. Matches the
// label set produced by buildSlackPrimitivePrompt in ./primitives.ts.
const SECTION_PATTERNS: Array<{
  pattern: RegExp;
  key: Exclude<keyof SlackArtifactSections, "title" | "sourceUrl" | "tldr"> | "tldr";
  bulletize: boolean;
}> = [
  { pattern: /^(summary|tl\s*[;,:/]?\s*dr)$/i, key: "tldr", bulletize: false },
  { pattern: /^links?(\s*\/\s*(repos?|docs?))*$/i, key: "links", bulletize: true },
  { pattern: /^commands?(\s*\/\s*(code|apis?))*$/i, key: "commands", bulletize: true },
  { pattern: /^(action items?|next steps?|do next)$/i, key: "actionItems", bulletize: true },
  { pattern: /^decisions?$/i, key: "decisions", bulletize: true },
  { pattern: /^(risks?(\s*\/\s*blockers?)?|watchouts?)$/i, key: "risks", bulletize: true },
  { pattern: /^(follow[- ]?up questions?|questions?)$/i, key: "followUpQuestions", bulletize: true },
];

function stripLabel(line: string): string {
  // Remove leading "#", "##", "*", and bullet markers, plus any emoji prefix.
  return line
    .replace(/^[#*\s]+/, "")
    .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*/u, "")
    .replace(/^[✦↗⌘→◆△?]+\s*/u, "")
    .replace(/[*:]+\s*$/, "")
    .trim();
}

function isBulletLine(line: string): boolean {
  return /^\s*([-*•]|\d+[.)])\s+/.test(line);
}

function stripBullet(line: string): string {
  return line.replace(/^\s*([-*•]|\d+[.)])\s+/, "").trim();
}

function matchSectionLabel(
  line: string,
): { key: (typeof SECTION_PATTERNS)[number]["key"]; bulletize: boolean } | null {
  const label = stripLabel(line);
  if (!label) return null;
  for (const candidate of SECTION_PATTERNS) {
    if (candidate.pattern.test(label)) {
      return { key: candidate.key, bulletize: candidate.bulletize };
    }
  }
  return null;
}

/**
 * Parse a free-form LLM markdown response into the structured
 * SlackArtifactSections shape consumed by renderSlackArtifactMarkdown.
 *
 * The LLM is asked (via buildSlackPrimitivePrompt) to emit Slack-friendly
 * markdown with a known set of section headers. In practice the model
 * sometimes wraps the response in preamble ("Here is the summary:"),
 * uses `*Label*` vs `**Label**` vs `# Label`, or mixes bullet markers.
 * This parser is lenient: it splits on labelled section headers and
 * collects the trailing lines until the next labelled header.
 *
 * Returns sections plus the caller-supplied title/sourceUrl (so the
 * renderer can produce a consistent header line). Unknown sections in
 * the LLM output are dropped — that's the whole point of wiring the
 * formatter in, vs blindly forwarding `result.text`.
 */
export function parseSlackArtifactMarkdown(
  raw: string,
  meta: { title?: string | null; sourceUrl?: string | null } = {},
): SlackArtifactSections {
  const result: SlackArtifactSections = {
    title: meta.title ?? null,
    sourceUrl: meta.sourceUrl ?? null,
  };

  const lines = raw.split(/\r?\n/);
  let currentKey: (typeof SECTION_PATTERNS)[number]["key"] | null = null;
  let currentBulletize = false;
  let buffer: string[] = [];

  const flush = () => {
    if (!currentKey) return;
    const cleaned = buffer
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (cleaned.length === 0) {
      buffer = [];
      return;
    }

    if (currentBulletize) {
      const items = cleaned
        .map((line) => (isBulletLine(line) ? stripBullet(line) : line))
        .filter((line) => line.length > 0);
      (result[currentKey] as string[] | undefined) = items;
    } else {
      // TL;DR can span multiple lines — join them.
      (result[currentKey] as string | undefined) = cleaned.join(" ");
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
