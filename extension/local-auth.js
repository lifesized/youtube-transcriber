/**
 * Builds the local API Authorization header.
 * The token must stay in memory. Never write it to chrome.storage or a URL.
 */
function localAuthorizationHeader(token) {
  if (typeof token !== "string" || token.length === 0 || /\s/.test(token)) {
    throw new Error("local_token_unavailable");
  }
  return { Authorization: "Bearer " + token };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { localAuthorizationHeader };
}
