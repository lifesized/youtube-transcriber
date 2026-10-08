export const ENV_NAME: string;
export const DEFAULT_PORT: number;
export function configuredPort(): number;
export function cookieName(port?: number): string;
export function allowedLoopbackHosts(port?: number): string[];
export function isAllowedLoopbackHost(
  hostHeader: string | null | undefined,
  port?: number
): boolean;
export function shouldMintTokenCookie(fetchMetadata?: {
  site?: string | null;
  mode?: string | null;
  dest?: string | null;
}): boolean;
export function allowsCookieAuth(secFetchSite: string | null | undefined): boolean;
export function tokensEqual(a: string, b: string): boolean;
export function tokensEqualNode(a: string, b: string): boolean;
export function parseBearerToken(authorizationHeader: string | null | undefined): string | null;
export function parseCookieToken(
  cookieHeader: string | null | undefined,
  name?: string
): string | null;
export function isAuthorizedRequest(
  headers: {
    authorization?: string | null;
    cookie?: string | null;
    secFetchSite?: string | null;
  },
  expected: string | null,
  equalFn?: (a: string, b: string) => boolean,
  port?: number
): boolean;
export function isSettingsPageWrite(
  headers: {
    authorization?: string | null;
    cookie?: string | null;
    secFetchSite?: string | null;
  },
  expected: string | null,
  equalFn?: (a: string, b: string) => boolean,
  port?: number
): boolean;
export function unauthorizedJson(): { error: string };
