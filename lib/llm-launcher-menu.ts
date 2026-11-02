/**
 * Remaining web Summarize-menu options after YTT-459.
 * Clipboard handoff only (ChatGPT / Claude). No built-in server-key entry.
 * Keep at least one entry so the menu cannot render empty.
 */
export const LLM_LAUNCHER_MENU_PROVIDERS = [
  { id: "chatgpt", name: "ChatGPT" },
  { id: "claude", name: "Claude" },
] as const;

export type LlmLauncherMenuProviderId =
  (typeof LLM_LAUNCHER_MENU_PROVIDERS)[number]["id"];

export function resolveLlmLauncherLastProvider(
  stored: string | null | undefined
): LlmLauncherMenuProviderId | null {
  if (typeof stored !== "string" || stored.length === 0) return null;
  const match = LLM_LAUNCHER_MENU_PROVIDERS.find((p) => p.id === stored);
  return match ? match.id : null;
}

export function migrateLlmLauncherLastProvider(
  stored: string | null | undefined
): { value: LlmLauncherMenuProviderId | null; didMigrate: boolean } {
  const value = resolveLlmLauncherLastProvider(stored);
  const didMigrate =
    typeof stored === "string" && stored.length > 0 && value === null;
  return { value, didMigrate };
}

export function sortLlmLauncherMenuProviders(
  lastProvider: string | null | undefined
): { id: LlmLauncherMenuProviderId; name: string }[] {
  const providers = LLM_LAUNCHER_MENU_PROVIDERS;
  if (!providers.length) return [];
  const resolved = resolveLlmLauncherLastProvider(lastProvider);
  if (!resolved) return providers.slice();
  return [
    ...providers.filter((p) => p.id === resolved),
    ...providers.filter((p) => p.id !== resolved),
  ];
}
