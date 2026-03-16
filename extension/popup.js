const API_APP_BASE = "http://localhost:19720";

// DOM refs
const el = {
  stateNoService: document.getElementById("stateNoService"),
  stateNotYoutube: document.getElementById("stateNotYoutube"),
  stateReady: document.getElementById("stateReady"),
  stateTranscribing: document.getElementById("stateTranscribing"),
  stateTranscribed: document.getElementById("stateTranscribed"),
  stateError: document.getElementById("stateError"),
  videoTitle: document.getElementById("videoTitle"),
  transcribingTitle: document.getElementById("transcribingTitle"),
  btnTranscribe: document.getElementById("btnTranscribe"),
  progressText: document.getElementById("progressText"),
  transcribedTitle: document.getElementById("transcribedTitle"),
  btnView: document.getElementById("btnView"),
  errorMessage: document.getElementById("errorMessage"),
  btnRetry: document.getElementById("btnRetry"),
  recentSection: document.getElementById("recentSection"),
  recentList: document.getElementById("recentList"),
  queuePrompt: document.getElementById("queuePrompt"),
  queueVideoTitle: document.getElementById("queueVideoTitle"),
  btnQueue: document.getElementById("btnQueue"),
  queueList: document.getElementById("queueList"),
};

let pageInfo = null;
let progressTimer = null;
let currentTranscriptUrl = null;

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
  "Transcribed",
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

function showTranscribed(title, transcriptUrl) {
  currentTranscriptUrl = transcriptUrl;
  el.transcribedTitle.textContent = title || "Untitled";
  showState("Transcribed");
}

// ---------------------------------------------------------------------------
// Queue UI
// ---------------------------------------------------------------------------

function showQueuePrompt() {
  if (!pageInfo?.videoId) {
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
    const div = document.createElement("div");
    div.className = "queue-item";
    div.textContent = item.title || item.url;
    el.queueList.appendChild(div);
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
    const item = document.createElement("a");
    item.className = "recent-item";
    item.href = "#";
    item.addEventListener("click", (e) => {
      e.preventDefault();
      openTranscript(`${API_APP_BASE}/?id=${t.id}`);
    });
    item.innerHTML = `
      <span class="recent-title">${escapeHtml(t.title)}</span>
      <span class="recent-meta">${escapeHtml(t.author)} &middot; ${formatDate(t.createdAt)}</span>
    `;
    el.recentList.appendChild(item);
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

async function init() {
  // Get active tab directly
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      const videoId = extractVideoId(tab.url || "");
      pageInfo = { url: tab.url, title: tab.title, videoId };
    }
  } catch { /* ignore */ }

  // Check if there's an in-flight transcription from a previous popup open
  const statusRes = await sendMsg({ type: "GET_TRANSCRIPTION_STATUS" });
  if (statusRes?.success && statusRes.data) {
    const pending = statusRes.data;
    if (pending.status === "transcribing") {
      el.transcribingTitle.textContent = pending.title || "Transcribing...";
      showState("Transcribing");
      startIndeterminate();
      showQueuePrompt();
      renderQueueList();
      pollTranscriptionStatus();
      loadRecent();
      return;
    }
    if (pending.status === "done" && pending.result) {
      const url = `${API_APP_BASE}/?id=${pending.result.id}`;
      showTranscribed(pending.result.title || pending.title, url);
      await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
      loadRecent();
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
  const online = serviceRes?.success && serviceRes.data?.online;

  if (!online) {
    showState("NoService");
    return;
  }

  // 2. Show page state
  if (!pageInfo?.videoId) {
    showState("NotYoutube");
  } else {
    // Check if this video was already transcribed
    const existingRes = await sendMsg({ type: "CHECK_EXISTING", videoId: pageInfo.videoId });
    if (existingRes?.success && existingRes.data) {
      const url = `${API_APP_BASE}/?id=${existingRes.data.id}`;
      showTranscribed(existingRes.data.title || pageInfo.title, url);
    } else {
      el.videoTitle.textContent = pageInfo.title || pageInfo.url;
      showState("Ready");
    }
  }

  // 3. Load recent
  loadRecent();
}

// ---------------------------------------------------------------------------
// Poll for transcription completion
// ---------------------------------------------------------------------------

function pollTranscriptionStatus() {
  const interval = setInterval(async () => {
    const res = await sendMsg({ type: "GET_TRANSCRIPTION_STATUS" });
    if (!res?.success || !res.data) {
      clearInterval(interval);
      return;
    }
    const pending = res.data;
    if (pending.status === "done" && pending.result) {
      clearInterval(interval);
      stopProgress();
      const url = `${API_APP_BASE}/?id=${pending.result.id}`;
      showTranscribed(pending.result.title || pending.title, url);
      await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
      loadRecent();
    } else if (pending.status === "error") {
      clearInterval(interval);
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

  el.transcribingTitle.textContent = pageInfo.title || "Transcribing...";
  showState("Transcribing");
  startProgress();
  el.queuePrompt.hidden = true;

  const res = await sendMsg({
    type: "TRANSCRIBE",
    url: pageInfo.url,
    title: pageInfo.title,
  });

  stopProgress();

  if (res?.success && res.data?.id) {
    const url = `${API_APP_BASE}/?id=${res.data.id}`;
    showTranscribed(pageInfo.title || res.data.title, url);
    await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
    // Process next in queue
    processQueue();
    loadRecent();
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

el.btnView.addEventListener("click", () => {
  if (currentTranscriptUrl) openTranscript(currentTranscriptUrl);
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

chrome.tabs.onActivated?.addListener(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && tab.url !== currentTabUrl) {
      currentTabUrl = tab.url;
      init();
    }
  } catch { /* ignore */ }
});

chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
  if (changeInfo.url && changeInfo.url !== currentTabUrl) {
    currentTabUrl = changeInfo.url;
    init();
  }
});

// Start
init();
