export const DEFAULT_IPC_TIMEOUT_MS: number;
export const TUSK_SET_TIMEOUT_MS: number;

export function requestFromMain(
  type: string,
  payload?: unknown,
  timeoutMs?: number
): Promise<Record<string, string>>;

export function getSecretsFromMainOrEnv(): Promise<{
  llmProvider: string;
  llmApiKey: string;
  notionToken: string;
  notionDatabaseId: string;
}>;

export function secretsFromEnv(): {
  llmProvider: string;
  llmApiKey: string;
  notionToken: string;
  notionDatabaseId: string;
};
