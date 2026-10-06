"use strict";

/**
 * Build local API Authorization headers from a Bearer token (YTT-435).
 * Token must come from native host / memory — never chrome.storage or URL query.
 */
function localAuthHeadersFromToken(token) {
  if (!token || typeof token !== "string") return {};
  return { Authorization: `Bearer ${token}` };
}

module.exports = { localAuthHeadersFromToken };
