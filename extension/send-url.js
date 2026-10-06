"use strict";

/**
 * LOCAL one-tap send (YTT-442).
 * The extension posts the current page URL to loopback. The Bearer token
 * stays in the Authorization header only — never in the URL, body, or storage.
 */

const LOCAL_SEND_ENDPOINT = "http://127.0.0.1:19720/api/transcripts";

function isSecretQueryKey(key) {
  return /^(token|access_token|refresh_token|id_token|api_key|apikey|yttx|password)$/i.test(
    String(key || "")
  );
}

function authHeaders(token) {
  if (typeof localAuthHeadersFromToken === "function") {
    return localAuthHeadersFromToken(token);
  }
  return require("./local-auth-headers.js").localAuthHeadersFromToken(token);
}

function stripSecretParams(params, token) {
  for (const key of [...params.keys()]) {
    const value = params.get(key) || "";
    if (isSecretQueryKey(key) || (token && value.includes(token))) {
      params.delete(key);
    }
  }
}

/**
 * http(s) page URL safe to display and POST.
 * Drops userinfo and known secret query/hash params. Returns null otherwise.
 * @param {string} pageUrl
 * @param {string} [token]
 * @returns {string | null}
 */
function normalizePageUrl(pageUrl, token) {
  if (typeof pageUrl !== "string") return null;
  const raw = pageUrl.trim();
  if (!raw || raw.length > 4096) return null;
  if (token && raw.includes(token) && !raw.includes("?") && !raw.includes("#")) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  parsed.username = "";
  parsed.password = "";
  stripSecretParams(parsed.searchParams, token);

  if (parsed.hash) {
    const hashBody = parsed.hash.slice(1);
    const hashParams = new URLSearchParams(hashBody);
    const hadPairs = hashBody.includes("=");
    if (hadPairs) {
      stripSecretParams(hashParams, token);
      const next = hashParams.toString();
      parsed.hash = next ? `#${next}` : "";
    } else if (token && parsed.hash.includes(token)) {
      parsed.hash = "";
    }
  }

  const href = parsed.href;
  if (token && href.includes(token)) return null;
  return href;
}

/**
 * @param {string} pageUrl
 * @param {string} token
 * @returns {{ ok: true, url: string, headers: Record<string, string>, body: string } | { ok: false }}
 */
function buildLocalSendRequest(pageUrl, token) {
  if (!token || typeof token !== "string") return { ok: false };
  const url = normalizePageUrl(pageUrl, token);
  if (!url) return { ok: false };

  const endpoint = new URL(LOCAL_SEND_ENDPOINT);
  if (endpoint.search || endpoint.username || endpoint.password || endpoint.hash) {
    return { ok: false };
  }
  if (endpoint.origin !== "http://127.0.0.1:19720") return { ok: false };
  if (endpoint.pathname !== "/api/transcripts") return { ok: false };

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...authHeaders(token),
  };
  const authorization = headers.Authorization;
  if (
    typeof authorization !== "string" ||
    !authorization.startsWith("Bearer ") ||
    authorization.includes(url) ||
    /[\r\n]/.test(authorization)
  ) {
    return { ok: false };
  }

  const body = JSON.stringify({ url });
  const parsedBody = JSON.parse(body);
  if (Object.keys(parsedBody).length !== 1 || parsedBody.url !== url) {
    return { ok: false };
  }
  if (body.includes(token) || endpoint.href.includes(token)) return { ok: false };

  return {
    ok: true,
    url: endpoint.href,
    headers,
    body,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    LOCAL_SEND_ENDPOINT,
    isSecretQueryKey,
    normalizePageUrl,
    buildLocalSendRequest,
  };
}
