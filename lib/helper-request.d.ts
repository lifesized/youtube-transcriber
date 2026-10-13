export function requestAuthHeaders(request: {
  headers: { get(name: string): string | null };
}): {
  authorization: string | null;
  cookie: string | null;
  secFetchSite: string | null;
};
export function authorizeLocalOrHelper(
  request: { headers: { get(name: string): string | null }; method?: string; url?: string },
  options?: { method?: string; pathname?: string; stateDir?: string | null }
): { ok: boolean; kind?: "local" | "helper"; id?: string; reason?: string };
