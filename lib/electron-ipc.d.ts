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
