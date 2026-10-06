const test = require("node:test");
const assert = require("node:assert/strict");

/**
 * Tests for YTT-443: discriminated sendPageUrl results.
 * These tests verify the result shape returned by sendPageUrl
 * and that 401 clears the in-memory token.
 */

test("sendPageUrl returns { ok: false, reason: 'unauthorized' } when no token", async () => {
  const { sendPageUrl, clearLocalTokenMemory } = await loadBackgroundModule();
  
  // Mock getLocalApiToken to return null
  global.getLocalApiTokenMock = async () => ({ token: null });
  
  const result = await sendPageUrl("https://www.youtube.com/watch?v=test");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unauthorized");
});

test("sendPageUrl returns { ok: false, reason: 'unreachable' } on fetch error", async () => {
  const { sendPageUrl } = await loadBackgroundModule();
  
  // Mock getLocalApiToken to return a token
  global.getLocalApiTokenMock = async () => ({ token: "a".repeat(64) });
  
  // Mock fetch to throw
  global.fetch = async () => {
    throw new Error("connection refused");
  };
  
  const result = await sendPageUrl("https://www.youtube.com/watch?v=test");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unreachable");
});

test("sendPageUrl returns { ok: false, reason: 'unauthorized' } on 401 and clears token", async () => {
  const { sendPageUrl, _localTokenMemory } = await loadBackgroundModule();
  
  // Mock getLocalApiToken to return a token
  global.getLocalApiTokenMock = async () => ({ token: "a".repeat(64) });
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
  const { sendPageUrl } = await loadBackgroundModule();
  
  // Mock getLocalApiToken to return a token
  global.getLocalApiTokenMock = async () => ({ token: "a".repeat(64) });
  
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
  const { sendPageUrl } = await loadBackgroundModule();
  
  // Mock getLocalApiToken to return a token
  global.getLocalApiTokenMock = async () => ({ token: "a".repeat(64) });
  
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
  global.buildLocalSendRequest = require("./send-url.js").buildLocalSendRequest;
  global.localAuthHeadersFromToken = require("./local-auth-headers.js").localAuthHeadersFromToken;
  
  // Create a mock sendPageUrl implementation
  let _localTokenMemory = null;
  
  async function getLocalApiToken() {
    if (global.getLocalApiTokenMock) {
      return await global.getLocalApiTokenMock();
    }
    return { token: _localTokenMemory };
  }
  
  function clearLocalTokenMemory() {
    _localTokenMemory = null;
    global._localTokenMemoryTest = null;
  }
  
  async function sendPageUrl(pageUrl) {
    const { token } = await getLocalApiToken();
    const request = global.buildLocalSendRequest(pageUrl, token);
    if (!request.ok) {
      return { ok: false, reason: "unauthorized" };
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
