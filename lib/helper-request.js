"use strict";

const { isAuthorizedRequest } = require("./local-api-auth.js");
const { getExpectedToken } = require("./local-api-token.js");
const { looksLikeHelperToken } = require("./helper-scope.js");
const { authorizeHelperFromStore } = require("./helper-tokens.js");

function requestAuthHeaders(request) {
  return {
    authorization: request.headers.get("authorization"),
    cookie: request.headers.get("cookie"),
    secFetchSite: request.headers.get("sec-fetch-site"),
  };
}

function requestPathname(request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "";
  }
}

function authorizeLocalOrHelper(request, options = {}) {
  const headers = requestAuthHeaders(request);
  const expected = getExpectedToken();
  if (isAuthorizedRequest(headers, expected)) return { ok: true, kind: "local" };
  if (!looksLikeHelperToken(headers.authorization)) {
    return { ok: true, kind: "local" };
  }
  const helper = authorizeHelperFromStore(headers, {
    method: options.method || request.method,
    pathname: options.pathname || requestPathname(request),
    stateDir: options.stateDir,
  });
  if (helper.ok) return { ok: true, kind: "helper", id: helper.id };
  return { ok: false, reason: helper.reason || "unauthorized" };
}

module.exports = {
  requestAuthHeaders,
  authorizeLocalOrHelper,
};
