"use client";

import { isSameOriginApiUrl } from "@/lib/local-api-url.js";

let installed = false;
let currentToken = "";

function requestUrl(input: RequestInfo | URL): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return null;
}

/**
 * Install the bearer header before sibling client effects run.
 * The token is held in memory for same-origin /api requests only.
 */
function installLocalApiAuth(token: string) {
  currentToken = token;
  if (installed || typeof window === "undefined") return;
  installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = requestUrl(input);
    if (!raw || !currentToken || !isSameOriginApiUrl(raw, window.location.origin)) {
      return orig(input, init);
    }
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${currentToken}`);
    }
    if (input instanceof Request) {
      return orig(new Request(input, { ...init, headers }));
    }
    return orig(input, { ...init, headers });
  };
}

export function LocalApiAuth({ token }: { token: string }) {
  installLocalApiAuth(token);
  return null;
}
