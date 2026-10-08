export type SlackArtifactMode = "summary" | "transcript";

export function isMentionTriggered(text: string, botUserId: string | null | undefined): boolean {
  return Boolean(botUserId && text.includes(`<@${botUserId}>`));
}

export function resolveArtifactMode(text: string): SlackArtifactMode {
  if (/(?:^|\s)(?:summarize|summary|s)(?:\s|$)/i.test(text)) return "summary";
  return /(?:^|\s)(?:transcript|transcribe|t)(?:\s|$)/i.test(text) ? "transcript" : "summary";
}
