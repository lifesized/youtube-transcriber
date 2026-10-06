export function ensureLocalApiToken(): string;
export function localApiAuthDecision(
  authorization: string | null
): { ok: boolean; status: number };
export function stateDir(): string;
export function tokenFilePath(): string;
