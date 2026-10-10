export const FILE_NAME: string;
export const ENV_NAME: string;
export function tokensPath(dir?: string | null): string;
export function loadStore(dir?: string | null): {
  version: number;
  helpers: Record<string, { token?: string; revoked?: boolean }>;
};
export function issueToken(id: string, dir?: string | null): string;
export function revokeToken(id: string, dir?: string | null): void;
export function listActiveRecords(dir?: string | null): Array<{ id: string; token: string }>;
export function loadHelperRecords(
  dir?: string | null,
  env?: NodeJS.ProcessEnv
): Array<{ id: string; token: string }>;
export function serializeHelperTokensEnv(
  records: Array<{ id: string; token: string }>
): string;
export function recordsFromEnv(env?: NodeJS.ProcessEnv): Array<{ id: string; token: string }>;
