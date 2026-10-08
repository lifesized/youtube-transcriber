export type SlackArtifactMode = "summary" | "transcript";

export function isMentionTriggered(text: string, botUserId: string | null | undefined): boolean {
  return Boolean(botUserId && text.includes(`<@${botUserId}>`));
}

export function stripMention(text: string, botUserId: string | null | undefined): string {
  let out = String(text || "");
  if (botUserId) out = out.replaceAll(`<@${botUserId}>`, "");
  return out.replace(/\s+/g, " ").trim();
}

export function resolveArtifactMode(text: string): SlackArtifactMode {
  if (/(?:^|\s)(?:summarize|summary|s)(?:\s|$)/i.test(text)) return "summary";
  return /(?:^|\s)(?:transcript|transcribe|t)(?:\s|$)/i.test(text) ? "transcript" : "summary";
}
