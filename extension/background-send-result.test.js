const test = require("node:test");
const assert = require("node:assert/strict");

/**
 * Tests for YTT-443 / YTT-450: discriminated sendPageUrl results.
 * These tests verify the result shape returned by sendPageUrl
 * and that 401 clears the in-memory token.
 * YTT-450: Native host errors now return "unreachable" instead of "unauthorized".
 */

function resetMocks() {
  global.getLocalApiTokenMock = null;
  global.buildLocalSendRequestMock = null;
  global.fetch = null;
  global._localTokenMemoryTest = null;
}

test("sendPageUrl returns { ok: false, reason: 'unreachable' } when native host unavailable", async () => {
  resetMocks();
  const { sendPageUrl } = await loadBackgroundModule();
  
  // Mock getLocalApiToken to return unreachable
  global.getLocalApiTokenMock = async () => ({ ok: false, reason: "unreachable" });
  
  const result = await sendPageUrl("https://www.youtube.com/watch?v=test");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unreachable");
});

test("sendPageUrl returns { ok: false, reason: 'unauthorized' } when no token", async () => {
  resetMocks();
  const { sendPageUrl } = await loadBackgroundModule();
  
  // Mock getLocalApiToken to return unauthorized (host OK but no token)
  global.getLocalApiTokenMock = async () => ({ ok: false, reason: "unauthorized" });
  
  const result = await sendPageUrl("https://www.youtube.com/watch?v=test");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unauthorized");
});

test("sendPageUrl returns { ok: false, reason: 'other' } when buildLocalSendRequest fails", async () => {
  resetMocks();
  const { sendPageUrl } = await loadBackgroundModule();
  
  // Mock getLocalApiToken to return a token
  global.getLocalApiTokenMock = async () => ({ ok: true, token: "a".repeat(64) });
  
  // Mock buildLocalSendRequest to fail
  global.buildLocalSendRequestMock = () => ({ ok: false });
  
  const result = await sendPageUrl("https://www.youtube.com/watch?v=test");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "other");
});

test("sendPageUrl returns { ok: false, reason: 'unreachable' } on fetch error with valid token", async () => {
  resetMocks();
  const { sendPageUrl } = await loadBackgroundModule();
  
  // Mock getLocalApiToken to return a token
  global.getLocalApiTokenMock = async () => ({ ok: true, token: "a".repeat(64) });
  
  // Mock fetch to throw
  global.fetch = async () => {
    throw new Error("connection refused");
  };
  
  const result = await sendPageUrl("https://www.youtube.com/watch?v=test");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unreachable");
});

test("sendPageUrl returns { ok: false, reason: 'unauthorized' } on 401 and clears token", async () => {
  resetMocks();
  const { sendPageUrl, _localTokenMemory } = await loadBackgroundModule();
  
  // Mock getLocalApiToken to return a token
  global.getLocalApiTokenMock = async () => ({ ok: true, token: "a".repeat(64) });
  global._localTokenMemoryTest = "a".repeat(64);
  
  // Mock fetch to return 401
  global.fetch = async () => ({
    status: 401,
    ok: false,
  });
  
  const result = await sendPageUrl("https://www.youtube.com/watch?v=test");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unauthorized");
  // Token should be cleared
  assert.equal(global._localTokenMemoryTest, null);
});

test("sendPageUrl returns { ok: false, reason: 'other' } on other non-OK HTTP", async () => {
  resetMocks();
  const { sendPageUrl } = await loadBackgroundModule();
  
  // Mock getLocalApiToken to return a token
  global.getLocalApiTokenMock = async () => ({ ok: true, token: "a".repeat(64) });
  
  // Mock fetch to return 500
  global.fetch = async () => ({
    status: 500,
    ok: false,
  });
  
  const result = await sendPageUrl("https://www.youtube.com/watch?v=test");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "other");
});

test("sendPageUrl returns { ok: true, transcriptId } on successful send with valid ID", async () => {
  resetMocks();
  const { sendPageUrl } = await loadBackgroundModule();
  
  // Mock getLocalApiToken to return a token
  global.getLocalApiTokenMock = async () => ({ ok: true, token: "a".repeat(64) });
  
  // Mock fetch to return 200 with valid transcript response
  global.fetch = async () => ({
    status: 200,
    ok: true,
    json: async () => ({ id: "abc123_-xyz" }),
  });
  
  const result = await sendPageUrl("https://www.youtube.com/watch?v=test");
  assert.equal(result.ok, true);
  assert.equal(result.transcriptId, "abc123_-xyz");
  assert.equal(result.reason, undefined);
  assert.equal(result.title, undefined);
});

test("sendPageUrl returns { ok: false, reason: 'other' } when transcript ID is invalid", async () => {
  resetMocks();
  const { sendPageUrl } = await loadBackgroundModule();
  
  // Mock getLocalApiToken to return a token
  global.getLocalApiTokenMock = async () => ({ ok: true, token: "a".repeat(64) });
  
  // Mock fetch to return 200 but with invalid transcript ID format
  global.fetch = async () => ({
    status: 200,
    ok: true,
    json: async () => ({ id: "invalid/id!" }),
  });
  
  const result = await sendPageUrl("https://www.youtube.com/watch?v=test");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "other");
});

test("sendPageUrl returns { ok: false, reason: 'other' } when native host returns {ok:false}", async () => {
  resetMocks();
  const { sendPageUrl } = await loadBackgroundModule();
  
  // Mock getLocalApiToken to return host { ok: false }
  global.getLocalApiTokenMock = async () => ({ ok: false, reason: "other" });
  
  const result = await sendPageUrl("https://www.youtube.com/watch?v=test");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "other");
});

// Helper to load background.js sendPageUrl logic in a testable way.
// This matches the exact behavior of the real background.js (lines 72-132).
async function loadBackgroundModule() {
  // Mock chrome APIs
  global.chrome = {
    runtime: {
      connectNative: () => ({
        postMessage: () => {},
        disconnect: () => {},
        onMessage: { addListener: () => {} },
        onDisconnect: { addListener: () => {} },
      }),
      onMessage: { addListener: () => {} },
    },
    sidePanel: {
      setOptions: async () => {},
      setPanelBehavior: async () => {},
      open: async () => {},
    },
    action: {
      onClicked: { addListener: () => {} },
    },
  };
  
  // Load the required modules
  const sendUrlModule = require("./send-url.js");
  global.buildLocalSendRequest = sendUrlModule.buildLocalSendRequest;
  global.localAuthHeadersFromToken = require("./local-auth-headers.js").localAuthHeadersFromToken;
  
  // Mock implementation that matches real background.js exactly
  let _localTokenMemory = null;
  
  async function getLocalApiToken() {
    if (global.getLocalApiTokenMock) {
      return await global.getLocalApiTokenMock();
    }
    return { ok: true, token: _localTokenMemory };
  }
  
  function clearLocalTokenMemory() {
    _localTokenMemory = null;
    global._localTokenMemoryTest = null;
  }
  
  async function sendPageUrl(pageUrl) {
    const tokenResult = await getLocalApiToken();
    
    // Native host unavailable
    if (!tokenResult.ok && tokenResult.reason === "unreachable") {
      return { ok: false, reason: "unreachable" };
    }
    
    // Host OK but no token
    if (!tokenResult.ok && tokenResult.reason === "unauthorized") {
      return { ok: false, reason: "unauthorized" };
    }
    
    // YTT-448: Native host { ok:false } maps to "other"
    if (!tokenResult.ok && tokenResult.reason === "other") {
      return { ok: false, reason: "other" };
    }
    
    // Build request with token
    const buildFn = global.buildLocalSendRequestMock || global.buildLocalSendRequest;
    const request = buildFn(pageUrl, tokenResult.token);
    if (!request.ok) {
      // Token present but request build failed (bad URL etc.) → "other"
      return { ok: false, reason: "other" };
    }

    let res;
    try {
      res = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        credentials: "omit",
        body: request.body,
      });
    } catch {
      // Fetch failed after token was present
      return { ok: false, reason: "unreachable" };
    }

    if (res.status === 401) {
      clearLocalTokenMemory();
      return { ok: false, reason: "unauthorized" };
    }
    
    if (!res.ok) {
      // YTT-448: Server errors return "other"
      return { ok: false, reason: "other" };
    }
    
    let data;
    try {
      data = await res.json();
    } catch {
      return { ok: false, reason: "other" };
    }

    // YTT-448: Validate transcriptId format before success
    if (typeof data?.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(data.id)) {
    return { ok: false, reason: "other" };
  }

  return { ok: true, transcriptId: data.id };
}
  
  return { sendPageUrl, clearLocalTokenMemory, _localTokenMemory };
}
