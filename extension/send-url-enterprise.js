"use strict";

/**
 * ENTERPRISE one-tap send (YTT-447).
 * The extension posts the current page URL to the org-hosted Transcriber instance.
 * Auth is handled via org SSO/cookies (placeholder for full implementation).
 */

const ENTERPRISE_SEND_ENDPOINT = "{{ENTERPRISE_BASE_URL}}/api/transcripts";

function isSecretQueryKey(key) {
  const str = String(key || "");
  const normalized = str.toLowerCase().replace(/[-_]/g, "");
  
  const secretBases = [
    "token",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "apikey",
    "privatetoken",
    "password",
    "auth",
    "authorization",
    "secret",
    "clientsecret",
    "jwt",
    "code",
    "yttx",
  ];
  
  if (secretBases.includes(normalized)) {
    return true;
  }
  
  if (normalized.startsWith("xapi") ||
      normalized.startsWith("xamz") ||
      normalized.startsWith("xgoog")) {
    return true;
  }
  
  return false;
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
 * Build enterprise send request (no native messaging auth).
 * Auth via org SSO/cookies is handled by the org's infrastructure.
 * @param {string} pageUrl
 * @returns {{ ok: true, url: string, headers: Record<string, string>, body: string } | { ok: false }}
 */
function buildEnterpriseSendRequest(pageUrl) {
  const url = normalizePageUrl(pageUrl);
  if (!url) return { ok: false };

  const endpoint = new URL(ENTERPRISE_SEND_ENDPOINT);
  if (endpoint.search || endpoint.username || endpoint.password || endpoint.hash) {
    return { ok: false };
  }
  if (!endpoint.origin.startsWith("https://")) return { ok: false };
  if (endpoint.pathname !== "/api/transcripts") return { ok: false };

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const body = JSON.stringify({ url });
  const parsedBody = JSON.parse(body);
  if (Object.keys(parsedBody).length !== 1 || parsedBody.url !== url) {
    return { ok: false };
  }

  return {
    ok: true,
    url: endpoint.href,
    headers,
    body,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ENTERPRISE_SEND_ENDPOINT,
    isSecretQueryKey,
    normalizePageUrl,
    buildEnterpriseSendRequest,
  };
}
