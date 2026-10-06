importScripts("local-auth-headers.js", "send-url.js");

// In-memory only — never persist the loopback token (YTT-435 / YTT-442).
let _localTokenMemory = null;
const NATIVE_HOST_NAME = "com.transcribed.host";

function callNativeHostCmd(cmd, payload = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    } catch {
      reject(new Error("native_host_unavailable"));
      return;
    }
    const timer = setTimeout(() => {
      try {
        port.disconnect();
      } catch {
        /* ignore */
      }
      reject(new Error("native_host_timeout"));
    }, timeoutMs);
    port.onMessage.addListener((msg) => {
      clearTimeout(timer);
      try {
        port.disconnect();
      } catch {
        /* ignore */
      }
      resolve(msg);
    });
    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      const err = chrome.runtime.lastError?.message || "disconnected";
      reject(new Error(err));
    });
    const id = Math.random().toString(36).slice(2);
    port.postMessage({ id, cmd, ...payload });
  });
}

async function getLocalApiToken() {
  if (_localTokenMemory) return { ok: true, token: _localTokenMemory };
  
  let res;
  try {
    res = await callNativeHostCmd("getLocalToken", {}, 5000);
  } catch (err) {
    // Native host unavailable, timeout, or disconnect
    return { ok: false, reason: "unreachable" };
  }
  
  if (res?.ok && typeof res.token === "string" && res.token.length > 0) {
    _localTokenMemory = res.token;
    return { ok: true, token: _localTokenMemory };
  }
  
  // YTT-448: Native host { ok:false } maps to reason "other" (not unauthorized)
  if (res?.ok === false) {
    return { ok: false, reason: "other" };
  }
  
  // Host OK but token missing/empty
  return { ok: false, reason: "unauthorized" };
}

function clearLocalTokenMemory() {
  _localTokenMemory = null;
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
  
  // YTT-448: Native host { ok:false } maps to other
  if (!tokenResult.ok && tokenResult.reason === "other") {
    return { ok: false, reason: "other" };
  }
  
  // Build request with token
  const request = buildLocalSendRequest(pageUrl, tokenResult.token);
  if (!request.ok) {
    // Token present but request build failed (bad URL etc.)
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
    // YTT-448: Never return server error text
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

  return { ok: true, transcriptId: data.id, title: data.title };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "SEND_PAGE_URL") return;
  if (sender?.id !== chrome.runtime.id) {
    sendResponse({ ok: false });
    return;
  }
  sendPageUrl(message.url)
    .then((result) => sendResponse(result))
    .catch(() => sendResponse({ ok: false }));
  return true;
});

chrome.sidePanel.setOptions({ path: "popup.html", enabled: true }).catch(() => {});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch(() => {});

chrome.action.onClicked.addListener((tab) => {
  if (!Number.isInteger(tab.windowId)) return;
  chrome.sidePanel.open({ windowId: tab.windowId });
});
