export const HELPER_ALLOWED_ROUTES: Array<{ method: string; pathname: string }>;
export const SETTINGS_SECRET_KEYS: string[];
export function normalizePathname(pathname: string | null | undefined): string;
export function isHelperAllowedRoute(
  method: string | null | undefined,
  pathname: string | null | undefined
): boolean;
export function looksLikeHelperToken(authorizationHeader: string | null | undefined): boolean;
export function helperShapeAllowed(
  headers: { authorization?: string | null },
  method: string | null | undefined,
  pathname: string | null | undefined
): boolean;
export function matchHelperToken(
  bearer: string | null | undefined,
  records: Array<{ id?: string; token?: string }> | null | undefined,
  equalFn?: (a: string, b: string) => boolean
): { id?: string; token?: string } | null;
export function authorizeHelperBearer(
  headers: { authorization?: string | null },
  options?: {
    method?: string;
    pathname?: string;
    records?: Array<{ id: string; token: string }>;
    equalFn?: (a: string, b: string) => boolean;
  }
): { ok: boolean; reason?: string; id?: string };
export function stripSecretSettings(payload: Record<string, unknown> | null | undefined): Record<string, unknown>;
