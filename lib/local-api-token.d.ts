export const TOKEN_FILE_NAME: string;
export const ENV_NAME: string;
export function cookieName(port?: number): string;
export function getStateDir(): string;
export function getLogDir(state?: string): string;
export function getLocalApiTokenPath(): string;
export function tokensEqual(a: string, b: string): boolean;
export function ensureLocalApiToken(opts?: { writeEnvToFile?: boolean }): string;
export function ensureInEnv(opts?: { writeEnvToFile?: boolean }): string;
export function getExpectedToken(): string | null;
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
  expected: string | null
): boolean;
export function unauthorizedJson(): { error: string };
export function generateToken(): string;
export function writeTokenFile(token: string): string;
