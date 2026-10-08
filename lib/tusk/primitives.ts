export type SlackPrimitivePreset =
  | "general"
  | "engineering"
  | "sales"
  | "support"
  | "leadership"
  | "custom";

export interface SlackPrimitivePromptOptions {
  title: string;
  preset: SlackPrimitivePreset;
  customInstructions?: string | null;
}

const PRESET_INSTRUCTIONS: Record<Exclude<SlackPrimitivePreset, "custom">, string> = {
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

export function buildSlackPrimitivePrompt(
  options: SlackPrimitivePromptOptions,
): string {
  const presetInstructions =
    options.preset === "custom"
      ? options.customInstructions?.trim()
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
- Do not use markdown links like [label](url). Use plain URLs or Slack links like <url|label>.
- If a timestamp is useful, include it as [MM:SS].
- Do not include preamble, caveats, or a closing note.`;
}
