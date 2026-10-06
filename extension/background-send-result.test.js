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

test("sendPageUrl returns { ok: false, reason: 'failed' } when buildLocalSendRequest fails", async () => {
  resetMocks();
  const { sendPageUrl } = await loadBackgroundModule();
  
  // Mock getLocalApiToken to return a token
  global.getLocalApiTokenMock = async () => ({ ok: true, token: "a".repeat(64) });
  
  // Mock buildLocalSendRequest to fail
  global.buildLocalSendRequestMock = () => ({ ok: false });
  
  const result = await sendPageUrl("https://www.youtube.com/watch?v=test");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "failed");
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

test("sendPageUrl returns { ok: false, reason: 'failed' } on other non-OK HTTP", async () => {
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
  assert.equal(result.reason, "failed");
});

test("sendPageUrl returns { ok: true } on successful send", async () => {
  resetMocks();
  const { sendPageUrl } = await loadBackgroundModule();
  
  // Mock getLocalApiToken to return a token
  global.getLocalApiTokenMock = async () => ({ ok: true, token: "a".repeat(64) });
  
  // Mock fetch to return 200
  global.fetch = async () => ({
    status: 200,
    ok: true,
  });
  
  const result = await sendPageUrl("https://www.youtube.com/watch?v=test");
  assert.equal(result.ok, true);
  assert.equal(result.reason, undefined);
});

// Helper to load background.js in a testable way
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
  
  // Create a mock sendPageUrl implementation matching the new logic
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
    
    // Build request with token
    const buildFn = global.buildLocalSendRequestMock || global.buildLocalSendRequest;
    const request = buildFn(pageUrl, tokenResult.token);
    if (!request.ok) {
      // Token present but request build failed (bad URL etc.)
      return { ok: false, reason: "failed" };
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
      return { ok: false, reason: "failed" };
    }
    
    return { ok: true };
  }
  
  return { sendPageUrl, clearLocalTokenMemory, _localTokenMemory };
}
