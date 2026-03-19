const API_APP_BASE = "http://localhost:19720";

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
};

let pageInfo = null;
let progressTimer = null;
let justCompletedId = null;
let pollInterval = null;
let isTranscribing = false;

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

async function openTranscript(url) {
  const transcriptId = new URL(url).searchParams.get("id");
  await sendMsg({ type: "OPEN_TRANSCRIPT", id: transcriptId });
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
      openTranscript(`${API_APP_BASE}/?id=${t.id}`);
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
    if (u.hostname !== "www.youtube.com" && u.hostname !== "youtube.com" && u.hostname !== "m.youtube.com") return null;
    if (u.pathname === "/watch") return u.searchParams.get("v");
    if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/shorts/")[1]?.split("/")[0];
    if (u.pathname.startsWith("/embed/")) return u.pathname.split("/embed/")[1]?.split("/")[0];
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

  // Hide both buttons until we know which to show
  el.btnTranscribe.hidden = true;
  el.btnAlreadyTranscribed.hidden = true;
  showState("Ready");

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

  // Reset stale UI from previous state
  el.btnAlreadyTranscribed.hidden = true;
  el.btnTranscribe.hidden = false;
  existingTranscriptId = null;

  // Get active tab directly
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (thisInit !== initVersion) return;
    if (tab) {
      const videoId = extractVideoId(tab.url || "");
      pageInfo = { url: tab.url, title: tab.title, videoId };
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
      el.errorMessage.textContent = pending.error || "Transcription failed";
      showState("Error");
      await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
      loadRecent();
      return;
    }
  }

  // 1. Check service
  const serviceRes = await sendMsg({ type: "CHECK_SERVICE" });
  if (thisInit !== initVersion) return;
  const online = serviceRes?.success && serviceRes.data?.online;

  if (!online) {
    showState("NoService");
    return;
  }

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
    if (pending.status === "done" && pending.result) {
      isTranscribing = false;
      stopPolling();
      stopProgress();
      await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
      showCompletedAndReturn(pending.result.id);
    } else if (pending.status === "error") {
      isTranscribing = false;
      stopPolling();
      stopProgress();
      el.errorMessage.textContent = pending.error || "Transcription failed";
      showState("Error");
      await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
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
  startProgress();
  el.queuePrompt.hidden = true;

  const res = await sendMsg({
    type: "TRANSCRIBE",
    url: pageInfo.url,
    title: pageInfo.title,
  });

  isTranscribing = false;
  stopProgress();

  if (res?.success && res.data?.id) {
    await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
    showCompletedAndReturn(res.data.id);
    processQueue();
  } else {
    el.errorMessage.textContent = res?.error || "Transcription failed";
    showState("Error");
    await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
  }
}

async function processQueue() {
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

el.btnAlreadyTranscribed.addEventListener("click", (e) => {
  e.preventDefault();
  if (existingTranscriptId) {
    openTranscript(`${API_APP_BASE}/?id=${existingTranscriptId}`);
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
        pageInfo = { url: tab.url, title: tab.title, videoId };
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

// Start
init();
