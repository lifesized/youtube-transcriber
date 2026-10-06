/**
 * Decides whether a browser fetch should receive the local API bearer token.
 * Never attach the token to another origin.
 */

function isSameOriginApiUrl(input, pageOrigin) {
  if (typeof input !== "string" || typeof pageOrigin !== "string" || !pageOrigin) {
    return false;
  }
  if (input.startsWith("/api/") || input === "/api") return true;
  let url;
  try {
    url = new URL(input, pageOrigin);
  } catch {
    return false;
  }
  let page;
  try {
    page = new URL(pageOrigin);
  } catch {
    return false;
  }
  return url.origin === page.origin && (url.pathname === "/api" || url.pathname.startsWith("/api/"));
}

module.exports = { isSameOriginApiUrl };
