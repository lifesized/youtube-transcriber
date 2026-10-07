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

  return { ok: true, transcriptId: data.id };
}

// ---------------------------------------------------------------------------
// Persistent state — survives popup close and service worker restart
// ---------------------------------------------------------------------------

async function getState() {
  const { _txState } = await chrome.storage.session.get("_txState");
  return _txState || null;
}

async function setState(state) {
  await chrome.storage.session.set({ _txState: state });
}

async function clearState() {
  await chrome.storage.session.remove("_txState");
}

async function getQueue() {
  const { _txQueue } = await chrome.storage.session.get("_txQueue");
  return _txQueue || [];
}

async function setQueue(queue) {
  await chrome.storage.session.set({ _txQueue: queue });
}

// ---------------------------------------------------------------------------
// Badge — visual indicator on extension icon
// ---------------------------------------------------------------------------

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

// ---------------------------------------------------------------------------
// API helpers for LOCAL mode
// ---------------------------------------------------------------------------

const API_BASE = "http://127.0.0.1:19720";

async function checkService() {
  try {
    const res = await fetch(`${API_BASE}/api/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.projectPath) {
        chrome.storage.local.set({ projectPath: data.projectPath });
      }
    }
    return { online: res.ok || res.status === 503 };
  } catch {
    return { online: false };
  }
}

async function getRecent() {
  const res = await fetch(`${API_BASE}/api/transcripts`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const all = await res.json();
  return all.slice(0, 5);
}

async function checkExisting(videoId) {
  const res = await fetch(`${API_BASE}/api/transcripts`);
  if (!res.ok) return null;
  const all = await res.json();
  return all.find((t) => t.videoId === videoId) || null;
}

// ---------------------------------------------------------------------------
// Core transcribe via hardened send-url path
// ---------------------------------------------------------------------------

async function doTranscribe(url, title) {
  const state = {
    url,
    title: title || "",
    status: "transcribing",
    result: null,
    error: null,
    startedAt: Date.now(),
  };
  await setState(state);
  setBadge("...", "#a58959");

  const result = await sendPageUrl(url);
  
  if (result.ok) {
    state.status = "done";
    state.result = { id: result.transcriptId, title: result.title || title };
    await setState(state);
    setBadge("✓", "#22c55e");
    setTimeout(() => {
      getState().then((s) => {
        if (s?.status === "done" || !s) setBadge("");
      });
    }, 5000);
    await processNextInQueue();
    return state.result;
  } else {
    state.status = "error";
    state.error = result.error || "Transcription failed";
    await setState(state);
    setBadge("!", "#ef4444");
    throw new Error(state.error);
  }
}

// ---------------------------------------------------------------------------
// Queue processing
// ---------------------------------------------------------------------------

async function processNextInQueue() {
  const queue = await getQueue();
  const current = await getState();

  if (!queue.length || current?.status === "transcribing") {
    return { processing: false };
  }

  const next = queue.shift();
  await setQueue(queue);

  doTranscribe(next.url, next.title).catch(() => {});

  return { processing: true, title: next.title, url: next.url };
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender?.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: "Invalid sender" });
    return;
  }

  const handle = async () => {
    switch (message.type) {
      case "SEND_PAGE_URL":
        return await sendPageUrl(message.url);

      case "CHECK_SERVICE":
        return await checkService();

      case "TRANSCRIBE":
        return await doTranscribe(message.url, message.title);

      case "GET_TRANSCRIPTION_STATUS":
        return await getState();

      case "CLEAR_TRANSCRIPTION":
        await clearState();
        setBadge("");
        return { ok: true };

      case "GET_RECENT":
        return await getRecent();

      case "CHECK_EXISTING":
        return await checkExisting(message.videoId);

      case "QUEUE_ADD": {
        const queue = await getQueue();
        const already = queue.some((q) => q.url === message.url);
        if (!already) {
          queue.push({ url: message.url, title: message.title || "" });
          await setQueue(queue);
        }
        return { ok: true, queue };
      }

      case "GET_QUEUE":
        return await getQueue();

      case "CLEAR_QUEUE":
        await setQueue([]);
        return { ok: true };

      case "PROCESS_QUEUE":
        return await processNextInQueue();

      case "OPEN_TRANSCRIPT": {
        const transcriptId = message.id;
        if (typeof transcriptId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(transcriptId)) {
          throw new Error("Invalid transcript id");
        }
        const fullUrl = `${API_BASE}/?layout=list&id=${encodeURIComponent(transcriptId)}&t=${Date.now()}`;
        const allTabs = await chrome.tabs.query({});
        const appTab = allTabs.find((t) => {
          try {
            const url = new URL(t.url || "");
            return url.hostname === "127.0.0.1" && url.port === "19720";
          } catch {
            return false;
          }
        });

        if (appTab) {
          await chrome.tabs.update(appTab.id, { url: fullUrl, active: true });
          await chrome.windows.update(appTab.windowId, { focused: true });
        } else {
          await chrome.tabs.create({ url: fullUrl, active: true });
        }
        return { ok: true };
      }

      case "SAVE_SETTINGS": {
        if (message.mode) {
          await chrome.storage.sync.set({ mode: message.mode });
        }
        return { ok: true };
      }

      case "GET_TRANSCRIPT": {
        const transcriptId = message.id;
        const res = await fetch(`${API_BASE}/api/transcripts/${transcriptId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return { transcript: data.transcript, title: data.title };
      }

      case "CALL_NATIVE_HOST": {
        try {
          const result = await callNativeHostCmd(message.cmd, message.payload, message.timeoutMs || 5000);
          return { ok: true, result };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }

      default:
        return { error: "Unknown message type" };
    }
  };

  handle()
    .then((result) => {
      if (result?.ok !== undefined || result?.online !== undefined || result?.error) {
        sendResponse({ success: true, data: result });
      } else {
        sendResponse({ success: true, data: result });
      }
    })
    .catch((err) => sendResponse({ success: false, error: err.message }));

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
