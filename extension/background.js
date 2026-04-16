// ---------------------------------------------------------------------------
// API Configuration — runtime mode switching (local / cloud)
// ---------------------------------------------------------------------------

const LOCAL_BASE = "http://localhost:19720";
const CLOUD_BASE = "https://www.transcribed.dev";

let _apiConfigCache = null;

async function getApiConfig() {
  if (_apiConfigCache) return _apiConfigCache;
  const { mode, apiKey } = await chrome.storage.sync.get(["mode", "apiKey"]);
  _apiConfigCache = buildConfig(mode || "cloud", apiKey || "");
  return _apiConfigCache;
}

function buildConfig(mode, apiKey) {
  if (mode === "cloud") {
    return {
      mode: "cloud",
      baseUrl: CLOUD_BASE,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    };
  }
  return { mode: "local", baseUrl: LOCAL_BASE, headers: {} };
}

// Invalidate cache when settings change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && (changes.mode || changes.apiKey)) {
    _apiConfigCache = null;
  }
});

// ---------------------------------------------------------------------------
// Dynamic content script registration (replaces static content_scripts block)
// ---------------------------------------------------------------------------

const CONTENT_SCRIPTS = [
  {
    id: "youtube-content",
    matches: ["*://*.youtube.com/*"],
    js: ["content.js"],
    runAt: "document_idle",
  },
  {
    id: "spotify-content",
    matches: ["*://open.spotify.com/*"],
    js: ["content-spotify.js"],
    runAt: "document_idle",
  },
];

async function registerContentScripts() {
  // Unregister existing scripts first to avoid duplicates
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    if (existing.length) {
      await chrome.scripting.unregisterContentScripts({
        ids: existing.map((s) => s.id),
      });
    }
  } catch {
    // First install — nothing to unregister
  }

  // Register all known content scripts
  await chrome.scripting.registerContentScripts(CONTENT_SCRIPTS);
}

// Register on install and startup
chrome.runtime.onInstalled.addListener(() => {
  registerContentScripts();
});

chrome.runtime.onStartup.addListener(() => {
  registerContentScripts();
  recoverInterruptedTranscription();
});

// When a new optional host permission is granted, register a content script
// for it if one is defined. This lets future platforms be added without a
// manifest update — just call chrome.permissions.request() from the UI.
chrome.permissions.onAdded.addListener((permissions) => {
  if (permissions.origins?.length) {
    registerContentScripts();
  }
});

function extractContentId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    // YouTube
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/shorts/")[1]?.split("/")[0];
      if (u.pathname.startsWith("/embed/")) return u.pathname.split("/embed/")[1]?.split("/")[0];
    }

    // Spotify episode
    if (host === "open.spotify.com") {
      const match = u.pathname.match(/^\/episode\/([a-zA-Z0-9]{22})/);
      if (match) return match[1];
    }
  } catch {
    // ignore
  }
  return null;
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
// API helpers
// ---------------------------------------------------------------------------

async function checkService() {
  const config = await getApiConfig();
  const health = await tryHealthCheck(config.baseUrl, config.headers, config.mode);

  // In cloud mode, the health endpoint doesn't require auth — so a 200 from
  // /api/health doesn't mean the API key is valid. Validate the key separately
  // by hitting an authenticated endpoint.
  if (health.online && config.mode === "cloud" && config.headers.Authorization) {
    try {
      const res = await fetch(`${config.baseUrl}/api/account`, {
        method: "GET",
        headers: config.headers,
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 401) {
        return { online: false, mode: "cloud", authError: true };
      }
    } catch {
      // Network error on key check — still treat as online since health passed
    }
  }

  return health;
}

/** Probe localhost to see if a local instance is running. */
async function detectLocalInstance() {
  try {
    const res = await fetch(`${LOCAL_BASE}/api/health`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function tryHealthCheck(baseUrl, headers, mode) {
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.projectPath) {
        chrome.storage.local.set({ projectPath: data.projectPath });
      }
    }
    if (res.status === 401) return { online: false, mode, authError: true };
    return { online: res.ok || res.status === 503, mode };
  } catch {
    return { online: false, mode };
  }
}

async function transcribeRequest(url) {
  const config = await getApiConfig();
  const res = await fetch(`${config.baseUrl}/api/transcripts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...config.headers },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(await classifyError(res.status, data));
  }

  // Cloud mode: poll until async job completes
  if (res.status === 202 && data.status === "processing" && data.id) {
    return await pollUntilDone(data.id, config);
  }

  return data;
}

async function pollUntilDone(id, config) {
  const maxAttempts = 120; // 6 minutes at 3s intervals
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const res = await fetch(`${config.baseUrl}/api/transcripts/${id}`, {
        headers: config.headers,
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.status === "done") return data;
      if (data.status === "failed") throw new Error(data.error || "Transcription failed");
      // Update progress text for the popup to pick up
      if (data.progress) {
        const state = await getState();
        if (state && state.status === "transcribing") {
          state.progressText = data.progress;
          await setState(state);
        }
      }
    } catch (err) {
      if (err.message === "Transcription failed") throw err;
      // Network errors — keep polling
    }
  }
  throw new Error("Transcription timed out");
}

async function classifyError(status, data) {
  const config = await getApiConfig();
  if (config.mode === "local") {
    if (status === 401) return "Server rejected the request. Check your local setup.";
    if (status >= 500) return "Local server error. Check the terminal for details.";
    return data?.error || `HTTP ${status}`;
  }
  if (status === 401) return "Invalid API key. Check your key in Settings or at transcribed.dev/developers";
  if (status === 429) return "Quota reached. Upgrade your plan at transcribed.dev/pricing";
  if (status >= 500) return "Cloud service error. Try again in a moment.";
  return data?.error || `HTTP ${status}`;
}

async function getRecent() {
  const config = await getApiConfig();
  const res = await fetch(`${config.baseUrl}/api/transcripts`, {
    headers: config.headers,
  });
  if (!res.ok) throw new Error(await classifyError(res.status, {}));
  const all = await res.json();
  return all.slice(0, 5);
}

async function checkExisting(videoId) {
  const config = await getApiConfig();
  const res = await fetch(`${config.baseUrl}/api/transcripts`, {
    headers: config.headers,
  });
  if (!res.ok) return null;
  const all = await res.json();
  return all.find((t) => t.videoId === videoId) || null;
}

// ---------------------------------------------------------------------------
// Core transcribe — runs in background, persists state
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

  try {
    const data = await transcribeRequest(url);
    state.status = "done";
    state.result = data;
    await setState(state);
    setBadge("✓", "#22c55e");
    // Auto-clear badge after 5 seconds
    setTimeout(() => {
      getState().then((s) => {
        // Only clear if still showing the same completion (not a new transcription)
        if (s?.status === "done" || !s) setBadge("");
      });
    }, 5000);
    // Auto-process queue
    await processNextInQueue();
    return data;
  } catch (err) {
    state.status = "error";
    state.error = err.message;
    await setState(state);
    setBadge("!", "#ef4444");
    throw err;
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

  // Fire and forget — runs in background
  doTranscribe(next.url, next.title).catch(() => {});

  return { processing: true, title: next.title, url: next.url };
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handle = async () => {
    switch (message.type) {
      case "CLOSE_PANEL": {
        // Tell the side panel to close itself via the port
        if (sidePanelPort) {
          try { sidePanelPort.postMessage({ type: "CLOSE" }); } catch { /* ignore */ }
        }
        // Also try the sidePanel API as backup
        const tabWindowId = sender.tab?.windowId;
        if (tabWindowId) {
          try {
            if (chrome.sidePanel.close) {
              await chrome.sidePanel.close({ windowId: tabWindowId });
            }
          } catch { /* ignore */ }
        }
        return { ok: true };
      }

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
        const config = await getApiConfig();
        const appBase = config.mode === "cloud" ? CLOUD_BASE : LOCAL_BASE;
        // Append timestamp to bust Chrome's same-URL no-op optimization
        const fullUrl = `${appBase}/?layout=list&id=${transcriptId}&t=${Date.now()}`;

        // Find existing app tab
        const matchHost = config.mode === "cloud" ? "www.transcribed.dev" : "localhost:19720";
        const allTabs = await chrome.tabs.query({});
        const appTab = allTabs.find((t) => t.url && t.url.includes(matchHost));

        if (appTab) {
          // Reuse existing tab — navigate it to the transcript
          await chrome.tabs.update(appTab.id, { url: fullUrl, active: true });
          await chrome.windows.update(appTab.windowId, { focused: true });
        } else {
          await chrome.tabs.create({ url: fullUrl, active: true });
        }
        return { ok: true };
      }

      case "PAGE_INFO":
      case "PAGE_CHANGED":
        if (sender.tab?.id) {
          await chrome.storage.session.set({
            [`tab_${sender.tab.id}`]: {
              url: message.url,
              title: message.title,
              videoId: message.videoId,
              isLive: !!message.isLive,
            },
          });
        }
        return { ok: true };

      case "GET_SETTINGS": {
        const { mode, apiKey } = await chrome.storage.sync.get(["mode", "apiKey"]);
        return { mode: mode || "cloud", hasApiKey: !!apiKey };
      }

      case "DETECT_LOCAL": {
        const localAvailable = await detectLocalInstance();
        return { available: localAvailable };
      }

      case "SAVE_SETTINGS": {
        const settings = {};
        if (message.mode !== undefined) settings.mode = message.mode;
        if (message.apiKey !== undefined) settings.apiKey = message.apiKey;
        await chrome.storage.sync.set(settings);
        _apiConfigCache = null;
        return { ok: true };
      }

      case "TEST_CONNECTION": {
        const testConfig = buildConfig(message.mode, message.apiKey);
        return await tryHealthCheck(testConfig.baseUrl, testConfig.headers, message.mode);
      }

      case "GET_PAGE_INFO": {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab?.id) return { url: null, title: null, videoId: null };
        const stored = await chrome.storage.session.get(`tab_${tab.id}`);
        if (stored[`tab_${tab.id}`]) return stored[`tab_${tab.id}`];
        const videoId = extractContentId(tab.url);
        return { url: tab.url, title: tab.title, videoId };
      }

      default:
        return { error: "Unknown message type" };
    }
  };

  handle()
    .then((result) => sendResponse({ success: true, data: result }))
    .catch((err) => sendResponse({ success: false, error: err.message }));

  return true;
});

// ---------------------------------------------------------------------------
// Side panel — toggle on extension icon click
// ---------------------------------------------------------------------------

let sidePanelPort = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "sidepanel") {
    sidePanelPort = port;
    port.onDisconnect.addListener(() => {
      sidePanelPort = null;
    });
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (sidePanelPort) {
    // Ask the side panel to close itself
    try { sidePanelPort.postMessage({ type: "CLOSE" }); } catch { /* ignore */ }
    // Also try the API
    try {
      if (chrome.sidePanel.close) {
        await chrome.sidePanel.close({ windowId: tab.windowId });
      }
    } catch { /* ignore */ }
  } else {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// ---------------------------------------------------------------------------
// Interrupted transcription recovery (called from onStartup above)
// ---------------------------------------------------------------------------
async function recoverInterruptedTranscription() {
  const state = await getState();
  if (state?.status === "transcribing") {
    state.status = "error";
    state.error = "Transcription was interrupted. Please retry.";
    await setState(state);
    setBadge("!", "#ef4444");
  }
}
