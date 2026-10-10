export const FILE_NAME: string;
export function tokensPath(dir?: string | null): string;
export function loadStore(dir?: string | null): {
  version: number;
  helpers: Record<string, { token?: string; revoked?: boolean; enabled?: boolean }>;
};
export function issueToken(id: string, dir?: string | null): string;
export function revokeToken(id: string, dir?: string | null): void;
export function setEnabled(id: string, enabled: boolean, dir?: string | null): boolean;
export function isEnabled(id: string, dir?: string | null): boolean;
export function listActiveRecords(dir?: string | null): Array<{
  id: string;
  token: string;
  enabled: boolean;
}>;
export function authorizeHelperFromStore(
  headers: { authorization?: string | null },
  options?: {
    method?: string;
    pathname?: string;
    stateDir?: string | null;
    equalFn?: (a: string, b: string) => boolean;
  }
): { ok: boolean; reason?: string; id?: string };
