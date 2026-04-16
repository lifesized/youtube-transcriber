// Keep a port open so the background script knows the side panel is active
const port = chrome.runtime.connect({ name: "sidepanel" });

// Listen for close requests from background (e.g. fullscreen)
port.onMessage.addListener((msg) => {
  if (msg.type === "CLOSE") {
    window.close();
  }
});

// DOM refs
const el = {
  stateNoService: document.getElementById("stateNoService"),
  stateNotYoutube: document.getElementById("stateNotYoutube"),
  stateReady: document.getElementById("stateReady"),
  stateTranscribing: document.getElementById("stateTranscribing"),
  stateError: document.getElementById("stateError"),
  videoTitle: document.getElementById("videoTitle"),
  transcribingTitle: document.getElementById("transcribingTitle"),
  btnTranscribe: document.getElementById("btnTranscribe"),
  btnAlreadyTranscribed: document.getElementById("btnAlreadyTranscribed"),
  progressText: document.getElementById("progressText"),
  errorMessage: document.getElementById("errorMessage"),
  btnRetry: document.getElementById("btnRetry"),
  recentSection: document.getElementById("recentSection"),
  recentList: document.getElementById("recentList"),
  queuePrompt: document.getElementById("queuePrompt"),
  queueVideoTitle: document.getElementById("queueVideoTitle"),
  btnQueue: document.getElementById("btnQueue"),
  queueList: document.getElementById("queueList"),
  btnCancel: document.getElementById("btnCancel"),
  btnCheckAgain: document.getElementById("btnCheckAgain"),
  btnCopyCommand: document.getElementById("btnCopyCommand"),
  offlinePath: document.getElementById("offlinePath"),
  offlineCommand: document.getElementById("offlineCommand"),
  offlineLocalMsg: document.getElementById("offlineLocalMsg"),
  offlineCloudMsg: document.getElementById("offlineCloudMsg"),
  offlineCloudSub: document.getElementById("offlineCloudSub"),
  cloudOnboarding: document.getElementById("cloudOnboarding"),
  cloudAuthError: document.getElementById("cloudAuthError"),
  btnHaveAccount: document.getElementById("btnHaveAccount"),
  localDetectedBanner: document.getElementById("localDetectedBanner"),
  btnUseLocal: document.getElementById("btnUseLocal"),
  cloudNudge: document.getElementById("cloudNudge"),
  liveNotice: document.getElementById("liveNotice"),
  btnNavLibrary: document.getElementById("btnNavLibrary"),
  btnNavSettings: document.getElementById("btnNavSettings"),
  settingsPanel: document.getElementById("settingsPanel"),
  btnModeLocal: document.getElementById("btnModeLocal"),
  btnModeCloud: document.getElementById("btnModeCloud"),
  apiKeySection: document.getElementById("apiKeySection"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  btnTestConnection: document.getElementById("btnTestConnection"),
  connectionStatus: document.getElementById("connectionStatus"),
  btnSaveSettings: document.getElementById("btnSaveSettings"),
};

let pageInfo = null;
let progressTimer = null;
let justCompletedId = null;
let pollInterval = null;
let isTranscribing = false;
let offlinePollTimer = null;
let heartbeatTimer = null;
// When true, direct TRANSCRIBE response owns completion/error handling.
let suppressPollFinalization = false;

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

const PROGRESS_STAGES = [
  { at: 0, label: "Sending to transcriber..." },
  { at: 5, label: "Checking for captions..." },
  { at: 15, label: "Downloading audio..." },
  { at: 35, label: "Transcribing audio..." },
  { at: 60, label: "Processing transcript..." },
  { at: 80, label: "Almost done..." },
  { at: 90, label: "Finishing up..." },
];

function startProgress() {
  const bar = document.getElementById("progressBar");
  bar.classList.remove("indeterminate");
  bar.style.width = "0%";
  let stageIdx = 0;
  let elapsed = 0;

  el.progressText.textContent = PROGRESS_STAGES[0].label;

  progressTimer = setInterval(() => {
    elapsed += 1;
    const pct = Math.min(90, 5 + 85 * (1 - Math.exp(-elapsed / 40)));
    bar.style.width = `${pct.toFixed(1)}%`;

    while (
      stageIdx < PROGRESS_STAGES.length - 1 &&
      pct >= PROGRESS_STAGES[stageIdx + 1].at
    ) {
      stageIdx++;
      el.progressText.textContent = PROGRESS_STAGES[stageIdx].label;
    }
  }, 1000);
}

function stopProgress() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
  const bar = document.getElementById("progressBar");
  bar.style.width = "100%";
}

function startIndeterminate() {
  // Clear any running local-mode progress timer to avoid conflicts
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
  const bar = document.getElementById("progressBar");
  bar.style.width = "";
  bar.classList.add("indeterminate");
  el.progressText.textContent = "Transcription in progress...";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendMsg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, resolve);
  });
}

const ALL_STATES = [
  "NoService",
  "NotYoutube",
  "Ready",
  "Transcribing",
  "Error",
];

function showState(name) {
  for (const s of ALL_STATES) {
    const elem = el[`state${s}`];
    if (elem) elem.hidden = s !== name;
  }
  // Hide recent list when offline or errored — only show alongside Ready/Transcribing
  if (name === "NoService" || name === "NotYoutube") {
    el.recentSection.hidden = true;
  }
}

function stopOfflinePolling() {
  if (offlinePollTimer) {
    clearInterval(offlinePollTimer);
    offlinePollTimer = null;
  }
}

function startOfflinePolling() {
  stopOfflinePolling();
  stopHeartbeat();
  offlinePollTimer = setInterval(async () => {
    const res = await sendMsg({ type: "CHECK_SERVICE" });
    if (res?.success && res.data?.online) {
      stopOfflinePolling();
      init();
    }
  }, 5000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(async () => {
    if (isTranscribing) return;
    const res = await sendMsg({ type: "CHECK_SERVICE" });
    if (!res?.success || !res.data?.online) {
      stopHeartbeat();
      init();
    }
  }, 10000);
}

function loadCachedPath() {
  el.offlinePath.hidden = true;
  el.offlineCommand.textContent = "npm run dev";
  delete el.offlineCommand.dataset.fullCmd;
}

function isServerDownError(msg) {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return lower.includes("failed to fetch") ||
    lower.includes("network error") ||
    lower.includes("econnrefused") ||
    lower.includes("net::err_connection_refused");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Open transcript in app — reuse existing app tab
// ---------------------------------------------------------------------------

async function openTranscript(id) {
  await sendMsg({ type: "OPEN_TRANSCRIPT", id });
}

function showCompletedAndReturn(completedId) {
  // Highlight the new transcript in the recent list, then show normal page state
  justCompletedId = completedId;
  setTimeout(() => { justCompletedId = null; }, 1900);
  showCurrentPageState();
  loadRecent();
  // Check if there are queued items to process next
  processQueue();
}

// ---------------------------------------------------------------------------
// Queue UI
// ---------------------------------------------------------------------------

async function showQueuePrompt(transcribingUrl) {
  if (!pageInfo?.videoId) {
    el.queuePrompt.hidden = true;
    return;
  }
  // Resolve the currently-transcribing URL from state if not passed explicitly
  if (!transcribingUrl) {
    const statusRes = await sendMsg({ type: "GET_TRANSCRIPTION_STATUS" });
    if (statusRes?.success && statusRes.data?.status === "transcribing") {
      transcribingUrl = statusRes.data.url;
    }
  }
  // Don't show queue prompt if this video is already being transcribed
  if (transcribingUrl && pageInfo.url === transcribingUrl) {
    el.queuePrompt.hidden = true;
    return;
  }
  // Don't show queue prompt if this video is already in the queue
  const queueRes = await sendMsg({ type: "GET_QUEUE" });
  const queue = queueRes?.success ? queueRes.data : [];
  if (queue.some((q) => q.url === pageInfo.url)) {
    el.queuePrompt.hidden = true;
    return;
  }
  // Don't show queue prompt if this video is already transcribed
  const existingRes = await sendMsg({ type: "CHECK_EXISTING", videoId: pageInfo.videoId });
  if (existingRes?.success && existingRes.data) {
    el.queuePrompt.hidden = true;
    return;
  }
  el.queueVideoTitle.textContent = pageInfo.title || pageInfo.url;
  el.queuePrompt.hidden = false;
}

async function renderQueueList() {
  const res = await sendMsg({ type: "GET_QUEUE" });
  const queue = res?.success ? res.data : [];
  if (!queue?.length) {
    el.queueList.hidden = true;
    return;
  }
  el.queueList.hidden = false;
  el.queueList.innerHTML = "";
  for (const item of queue) {
    const card = document.createElement("div");
    card.className = "queue-card";
    card.innerHTML = `
      <div class="queue-card-row">
        <span class="status-dot pending"></span>
        <div class="queue-card-content">
          <div class="queue-card-title">${escapeHtml(item.title || item.url)}</div>
          <div class="queue-card-status">Queued</div>
        </div>
      </div>
    `;
    el.queueList.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Recent transcripts
// ---------------------------------------------------------------------------

async function loadRecent() {
  const res = await sendMsg({ type: "GET_RECENT" });
  if (!res?.success || !res.data?.length) {
    el.recentSection.hidden = true;
    return;
  }
  el.recentSection.hidden = false;
  el.recentList.innerHTML = "";
  for (const t of res.data) {
    const isNew = justCompletedId && t.id === justCompletedId;
    const item = document.createElement("a");
    item.className = `recent-item${isNew ? " recent-item-new" : ""}`;
    item.href = "#";
    item.addEventListener("click", (e) => {
      e.preventDefault();
      openTranscript(t.id);
    });
    item.innerHTML = `
      <div class="recent-item-content">
        ${isNew ? '<span class="recent-tick">&#10003;</span>' : ""}
        <div class="recent-text">
          <span class="recent-title">${escapeHtml(t.title)}</span>
          <span class="recent-meta">${escapeHtml(t.author)} &middot; ${formatDate(t.createdAt)}</span>
        </div>
      </div>
      ${isNew ? `<svg class="recent-arrow" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 4l6 6-6 6"/>
      </svg>` : ""}
    `;
    el.recentList.appendChild(item);

    // Two-phase animation: visual fade, then smooth spatial collapse
    if (isNew) {
      // Phase 1 complete (1.4s) — tick is visually gone, now collapse space
      setTimeout(() => {
        const tick = item.querySelector(".recent-tick");
        const arrow = item.querySelector(".recent-arrow");
        if (tick) tick.classList.add("collapsing");
        if (arrow) arrow.classList.add("collapsing");
      }, 1400);
      // Phase 2 complete (1.4s + 0.4s) — remove from DOM cleanly
      setTimeout(() => {
        item.classList.remove("recent-item-new");
        const tick = item.querySelector(".recent-tick");
        const arrow = item.querySelector(".recent-arrow");
        if (tick) tick.remove();
        if (arrow) arrow.remove();
      }, 1850);
    }
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function extractVideoId(url) {
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
  } catch { /* ignore */ }
  return null;
}

let existingTranscriptId = null;
let pageStateVersion = 0;

async function showCurrentPageState() {
  existingTranscriptId = null;
  const version = ++pageStateVersion;

  if (!pageInfo?.videoId) {
    showState("NotYoutube");
    return;
  }

  el.videoTitle.textContent = pageInfo.title || pageInfo.url;

  // Hide all action elements until we know which to show
  el.btnTranscribe.hidden = true;
  el.btnAlreadyTranscribed.hidden = true;
  el.liveNotice.hidden = true;
  showState("Ready");

  // Block transcription for live streams
  if (pageInfo.isLive) {
    el.liveNotice.hidden = false;
    loadRecent();
    return;
  }

  // Check if this video was already transcribed
  const existingRes = await sendMsg({ type: "CHECK_EXISTING", videoId: pageInfo.videoId });

  // Stale check — a newer call has taken over
  if (version !== pageStateVersion) return;

  if (existingRes?.success && existingRes.data) {
    existingTranscriptId = existingRes.data.id;
    el.btnTranscribe.hidden = true;
    el.btnAlreadyTranscribed.hidden = false;
  } else {
    el.btnTranscribe.hidden = false;
    el.btnAlreadyTranscribed.hidden = true;
  }
}

let initVersion = 0;

async function init() {
  const thisInit = ++initVersion;

  // Close settings if open, mark library active
  el.settingsPanel.hidden = true;
  el.btnNavLibrary.classList.add("active");
  el.btnNavSettings.classList.remove("active");

  // Reset stale UI from previous state
  for (const s of ALL_STATES) {
    const elem = el[`state${s}`];
    if (elem) elem.hidden = true;
  }
  el.recentSection.hidden = true;
  stopOfflinePolling();
  el.btnAlreadyTranscribed.hidden = true;
  el.btnTranscribe.hidden = false;
  existingTranscriptId = null;

  // Get active tab directly
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (thisInit !== initVersion) return;
    if (tab) {
      const videoId = extractVideoId(tab.url || "");
      // Read isLive flag from content script's stored page info
      let isLive = false;
      try {
        const stored = await chrome.storage.session.get(`tab_${tab.id}`);
        isLive = !!stored[`tab_${tab.id}`]?.isLive;
      } catch { /* ignore */ }
      pageInfo = { url: tab.url, title: tab.title, videoId, isLive };
      currentTabUrl = tab.url;
      currentTabId = tab.id;
    }
  } catch { /* ignore */ }

  // Check if there's an in-flight transcription from a previous popup open
  const statusRes = await sendMsg({ type: "GET_TRANSCRIPTION_STATUS" });
  if (thisInit !== initVersion) return;
  if (statusRes?.success && statusRes.data) {
    const pending = statusRes.data;
    if (pending.status === "transcribing") {
      isTranscribing = true;
      el.transcribingTitle.textContent = pending.title || "Transcribing...";
      showState("Transcribing");
      // Only restart animation/polling if not already running — prevents
      // glitchy restart when switching tabs during an active transcription
      if (!pollInterval) {
        startIndeterminate();
        pollTranscriptionStatus();
      }
      showQueuePrompt(pending.url);
      renderQueueList();
      loadRecent();
      return;
    }
    if (pending.status === "done" && pending.result) {
      isTranscribing = false;
      stopProgress();
      stopPolling();
      await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
      showCompletedAndReturn(pending.result.id);
      return;
    }
    if (pending.status === "error") {
      await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
      if (isServerDownError(pending.error)) {
        // Trigger full init to get mode-aware offline messaging
        init();
        return;
      }
      el.errorMessage.textContent = pending.error || "Transcription failed";
      showState("Error");
      loadRecent();
      return;
    }
  }

  // 1. Check service
  const serviceRes = await sendMsg({ type: "CHECK_SERVICE" });
  if (thisInit !== initVersion) return;
  const online = serviceRes?.success && serviceRes.data?.online;

  if (!online) {
    const cfgRes = await sendMsg({ type: "GET_SETTINGS" });
    if (thisInit !== initVersion) return;
    const cfgMode = cfgRes?.data?.mode || "cloud";
    const hasApiKey = cfgRes?.data?.hasApiKey;
    const authError = serviceRes?.data?.authError;

    if (cfgMode === "cloud") {
      el.offlineLocalMsg.hidden = true;
      el.offlineCloudMsg.hidden = false;
      el.cloudNudge.hidden = true;
      el.localDetectedBanner.hidden = true;

      if (hasApiKey) {
        // Has a key but it's failing — show error state
        el.cloudOnboarding.hidden = true;
        el.cloudAuthError.hidden = false;
        if (authError) {
          el.offlineCloudSub.textContent = "Your API key is invalid. Update it in settings.";
        } else {
          el.offlineCloudSub.textContent = "Check your API key or try again later";
        }
      } else {
        // No key — show onboarding
        el.cloudOnboarding.hidden = false;
        el.cloudAuthError.hidden = true;
      }

      // Auto-detect local instance and show banner
      const localRes = await sendMsg({ type: "DETECT_LOCAL" });
      if (thisInit !== initVersion) return;
      if (localRes?.success && localRes.data?.available) {
        el.localDetectedBanner.hidden = false;
      }
    } else {
      el.offlineLocalMsg.hidden = false;
      el.offlineCloudMsg.hidden = true;
      el.cloudNudge.hidden = false;
      el.localDetectedBanner.hidden = true;
      loadCachedPath();
    }

    showState("NoService");
    startOfflinePolling();
    return;
  }
  stopOfflinePolling();

  // Cloud mode without API key — show onboarding instead of Transcribe button
  const cfgCheck = await sendMsg({ type: "GET_SETTINGS" });
  if (thisInit !== initVersion) return;
  if (cfgCheck?.data?.mode === "cloud" && !cfgCheck?.data?.hasApiKey) {
    el.offlineLocalMsg.hidden = true;
    el.offlineCloudMsg.hidden = false;
    el.cloudNudge.hidden = true;
    el.localDetectedBanner.hidden = true;
    el.cloudOnboarding.hidden = false;
    el.cloudAuthError.hidden = true;

    // Auto-detect local instance and show banner
    const localRes = await sendMsg({ type: "DETECT_LOCAL" });
    if (thisInit !== initVersion) return;
    if (localRes?.success && localRes.data?.available) {
      el.localDetectedBanner.hidden = false;
    }

    showState("NoService");
    return;
  }

  startHeartbeat();

  // 2. Show page state
  showCurrentPageState();

  // 3. Load recent
  loadRecent();
}

// ---------------------------------------------------------------------------
// Poll for transcription completion
// ---------------------------------------------------------------------------

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function pollTranscriptionStatus() {
  stopPolling();
  pollInterval = setInterval(async () => {
    const res = await sendMsg({ type: "GET_TRANSCRIPTION_STATUS" });
    if (!res?.success || !res.data) {
      stopPolling();
      return;
    }
    const pending = res.data;
    // Show real progress text from cloud polling
    if (pending.status === "transcribing" && pending.progressText) {
      el.progressText.textContent = pending.progressText;
    }
    if (pending.status === "done" && pending.result) {
      if (suppressPollFinalization) {
        stopPolling();
        return;
      }
      isTranscribing = false;
      stopPolling();
      stopProgress();
      await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
      showCompletedAndReturn(pending.result.id);
    } else if (pending.status === "error") {
      if (suppressPollFinalization) {
        stopPolling();
        return;
      }
      isTranscribing = false;
      stopPolling();
      stopProgress();
      await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
      if (isServerDownError(pending.error)) {
        init();
      } else {
        el.errorMessage.textContent = pending.error || "Transcription failed";
        showState("Error");
      }
    }
  }, 2000);
}

// ---------------------------------------------------------------------------
// Transcribe
// ---------------------------------------------------------------------------

async function doTranscribe() {
  if (!pageInfo?.url) return;

  isTranscribing = true;
  el.transcribingTitle.textContent = pageInfo.title || "Transcribing...";
  showState("Transcribing");
  el.queuePrompt.hidden = true;

  // Cloud mode: indeterminate bar + poll for real progress
  // Local mode: fake staged progress bar
  const cfgRes = await sendMsg({ type: "GET_SETTINGS" });
  const isCloud = cfgRes?.data?.mode === "cloud";
  if (isCloud) {
    suppressPollFinalization = true;
    startIndeterminate();
    pollTranscriptionStatus();
  } else {
    suppressPollFinalization = false;
    startProgress();
  }

  const res = await sendMsg({
    type: "TRANSCRIBE",
    url: pageInfo.url,
    title: pageInfo.title,
  });

  isTranscribing = false;
  suppressPollFinalization = false;
  stopPolling();
  stopProgress();

  if (res?.success && res.data?.id) {
    await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
    showCompletedAndReturn(res.data.id);
    processQueue();
  } else {
    await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
    if (isServerDownError(res?.error)) {
      init();
      return;
    }
    // In self-hosted mode, re-check server health before showing error —
    // if the server is down, show the "Waiting for server" screen instead
    // of a generic error message.
    const mode = (await sendMsg({ type: "GET_SETTINGS" }))?.data?.mode || "cloud";
    if (mode === "local") {
      const health = await sendMsg({ type: "CHECK_SERVICE" });
      if (!health?.success || !health.data?.online) {
        init();
        return;
      }
    }
    el.errorMessage.textContent = res?.error || "Transcription failed";
    showState("Error");
  }
}

async function processQueue() {
  suppressPollFinalization = false;
  const res = await sendMsg({ type: "PROCESS_QUEUE" });
  if (res?.success && res.data?.processing) {
    el.transcribingTitle.textContent = res.data.title || "Transcribing...";
    showState("Transcribing");
    startIndeterminate();
    showQueuePrompt();
    renderQueueList();
    pollTranscriptionStatus();
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

el.btnTranscribe.addEventListener("click", doTranscribe);
el.btnRetry.addEventListener("click", doTranscribe);
el.btnCheckAgain.addEventListener("click", init);

// "Already have an API key?" — jump to settings with cloud mode
el.btnHaveAccount.addEventListener("click", () => {
  showSettingsView();
});

// "Switch to self-hosted" — auto-switch to local mode
el.btnUseLocal.addEventListener("click", async () => {
  await sendMsg({ type: "SAVE_SETTINGS", mode: "local" });
  init();
});

el.btnCopyCommand.addEventListener("click", () => {
  const cmd = el.offlineCommand.dataset.fullCmd || el.offlineCommand.textContent;
  navigator.clipboard.writeText(cmd);
  el.btnCopyCommand.classList.add("copied");
  setTimeout(() => el.btnCopyCommand.classList.remove("copied"), 1500);
});

el.btnAlreadyTranscribed.addEventListener("click", (e) => {
  e.preventDefault();
  if (existingTranscriptId) {
    openTranscript(existingTranscriptId);
  }
});

el.btnCancel.addEventListener("click", async () => {
  isTranscribing = false;
  stopProgress();
  stopPolling();
  await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
  // Also clear the queue
  await sendMsg({ type: "CLEAR_QUEUE" });
  showCurrentPageState();
  loadRecent();
});

el.btnQueue.addEventListener("click", async () => {
  if (!pageInfo?.url) return;
  await sendMsg({
    type: "QUEUE_ADD",
    url: pageInfo.url,
    title: pageInfo.title,
  });
  el.queuePrompt.hidden = true;
  renderQueueList();
});

// ---------------------------------------------------------------------------
// Auto-refresh when active tab changes (side panel stays open)
// ---------------------------------------------------------------------------

let currentTabUrl = null;
let currentTabId = null;

chrome.tabs.onActivated?.addListener(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && tab.url !== currentTabUrl) {
      currentTabUrl = tab.url;
      currentTabId = tab.id;
      // During active transcription, only update page info for queue prompt —
      // don't re-init which would clobber the progress animation
      if (isTranscribing) {
        const videoId = extractVideoId(tab.url || "");
        let isLive = false;
        try {
          const stored = await chrome.storage.session.get(`tab_${tab.id}`);
          isLive = !!stored[`tab_${tab.id}`]?.isLive;
        } catch { /* ignore */ }
        pageInfo = { url: tab.url, title: tab.title, videoId, isLive };
        showQueuePrompt();
      } else {
        init();
      }
    }
  } catch { /* ignore */ }
});

chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
  // Only react to changes in the active tab
  if (tabId !== currentTabId) return;
  // Skip all tab-change events during active transcription
  if (isTranscribing) return;

  if (changeInfo.url && changeInfo.url !== currentTabUrl) {
    currentTabUrl = changeInfo.url;
    init();
  }
  // YouTube SPA navigations update the title after the URL — re-init to pick up the new title
  if (changeInfo.title) {
    init();
  }
});

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

let currentSettingsMode = "cloud";

function showSettingsView() {
  for (const s of ALL_STATES) {
    const elem = el[`state${s}`];
    if (elem) elem.hidden = true;
  }
  el.recentSection.hidden = true;
  el.queuePrompt.hidden = true;
  el.queueList.hidden = true;
  el.settingsPanel.hidden = false;
  el.btnNavSettings.classList.add("active");
  el.btnNavLibrary.classList.remove("active");
  loadSettings();
}

el.btnNavSettings.addEventListener("click", () => {
  if (!el.settingsPanel.hidden) return; // already showing
  showSettingsView();
});

el.btnNavLibrary.addEventListener("click", () => {
  if (el.settingsPanel.hidden) return; // already showing library
  // During active transcription, restore the transcribing UI without
  // re-initialising — avoids restarting progress animation from scratch
  if (isTranscribing) {
    el.settingsPanel.hidden = true;
    el.btnNavLibrary.classList.add("active");
    el.btnNavSettings.classList.remove("active");
    showState("Transcribing");
    loadRecent();
    showQueuePrompt();
    renderQueueList();
    return;
  }
  init();
});

async function loadSettings() {
  const res = await sendMsg({ type: "GET_SETTINGS" });
  if (!res?.success) return;
  const { mode, hasApiKey } = res.data;
  setModeUI(mode);
  el.connectionStatus.hidden = true;
  if (hasApiKey) {
    el.apiKeyInput.value = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
    el.apiKeyInput.dataset.unchanged = "true";
  } else {
    el.apiKeyInput.value = "";
    delete el.apiKeyInput.dataset.unchanged;
  }
}

function setModeUI(mode) {
  currentSettingsMode = mode;
  el.btnModeLocal.classList.toggle("active", mode === "local");
  el.btnModeCloud.classList.toggle("active", mode === "cloud");
  el.apiKeySection.hidden = mode !== "cloud";
}

el.btnModeLocal.addEventListener("click", async () => {
  setModeUI("local");
  await sendMsg({ type: "SAVE_SETTINGS", mode: "local" });
});
el.btnModeCloud.addEventListener("click", async () => {
  setModeUI("cloud");
  await sendMsg({ type: "SAVE_SETTINGS", mode: "cloud" });
});

el.apiKeyInput.addEventListener("focus", () => {
  if (el.apiKeyInput.dataset.unchanged === "true") {
    el.apiKeyInput.value = "";
    delete el.apiKeyInput.dataset.unchanged;
  }
});

el.btnTestConnection.addEventListener("click", async () => {
  el.connectionStatus.hidden = false;
  el.connectionStatus.textContent = "Testing...";
  el.connectionStatus.className = "settings-status testing";

  // Use the entered key, or fetch the stored one if unchanged
  let apiKey;
  if (el.apiKeyInput.dataset.unchanged === "true") {
    const stored = await chrome.storage.sync.get("apiKey");
    apiKey = stored.apiKey || "";
  } else {
    apiKey = el.apiKeyInput.value;
  }

  const res = await sendMsg({
    type: "TEST_CONNECTION",
    mode: currentSettingsMode,
    apiKey,
  });

  if (res?.success && res.data?.online) {
    el.connectionStatus.textContent = "Connected";
    el.connectionStatus.className = "settings-status success";
  } else if (res?.data?.authError) {
    el.connectionStatus.textContent = "Invalid API key";
    el.connectionStatus.className = "settings-status error";
  } else {
    el.connectionStatus.textContent = "Connection failed";
    el.connectionStatus.className = "settings-status error";
  }
});

el.btnSaveSettings.addEventListener("click", async () => {
  if (el.apiKeyInput.dataset.unchanged === "true") return;
  await sendMsg({ type: "SAVE_SETTINGS", apiKey: el.apiKeyInput.value });
  el.apiKeyInput.dataset.unchanged = "true";
  el.apiKeyInput.value = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
  init();
});

// Start
init();
