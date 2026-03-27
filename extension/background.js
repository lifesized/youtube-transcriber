const API_BASE = "http://localhost:19720";

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

async function transcribeRequest(url) {
  const res = await fetch(`${API_BASE}/api/transcripts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
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
        const fullUrl = `${API_BASE}/?layout=list&id=${transcriptId}`;

        // Find existing app tab
        const allTabs = await chrome.tabs.query({});
        const appTab = allTabs.find((t) => t.url && t.url.includes("localhost:19720"));

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
            },
          });
        }
        return { ok: true };

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
// On startup — check if a transcription was interrupted
// ---------------------------------------------------------------------------
chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  if (state?.status === "transcribing") {
    // Service worker restarted mid-transcription — mark as error
    state.status = "error";
    state.error = "Transcription was interrupted. Please retry.";
    await setState(state);
    setBadge("!", "#ef4444");
  }
});
