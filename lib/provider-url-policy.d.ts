export const KNOWN_PROVIDER_HOSTS: ReadonlySet<string>;
export const BLOCKED_MESSAGE: string;

export function isKnownProviderHost(hostname: string): boolean;

export function providerFetchRedirect(hostname: string): "follow" | "manual";

export function isBlockedIpAddress(ip: string): boolean;

export function assertSafeProviderUrl(urlString: string): string | null;

export function assertSafeProviderUrlResolved(
  urlString: string,
  options?: { lookup?: (hostname: string) => Promise<string[]> }
): Promise<string | null>;
