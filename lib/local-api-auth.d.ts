export const COOKIE_NAME: string;
export const ENV_NAME: string;
export function tokensEqual(a: string, b: string): boolean;
export function tokensEqualNode(a: string, b: string): boolean;
export function parseBearerToken(authorizationHeader: string | null | undefined): string | null;
export function parseCookieToken(cookieHeader: string | null | undefined): string | null;
export function isAuthorizedRequest(
  headers: { authorization?: string | null; cookie?: string | null },
  expected: string | null,
  equalFn?: (a: string, b: string) => boolean
): boolean;
export function unauthorizedJson(): { error: string };
