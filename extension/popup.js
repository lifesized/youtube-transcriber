globalThis.TranscriberPanelDiagnostics?.mark("popup-script");
const HAS_EXTENSION_APIS =
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  typeof chrome.runtime.connect === "function";
const PRICING_URL = "https://www.transcribed.dev/pricing";

if (!HAS_EXTENSION_APIS) {
  window.addEventListener("DOMContentLoaded", () => {
    document.body.classList.add("preview-mode");

    const startupShell = document.getElementById("startupShell");
    if (startupShell) startupShell.hidden = true;

    const show = (id) => {
      const node = document.getElementById(id);
      if (node) node.hidden = false;
      return node;
    };
    const hide = (id) => {
      const node = document.getElementById(id);
      if (node) node.hidden = true;
      return node;
    };

    [
      "stateNoService",
      "stateNotYoutube",
      "stateTranscribing",
      "stateError",
      "settingsPanel",
    ].forEach(hide);

    show("stateReady");
    show("recentSection");

    const videoTitle = document.getElementById("videoTitle");
    if (videoTitle) videoTitle.textContent = "Preview: YouTube video detected";

    const label = document.getElementById("btnTranscribeLabel");
    if (label) label.textContent = "Transcribe & Summarize";

    const recentList = document.getElementById("recentList");
    if (recentList) {
      recentList.innerHTML = `
        <div class="recent-item">
          <div class="recent-main">
            <div class="recent-title">Example transcript</div>
            <div class="recent-meta">transcribed.dev · just now</div>
          </div>
        </div>
      `;
    }
  });
} else {
// Command channel for content-script CLOSE_PANEL requests (for example when a
// YouTube player enters fullscreen). This is not a panel-visibility signal;
// Chrome exclusively owns toolbar-icon open/close behavior.
let port = null;
let panelWindowId = null;
let pendingPanelLaunchId = null;
let pendingPanelLaunchExpiresAt = 0;
let currentPanelState = null;
const PANEL_LAUNCH_CONTEXT_TTL_MS = 120000;

function getPanelLaunchContext() {
  if (
    !pendingPanelLaunchId ||
    Date.now() >= pendingPanelLaunchExpiresAt
  ) {
    pendingPanelLaunchId = null;
    pendingPanelLaunchExpiresAt = 0;
    return undefined;
  }
  return { launchId: pendingPanelLaunchId };
}

function handlePanelPortMessage(msg) {
  if (msg.type === "CLOSE") {
    window.close();
  } else if (msg.type === "PANEL_LAUNCH") {
    pendingPanelLaunchId = msg.launchId;
    pendingPanelLaunchExpiresAt = Date.now() + PANEL_LAUNCH_CONTEXT_TTL_MS;
    const launchContext = { launchId: msg.launchId };
    globalThis.TranscriberPanelDiagnostics?.mark(
      "launch-signal",
      undefined,
      launchContext,
    );
    globalThis.TranscriberPanelDiagnostics?.afterNextPaint(
      "launch-frame-presented",
      launchContext,
    );
    if (currentPanelState) {
      globalThis.TranscriberPanelDiagnostics?.afterNextPaint(
        `state:${currentPanelState}-frame-presented`,
        launchContext,
      );
    }
  }
}

function connectPanelPort() {
  if (port) return;
  const nextPort = chrome.runtime.connect({ name: "sidepanel" });
  port = nextPort;
  nextPort.onMessage.addListener(handlePanelPortMessage);
  nextPort.onDisconnect.addListener(() => {
    if (port === nextPort) port = null;
  });
  const sendContext = (windowId) => {
    if (port !== nextPort || !Number.isInteger(windowId)) return;
    panelWindowId = windowId;
    nextPort.postMessage({ type: "PANEL_CONTEXT", windowId });
  };
  if (Number.isInteger(panelWindowId)) sendContext(panelWindowId);
  else chrome.windows.getCurrent().then((currentWindow) => {
    sendContext(currentWindow?.id);
  }).catch(() => {});
}

connectPanelPort();
// MV3 may suspend the worker and disconnect a retained panel. Re-handshake
// only when Chrome presents this document again; do not create a keep-alive
// reconnect loop while the panel is hidden.
window.addEventListener("focus", connectPanelPort);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") connectPanelPort();
});

// DOM refs
const el = {
  startupShell: document.getElementById("startupShell"),
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
  btnStartTranscriber: document.getElementById("btnStartTranscriber"),
  offlineStartWrap: document.getElementById("offlineStartWrap"),
  offlineCopyWrap: document.getElementById("offlineCopyWrap"),
  offlineStartError: document.getElementById("offlineStartError"),
  offlineHeading: document.getElementById("offlineHeading"),
  offlineSub: document.getElementById("offlineSub"),
  setupCommand: document.getElementById("setupCommand"),
  btnCopySetup: document.getElementById("btnCopySetup"),
  offlinePath: document.getElementById("offlinePath"),
  offlineLocalMsg: document.getElementById("offlineLocalMsg"),
  btnTranscribeLabel: document.getElementById("btnTranscribeLabel"),
  drivePrivacyNotice: document.getElementById("drivePrivacyNotice"),
  actionSection: document.getElementById("actionSection"),
  modeTranscribe: document.getElementById("modeTranscribe"),
  modeTranscribeSummarize: document.getElementById("modeTranscribeSummarize"),
  summaryDestinationRow: document.getElementById("summaryDestinationRow"),
  summarizeProviderRow: document.getElementById("summarizeProviderRow"),
  providerPickerTrigger: document.getElementById("providerPickerTrigger"),
  providerPickerIcon: document.getElementById("providerPickerIcon"),
  providerPickerName: document.getElementById("providerPickerName"),
  providerPickerMenu: document.getElementById("providerPickerMenu"),
  summaryExperienceV2: document.getElementById("summaryExperienceV2"),
  serverSection: document.getElementById("serverSection"),
  serverStatus: document.getElementById("serverStatus"),
  btnStartServer: document.getElementById("btnStartServer"),
  btnStopServer: document.getElementById("btnStopServer"),
  stopServerHint: document.getElementById("stopServerHint"),
  offlineCloudMsg: document.getElementById("offlineCloudMsg"),
  cloudOnboarding: document.getElementById("cloudOnboarding"),
  cloudAuthError: document.getElementById("cloudAuthError"),
  cloudAuthCard: document.getElementById("cloudAuthCard"),
  cloudAuthGoogle: document.getElementById("cloudAuthGoogle"),
  cloudAuthForm: document.getElementById("cloudAuthForm"),
  cloudAuthEmail: document.getElementById("cloudAuthEmail"),
  cloudAuthSubmit: document.getElementById("cloudAuthSubmit"),
  cloudAuthErrorMsg: document.getElementById("cloudAuthErrorMsg"),
  cloudAuthSent: document.getElementById("cloudAuthSent"),
  cloudAuthSentEmail: document.getElementById("cloudAuthSentEmail"),
  cloudAuthResend: document.getElementById("cloudAuthResend"),
  localDetectedBanner: document.getElementById("localDetectedBanner"),
  btnUseLocal: document.getElementById("btnUseLocal"),
  btnDismissBanner: document.getElementById("btnDismissBanner"),
  setupWallModal: document.getElementById("setupWallModal"),
  setupWallStay: document.getElementById("setupWallStay"),
  setupWallContinue: document.getElementById("setupWallContinue"),
  cloudNudge: document.getElementById("cloudNudge"),
  liveNotice: document.getElementById("liveNotice"),
  btnNavLibrary: document.getElementById("btnNavLibrary"),
  btnNavSettings: document.getElementById("btnNavSettings"),
  githubLink: document.getElementById("githubLink"),
  cloudLink: document.getElementById("cloudLink"),
  settingsPanel: document.getElementById("settingsPanel"),
  btnModeLocal: document.getElementById("btnModeLocal"),
  btnModeCloud: document.getElementById("btnModeCloud"),
  cloudAccountSection: document.getElementById("cloudAccountSection"),
  destinationsSection: document.getElementById("destinationsSection"),
  destinationsList: document.getElementById("destinationsList"),
  destinationsEmpty: document.getElementById("destinationsEmpty"),
  obsidianVaultRow: document.getElementById("obsidianVaultRow"),
  obsidianVaultInput: document.getElementById("obsidianVaultInput"),
  obsidianVaultSaved: document.getElementById("obsidianVaultSaved"),
  obsidianAdvUriRow: document.getElementById("obsidianAdvUriRow"),
  obsidianAdvUriInput: document.getElementById("obsidianAdvUriInput"),
  sourceIntegrityStatus: document.getElementById("sourceIntegrityStatus"),
  sourceIntegrityDetail: document.getElementById("sourceIntegrityDetail"),
  popupToast: document.getElementById("popupToast"),
};

const panelScriptReadyAt = performance.now();
function hideStartupShell() {
  if (!el.startupShell || el.startupShell.hidden) return;
  el.startupShell.hidden = true;
  globalThis.TranscriberPanelDiagnostics?.mark("shell-replaced");
  globalThis.TranscriberPanelDiagnostics?.afterNextPaint(
    "replacement-frame-presented",
  );
  console.info("[ytt-popup] startup shell replaced", {
    scriptReadyMs: Math.round(panelScriptReadyAt),
    uiReadyMs: Math.round(performance.now()),
  });
}

const SOURCE_INTEGRITY = globalThis.TranscriberSourceIntegrity;

let popupToastTimer = null;
function showPopupToast(message, kind = "info") {
  if (!el.popupToast || !message) return;
  if (popupToastTimer) clearTimeout(popupToastTimer);
  el.popupToast.textContent = message;
  el.popupToast.classList.toggle("error", kind === "error");
  el.popupToast.hidden = false;
  requestAnimationFrame(() => el.popupToast.classList.add("show"));
  popupToastTimer = setTimeout(() => {
    el.popupToast.classList.remove("show");
    setTimeout(() => { el.popupToast.hidden = true; }, 220);
  }, kind === "error" ? 4500 : 2600);
}

let pageInfo = null;
let activeRunContext = null;
let progressTimer = null;
let justCompletedId = null;
let pollInterval = null;
let isTranscribing = false;
let offlinePollTimer = null;
let heartbeatTimer = null;
// Mirrors `chrome.storage.sync.mode` — set in init() and on mode-toggle.
// Lets doTranscribe paint progress synchronously without awaiting GET_SETTINGS
// (the await caused a leftward bar sweep when the indeterminate prepaint
// transitioned back to 0%).
let currentMode = "cloud";
let userActionInProgress = false;
// Mutable label flag read by the progressTimer tick. Cloud mode flips this
// off so pollTranscriptionStatus owns label text without timer overwrites.
let progressWriteLabels = true;
// When true, direct TRANSCRIBE response owns completion/error handling.
let suppressPollFinalization = false;
let errorAction = "retry";

async function recordIntegrityEvent(kind, details = {}) {
  try {
    return await sendMsg({
      type: "RECORD_SOURCE_INTEGRITY_EVENT",
      event: { ts: new Date().toISOString(), kind, ...details },
    });
  } catch {
    return null;
  }
}

function expectedSourceForPending(pending) {
  const pendingSource = SOURCE_INTEGRITY.snapshotSource(pending || {});
  if (
    activeRunContext?.videoId &&
    pendingSource.videoId &&
    activeRunContext.videoId === pendingSource.videoId
  ) {
    return activeRunContext;
  }
  return pendingSource;
}

async function ensureSourceMatch(expected, actual, stage, provider = "") {
  const match = SOURCE_INTEGRITY.validateSourceMatch(expected, actual);
  if (match.ok) return true;
  await recordIntegrityEvent("stale_source_blocked", {
    stage,
    provider,
    expectedVideoId: expected?.videoId || "",
    actualVideoId: actual?.videoId || "",
    transcriptId: actual?.id || "",
    message: match.reason,
  });
  showPopupToast("Blocked a stale transcript before summarizing. Please retry.", "error");
  return false;
}

// YTT-259: primary button mode + chosen summarize provider. Persisted in
// chrome.storage.sync. Mirrored here so doTranscribe / button-label updates
// don't have to await an async read.
//   transcribe                — transcript only
//   transcribe-and-summarize  — chain summarize after transcribe
let transcribeMode = "transcribe-and-summarize";
let summarizeProvider = "claude";
let summaryExperienceV2 = false;
let nativeSummariesAvailable = false;
let nativeSummaryCacheScope = null;
const nativeSummaryCache = new Map();
const NATIVE_SUMMARY_CACHE_PREFIX = "nativeSummary:";
const NATIVE_SUMMARY_CACHE_VERSION = "v1";
const SUMMARY_EXPERIENCE_DEFAULT_KEY = "summaryExperienceDefaultedAt";
const SUMMARY_EXPERIENCE_DEFAULT_VERSION = "2026-06-native-summary-default";
let expandedTranscriptId = null;
let lastRecentRenderHash = "";

function isTwitterStatusUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return (
      (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com") &&
      /^\/[^/]+\/status(?:es)?\/[0-9]+/.test(u.pathname)
    );
  } catch {
    return false;
  }
}

function isTwitterUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com";
  } catch {
    return false;
  }
}

function isLinkedInUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return host === "linkedin.com";
  } catch {
    return false;
  }
}

function isLinkedInFeedUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return host === "linkedin.com" && /^\/feed\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

function isSpotifyUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") === "open.spotify.com";
  } catch {
    return false;
  }
}

function isGoogleDriveUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.replace(/^www\./, "") === "drive.google.com" &&
      !!TranscriberUrlUtils.extractGoogleDriveFileId(url)
    );
  } catch {
    return false;
  }
}

function isGenericSpotifyTitle(title) {
  const cleaned = (title || "").trim();
  return (
    /^spotify\s*[-–]\s*web player$/i.test(cleaned) ||
    /^your library$/i.test(cleaned)
  );
}

function cleanPageTitleForUrl(title, url) {
  const cleaned = (title || "").trim();
  if (isSpotifyUrl(url) && isGenericSpotifyTitle(cleaned)) return "";
  return cleaned;
}

function pageInfoFromTab(tab, stored = {}) {
  const tabUrl = tab?.url || "";
  const storedUrl = stored.url || "";
  const isStoredLinkedIn = isLinkedInUrl(tabUrl) && stored.platform === "linkedin";
  const isStoredTwitter = isTwitterUrl(tabUrl) && stored.platform === "twitter";
  const isStoredSpotify = isSpotifyUrl(tabUrl) && stored.platform === "spotify" && !!stored.videoId;
  const url = isStoredLinkedIn || isStoredTwitter || isStoredSpotify ? storedUrl || tabUrl : tabUrl || storedUrl;
  const tabVideoId = extractVideoId(tabUrl || url);
  const isTwitter = isTwitterUrl(tabUrl || url);
  const isTwitterStatus = isTwitterStatusUrl(tabUrl || url);
  const tabIsTwitter = isTwitterUrl(tabUrl);
  const tabIsTwitterStatus = isTwitterStatusUrl(tabUrl);
  const linkedInStoredMatches =
    isStoredLinkedIn &&
    !!stored.videoId &&
    (stored.pageUrl === tabUrl ||
      isLinkedInFeedUrl(tabUrl) ||
      (!!tabVideoId && stored.videoId === tabVideoId));
  const twitterStoredMatches =
    isStoredTwitter &&
    !!stored.videoId &&
    (stored.pageUrl === tabUrl ||
      (!tabIsTwitterStatus && tabIsTwitter) ||
      (!!tabVideoId && stored.videoId === tabVideoId));
  const storedMatchesTab =
    (!!stored.url && stored.url === (tabUrl || url)) ||
    (!!stored.videoId && !!tabVideoId && stored.videoId === tabVideoId) ||
    isStoredSpotify ||
    linkedInStoredMatches ||
    twitterStoredMatches;
  const videoId =
    linkedInStoredMatches
      ? stored.videoId
      : isStoredLinkedIn
      ? null
      : twitterStoredMatches
      ? stored.videoId
      : isTwitter && (!isTwitterStatus || !storedMatchesTab)
      ? null
      : tabVideoId || stored.videoId;
  const storedTitle = cleanPageTitleForUrl(stored.title, storedUrl || tabUrl);
  const tabTitle = cleanPageTitleForUrl(tab?.title, tabUrl || storedUrl);
  return {
    url,
    pageUrl: storedMatchesTab ? stored.pageUrl || tabUrl || storedUrl : tabUrl || storedUrl,
    title: storedMatchesTab ? storedTitle || tabTitle : tabTitle,
    author: storedMatchesTab ? stored.author || "" : "",
    channelUrl: storedMatchesTab ? stored.channelUrl || "" : "",
    videoId,
    platform: isGoogleDriveUrl(url)
      ? "drive"
      : storedMatchesTab
        ? stored.platform || ""
        : "",
    isLive: storedMatchesTab ? !!stored.isLive : false,
  };
}

async function requestLivePageInfo(tab) {
  if (!tab?.id) return null;
  try {
    const info = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_INFO" });
    return info?.ok && info.url ? info : null;
  } catch {
    return null;
  }
}

async function probeActiveMediaPage(tab) {
  if (!tab?.id || !globalThis.TranscriberMediaPageDetector?.detect) return null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: globalThis.TranscriberMediaPageDetector.detect,
    });
    const info = results?.[0]?.result;
    return info?.ok && info.url && info.videoId ? info : null;
  } catch {
    // activeTab access can expire after navigation. The normal registered
    // content-script paths still handle the sites with permanent permission.
    return null;
  }
}

async function getFreshPageInfoForTab(tab) {
  if (!tab?.id) return {};
  let storedPageInfo = {};
  try {
    const stored = await chrome.storage.session.get(`tab_${tab.id}`);
    storedPageInfo = stored[`tab_${tab.id}`] || {};
  } catch { /* ignore */ }

  const tabVideoId = extractVideoId(tab.url || "");
  const shouldRefresh =
    !!tabVideoId ||
    (isSpotifyUrl(tab.url) &&
      !cleanPageTitleForUrl(storedPageInfo.title, storedPageInfo.url || tab.url));

  if (shouldRefresh) {
    const livePageInfo = await requestLivePageInfo(tab);
    if (
      livePageInfo?.title &&
      (!tabVideoId || livePageInfo.videoId === tabVideoId)
    ) {
      return livePageInfo;
    }
  }

  if (!storedPageInfo.videoId) {
    const detectedPageInfo = await probeActiveMediaPage(tab);
    if (detectedPageInfo) return detectedPageInfo;
  }

  return storedPageInfo;
}

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

// In cloud mode, real progress text arrives via polling, so the fake stage
// labels are suppressed (writeLabels=false) to avoid flicker between the
// two. The width curve still runs so the bar feels the same as local.
function startProgress({ writeLabels = true } = {}) {
  // Idempotent — clear any previous timer before starting a new one. Two
  // timers writing to bar.style.width with their own elapsed counters
  // makes the bar lurch backward; this guarantees only one is ever active.
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
  progressWriteLabels = writeLabels;
  const bar = document.getElementById("progressBar");
  bar.classList.remove("indeterminate");
  // Snap to 0% with no transition so a stale width (e.g. 100% from a prior
  // run) can't animate leftward when the new run starts.
  const prevTransition = bar.style.transition;
  bar.style.transition = "none";
  bar.style.width = "0%";
  // Force a reflow so the transition: none commit lands before we restore.
  void bar.offsetWidth;
  bar.style.transition = prevTransition;

  let stageIdx = 0;
  let elapsed = 0;

  el.progressText.textContent = progressWriteLabels
    ? PROGRESS_STAGES[0].label
    : "Transcription in progress...";

  progressTimer = setInterval(() => {
    elapsed += 1;
    const pct = Math.min(90, 5 + 85 * (1 - Math.exp(-elapsed / 40)));
    bar.style.width = `${pct.toFixed(1)}%`;

    while (
      stageIdx < PROGRESS_STAGES.length - 1 &&
      pct >= PROGRESS_STAGES[stageIdx + 1].at
    ) {
      stageIdx++;
      if (progressWriteLabels) {
        el.progressText.textContent = PROGRESS_STAGES[stageIdx].label;
      }
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

function showReportedProgress(pending) {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
  if (pending?.progressText) {
    el.progressText.textContent = pending.progressText;
  }
  if (Number.isFinite(pending?.progress)) {
    const progress = Math.max(0, Math.min(99, pending.progress));
    document.getElementById("progressBar").style.width = `${progress}%`;
  }
}

// ---------------------------------------------------------------------------
// LLM launcher — mirrors components/ui/llm-launcher.tsx from the web app.
// Hover-reveal sparkle button per recent row; opens a small dropdown to
// summarize the transcript with Claude or ChatGPT. The extension never
// renders transcript content — it only fetches, builds a prompt, and
// hands off to the provider surface.
// ---------------------------------------------------------------------------

const LLM_STORAGE_KEY = "llm-launcher-last-provider";
const LLM_DEFAULT_PROMPT =
  'Summarize the following transcript from "{title}". Focus on the main topics, key insights, and any actionable takeaways.';

const UI_ICONS = globalThis.TranscriberIcons || {};
const LLM_ICONS = {
  claude: UI_ICONS.claude || "",
  chatgpt: UI_ICONS.chatgpt || "",
};

const LLM_HANDOFF_PARAM = "yttx";

const LLM_PROVIDERS = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    // Primary path: content-script handoff once the optional host perm is
    // granted — injects prompt into the composer and auto-submits.
    handoffOrigins: ["https://chatgpt.com/*"],
    handoffUrl: "https://chatgpt.com/",
    // Never place transcripts in ChatGPT URL params. Long transcripts can
    // trigger HTTP 431 before the content script can recover.
    urlTemplate: null,
    clipboardFallback: true,
    openUrl: "https://chatgpt.com/",
    icon: LLM_ICONS.chatgpt,
  },
  {
    id: "claude",
    name: "Claude",
    handoffOrigins: ["https://claude.ai/*"],
    handoffUrl: "https://claude.ai/new",
    // Claude has no public URL-prefill param, so the fallback when the
    // user declines the host permission is clipboard + manual paste.
    urlTemplate: null,
    clipboardFallback: true,
    openUrl: "https://claude.ai/",
    icon: LLM_ICONS.claude,
  },
];

// Single shared prompt template, fetched once from /api/preferences.
let llmPromptTemplate = LLM_DEFAULT_PROMPT;
let llmPromptLoaded = false;
// Currently-open dropdown (at most one); close on outside click.
let llmOpenDropdown = null;

async function loadLlmPrompt() {
  if (llmPromptLoaded) return;
  llmPromptLoaded = true;
  const res = await sendMsg({ type: "GET_PREFERENCES" });
  if (res?.success && res.data?.summarizePrompt) {
    llmPromptTemplate = res.data.summarizePrompt;
  }
}

function buildLlmLauncher(transcriptId, videoTitle, videoId = "") {
  const wrapper = document.createElement("div");
  wrapper.className = "recent-summarize";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "recent-summarize-btn";
  btn.title = "Summarize with Claude or ChatGPT";
  btn.setAttribute("aria-label", "Summarize with Claude or ChatGPT");
  btn.innerHTML = UI_ICONS.llmSpark || "";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleLlmDropdown(
      wrapper,
      transcriptId,
      videoTitle,
      SOURCE_INTEGRITY.snapshotSource({ videoId, title: videoTitle })
    );
  });

  wrapper.appendChild(btn);
  return wrapper;
}

function buildNativeSummaryButton(wrap, transcriptId, videoTitle) {
  const wrapper = document.createElement("div");
  wrapper.className = "recent-summarize";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "recent-summarize-btn";
  btn.title = "Show summary in Transcriber";
  btn.setAttribute("aria-label", "Show summary in Transcriber");
  btn.innerHTML = UI_ICONS.nativeSummary || "";
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await summarizeInline(wrap, transcriptId, videoTitle);
  });

  wrapper.appendChild(btn);
  return wrapper;
}

function closeLlmDropdown() {
  if (llmOpenDropdown) {
    if (typeof llmOpenDropdown._cleanup === "function") {
      llmOpenDropdown._cleanup();
    }
    llmOpenDropdown.remove();
    llmOpenDropdown = null;
    document.removeEventListener("mousedown", onOutsideLlmClick, true);
  }
}

function onOutsideLlmClick(e) {
  if (llmOpenDropdown && !llmOpenDropdown.contains(e.target)) {
    // Click on the toggle button itself handles its own close.
    if (!(e.target.closest && e.target.closest(".recent-summarize-btn"))) {
      closeLlmDropdown();
    }
  }
}

async function toggleLlmDropdown(wrapper, transcriptId, videoTitle, expectedSource) {
  if (llmOpenDropdown && llmOpenDropdown.dataset.ownerWrapperId === wrapper.dataset.wrapperId) {
    closeLlmDropdown();
    return;
  }
  closeLlmDropdown();
  loadLlmPrompt();

  // Tag the wrapper so we can identify which row owns the open menu.
  if (!wrapper.dataset.wrapperId) {
    wrapper.dataset.wrapperId = String(Math.random()).slice(2);
  }

  const lastProvider =
    (await chrome.storage.local.get(LLM_STORAGE_KEY))[LLM_STORAGE_KEY] || null;

  const menu = document.createElement("div");
  menu.className = "recent-summarize-menu";
  menu.dataset.ownerWrapperId = wrapper.dataset.wrapperId;
  const sorted = lastProvider
    ? [
        ...LLM_PROVIDERS.filter((p) => p.id === lastProvider),
        ...LLM_PROVIDERS.filter((p) => p.id !== lastProvider),
      ]
    : LLM_PROVIDERS;

  const pasteKey = /mac/i.test(navigator.userAgent) ? "\u2318+V" : "Ctrl+V";
  // Resolve paste-hint visibility per provider: only show the paste tip when
  // the user will actually need to paste — i.e. the provider falls back to
  // the clipboard and the handoff host perm has not been granted. Once they
  // allow the host, the content script auto-pastes + submits.
  const handoffGranted = await Promise.all(
    sorted.map(async (p) => {
      if (!p.handoffOrigins) return false;
      try {
        return await chrome.permissions.contains({ origins: p.handoffOrigins });
      } catch {
        return false;
      }
    })
  );
  menu.innerHTML = `
    <div class="recent-summarize-menu-label">Summarize with</div>
    ${sorted
      .map(
        (p, idx) => `
      <button type="button" class="recent-summarize-menu-item" data-provider="${p.id}">
        ${p.icon}
        <span class="recent-summarize-menu-name">${escapeHtml(p.name)}</span>
        ${p.id === lastProvider ? '<span class="recent-summarize-menu-hint">last used</span>' : ""}
        ${
          p.clipboardFallback && !handoffGranted[idx]
            ? `<span class="recent-summarize-menu-tip"><span class="recent-summarize-menu-tip-key">${pasteKey}</span> to paste transcript</span>`
            : ""
        }
      </button>
    `
      )
      .join("")}
  `;
  menu.addEventListener("click", (e) => e.stopPropagation());
  menu.querySelectorAll("[data-provider]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const providerId = btn.getAttribute("data-provider");
      const provider = LLM_PROVIDERS.find((p) => p.id === providerId);
      closeLlmDropdown();
      launchWithProvider(provider, transcriptId, videoTitle, expectedSource);
    });
  });

  // Portal the menu to <body> with fixed positioning so it escapes the
  // recent-list scroll clip and sits above all sibling rows, matching the
  // web-app LlmLauncher (createPortal + getBoundingClientRect).
  document.body.appendChild(menu);
  llmOpenDropdown = menu;
  positionLlmDropdown(wrapper, menu);

  // Reposition on scroll/resize so the menu stays pinned to its button.
  const reposition = () => {
    if (llmOpenDropdown === menu) positionLlmDropdown(wrapper, menu);
  };
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);
  menu._cleanup = () => {
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
  };

  // Defer to next tick so the triggering click doesn't immediately close it
  setTimeout(() => {
    document.addEventListener("mousedown", onOutsideLlmClick, true);
  }, 0);
}

function positionLlmDropdown(wrapper, menu) {
  const btn = wrapper.querySelector(".recent-summarize-btn");
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  // Measure menu after it's in the DOM so we can align its bottom-right
  // to the button's top-right and keep it on-screen.
  const menuWidth = menu.offsetWidth || 180;
  const menuHeight = menu.offsetHeight || 100;
  const margin = 8;

  let left = rect.right - menuWidth;
  if (left < margin) left = margin;
  if (left + menuWidth > window.innerWidth - margin) {
    left = window.innerWidth - menuWidth - margin;
  }

  let top = rect.top - menuHeight - 6;
  // If it would clip the top of the viewport, fall back to below the button.
  if (top < margin) top = rect.bottom + 6;

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

function flattenSegments(segments) {
  return segments
    .map((s, idx) => {
      const prev = segments[idx - 1];
      const speakerChanged = s.speaker && (!prev || prev.speaker !== s.speaker);
      return speakerChanged ? `\n${s.speaker}: ${s.text}` : s.text;
    })
    .join(" ");
}

async function launchWithProvider(provider, transcriptId, videoTitle, expectedSource = null) {
  try {
    await chrome.storage.local.set({ [LLM_STORAGE_KEY]: provider.id });
  } catch {
    // storage failure — continue regardless
  }

  const res = await sendMsg({ type: "GET_TRANSCRIPT", id: transcriptId });
  if (!res?.success || !res.data?.transcript) {
    // No visible error surface in the list yet — log and bail. Future work:
    // inline toast (see YTT-205 §3 error state).
    console.warn("Summarize: failed to load transcript", res?.error);
    await recordIntegrityEvent("error", {
      stage: "handoff_fetch",
      provider: provider?.id || "",
      expectedVideoId: expectedSource?.videoId || "",
      transcriptId,
      message: res?.error || "Transcript unavailable",
    });
    showPopupToast("Couldn't load the transcript for summarizing.", "error");
    return;
  }

  if (
    expectedSource &&
    !(await ensureSourceMatch(expectedSource, res.data, "handoff_fetch", provider?.id || ""))
  ) {
    return;
  }

  let transcriptText;
  try {
    const segments = JSON.parse(res.data.transcript);
    transcriptText = flattenSegments(segments);
  } catch {
    console.warn("Summarize: transcript parse failed");
    await recordIntegrityEvent("error", {
      stage: "handoff_parse",
      provider: provider?.id || "",
      expectedVideoId: expectedSource?.videoId || "",
      actualVideoId: res.data.videoId || "",
      transcriptId,
      message: "Transcript JSON could not be parsed",
    });
    showPopupToast("Couldn't prepare this transcript for summarizing.", "error");
    return;
  }

  const authoritativeTitle = res.data.title || expectedSource?.title || videoTitle;
  const instruction = llmPromptTemplate.replace(/\{title\}/g, authoritativeTitle);
  const prompt = `${instruction}\n\nTranscript:\n\n${transcriptText}`;

  // Primary path for every provider: content-script handoff so the prompt
  // lands in the composer AND the send button fires automatically.
  if (provider.handoffOrigins && provider.handoffUrl) {
    const launched = await tryLlmHandoff(provider, prompt);
    if (launched) {
      await recordIntegrityEvent("handoff_launched", {
        stage: "external_handoff",
        provider: provider.id,
        expectedVideoId: expectedSource?.videoId || res.data.videoId || "",
        actualVideoId: res.data.videoId || "",
        transcriptId,
      });
      return;
    }
  }

  // Fallback 1: URL prefill template. Providers should avoid this for full
  // transcripts because browser/site request limits can reject long URLs.
  if (provider.urlTemplate) {
    const encoded = encodeURIComponent(prompt);
    const maxLen = 6000;
    const safe = encoded.length > maxLen ? encoded.slice(0, maxLen) : encoded;
    const url = provider.urlTemplate.replace("{prompt}", safe);
    await openNextToCurrentTab(url);
    await recordIntegrityEvent("handoff_launched", {
      stage: "url_handoff",
      provider: provider.id,
      expectedVideoId: expectedSource?.videoId || res.data.videoId || "",
      actualVideoId: res.data.videoId || "",
      transcriptId,
    });
    return;
  }

  // Fallback 2: clipboard + open provider homepage (Claude without host
  // perm). User pastes with ⌘V.
  try {
    await navigator.clipboard.writeText(prompt);
  } catch {
    // Clipboard blocked — still open the provider; user can re-summarize
    // from the web app transcript page if needed.
  }
  if (provider.openUrl) {
    await openNextToCurrentTab(provider.openUrl);
    await recordIntegrityEvent("handoff_launched", {
      stage: "clipboard_handoff",
      provider: provider.id,
      expectedVideoId: expectedSource?.videoId || res.data.videoId || "",
      actualVideoId: res.data.videoId || "",
      transcriptId,
    });
  }
}

// Open a new tab immediately to the right of the currently active tab,
// rather than appended at the end of the tab strip. The side panel isn't a
// tab, so tabs.query({active:true}) returns the underlying page the user
// clicked "summarize" from — that's the anchor we want the new tab next to.
async function openNextToCurrentTab(url) {
  try {
    const [current] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const opts = { url, active: true };
    if (current) {
      opts.index = current.index + 1;
      opts.openerTabId = current.id;
    }
    await chrome.tabs.create(opts);
  } catch {
    // Fallback if tabs.query fails for any reason — just open at the end.
    await chrome.tabs.create({ url, active: true });
  }
}

function isQuotaError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("quota") ||
    text.includes("monthly transcript limit") ||
    text.includes("limit reached") ||
    text.includes("upgrade your plan") ||
    text.includes("/pricing")
  );
}

function showErrorState(message) {
  const errorMessage = message || "Transcription failed";
  const upgradeRequired = isQuotaError(errorMessage);
  errorAction = upgradeRequired ? "upgrade" : "retry";
  el.errorMessage.textContent = errorMessage;
  el.btnRetry.textContent = upgradeRequired ? "Upgrade" : "Retry";
  el.btnRetry.classList.toggle("btn-upgrade", upgradeRequired);
  el.btnRetry.setAttribute(
    "aria-label",
    upgradeRequired ? "Upgrade plan" : "Retry transcription"
  );
  showState("Error");
}

async function handleErrorAction() {
  if (errorAction === "upgrade") {
    await openNextToCurrentTab(PRICING_URL);
    return;
  }
  doTranscribe();
}

// Neither Claude nor ChatGPT expose a public URL path that both fills the
// composer AND auto-submits. Content-script injection is the only way to
// match that expectation, so we ask for the optional host permission on
// first use and register a content script that injects + sends. Returns
// true if the handoff launched successfully (prompt stashed + tab opened),
// false if we should fall back to url-template / clipboard paths.
async function tryLlmHandoff(provider, prompt) {
  const perm = { origins: provider.handoffOrigins };
  let granted = false;
  try {
    granted = await chrome.permissions.contains(perm);
  } catch {
    granted = false;
  }
  if (!granted) {
    try {
      granted = await chrome.permissions.request(perm);
    } catch {
      granted = false;
    }
  }
  if (!granted) return false;

  const stash = await sendMsg({ type: "STASH_LLM_PROMPT", prompt });
  const token = stash?.success ? stash.data?.token : null;
  if (!token) return false;

  const url = `${provider.handoffUrl}?${LLM_HANDOFF_PARAM}=${encodeURIComponent(token)}`;
  try {
    await openNextToCurrentTab(url);
  } catch {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Destinations (YTT-205 §2) — cloud-hosted adapter registry per YTT-211.
// Extension surfaces: settings list (connect/disconnect) and a per-row
// ⋯ menu (send-to connected destinations). The extension does zero adapter
// work — cloud handles OAuth + token storage + the send() call.
// ---------------------------------------------------------------------------

// Cached destination list so the ⋯ menu can render without hitting the
// network on every open. Refreshed when the settings panel loads and after
// OAuth completes.
let destinationsCache = null;
let destinationsLoading = false;

// Persisted cache for destinations list. Survives popup close so the next
// open renders instantly from cache (stale-while-revalidate). Network call
// still fires in the background to catch any state changes; the rendered
// list is replaced if the fresh result differs.
const DESTINATIONS_CACHE_KEY = "destinationsCacheV1";
const DESTINATIONS_CACHE_TTL_MS = 5 * 60 * 1000;

async function readPersistedDestinations(currentMode) {
  try {
    const stored = await chrome.storage.local.get(DESTINATIONS_CACHE_KEY);
    const cached = stored[DESTINATIONS_CACHE_KEY];
    if (!cached || !cached.timestamp || !cached.payload) return null;
    if (Date.now() - cached.timestamp > DESTINATIONS_CACHE_TTL_MS) return null;
    // Mode-tagged cache: ignore stale-mode entries so a local→cloud switch
    // doesn't briefly paint the local-mode list (Obsidian only) before the
    // network fetch returns the full cloud list. Skeleton stays visible
    // through the fetch instead.
    if (currentMode && cached.mode && cached.mode !== currentMode) return null;
    return cached.payload;
  } catch {
    return null;
  }
}

async function writePersistedDestinations(payload, mode) {
  try {
    await chrome.storage.local.set({
      [DESTINATIONS_CACHE_KEY]: { timestamp: Date.now(), mode, payload },
    });
  } catch {
    // Storage write failure is non-fatal — cache miss next time, that's all.
  }
}

async function clearPersistedDestinations() {
  try {
    await chrome.storage.local.remove(DESTINATIONS_CACHE_KEY);
  } catch {}
}

// Listen for OAuth return broadcasts from destination-connected.html so the settings
// list reflects a fresh connection without waiting for the polling fallback.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "OAUTH_RETURN") return;
  destinationsCache = null;
  clearPersistedDestinations();
  if (el.settingsPanel && !el.settingsPanel.hidden) {
    renderDestinationsSettings();
  }
});

// YTT-268: re-check destination tier-locks when the extension regains focus.
// The side panel keeps its JS context across tab switches, so a tier
// upgrade completed on transcribed.dev in another tab leaves
// destinationsCache stale — Notion stays "locked" until popup reload.
// Refetch on focus covers the upgrade-and-return flow without polling.
// Throttled because some platforms fire `focus` on every minor activation.
//
// YTT-293: refetch in both branches (Settings open *and* Recent list). The
// transcribe-and-summarize flow opens a new tab and returns, firing
// visibilitychange twice. If we only refetch when Settings is open, the
// kebab menu on the Recent list reads a null cache and renders the empty
// "Connect a destination" state despite working connections.
let lastDestinationsRefocus = 0;
function onExtensionFocus() {
  if (document.visibilityState === "hidden") return;
  const now = Date.now();
  if (now - lastDestinationsRefocus < 2000) return;
  lastDestinationsRefocus = now;
  destinationsCache = null;
  if (el.settingsPanel && !el.settingsPanel.hidden) {
    renderDestinationsSettings();
  } else {
    fetchDestinations();
  }
}
window.addEventListener("focus", onExtensionFocus);
document.addEventListener("visibilitychange", onExtensionFocus);

// Bundled icons — cloud returns relative paths like "/icons/notion.svg" that
// 404 from chrome-extension:// origin, so we override by adapterId.
const LOCAL_DESTINATION_ICONS = {
  "notion": "icons/notion.svg",
  "obsidian-scheme": "icons/obsidian.svg",
};

// Setup-help docs URL — dedicated destination guide for Notion + Obsidian.
const CONNECTOR_SETUP_HELP_URL =
  "https://www.transcribed.dev/docs/destinations";

// Client-side adapters — available in any mode, no cloud account required.
// Obsidian's "connected" state is derived from whether the user has saved
// a vault name, not from any server call.
const CLIENT_SIDE_ADAPTERS = [
  { adapterId: "obsidian-scheme", name: "Obsidian", icon: "", clientSide: true, setupHelpUrl: CONNECTOR_SETUP_HELP_URL },
];

// Cloud-only teasers — shown when the user is in cloud mode but the
// destinations fetch failed (signed out, offline, 5xx). Renders with a
// "Sign in" CTA instead of Connect. Hidden entirely in self-hosted mode
// since these adapters can't work without the cloud backend.
const CLOUD_TEASER_ADAPTERS = [
  { adapterId: "notion", name: "Notion", icon: "", cloudOnly: true, setupHelpUrl: CONNECTOR_SETUP_HELP_URL },
];

const CLOUD_CONNECTOR_GATE = {
  adapterId: "cloud-connectors",
  name: "Notion",
  icon: "",
  cloudGate: true,
};

async function fetchDestinations() {
  if (destinationsLoading) return destinationsCache;
  destinationsLoading = true;
  try {
    // Storage reads are independent of each other — fire in parallel so the
    // network call below isn't waiting on serialized awaits.
    const [{ obsidianVaultName }, settingsRes] = await Promise.all([
      chrome.storage.sync.get("obsidianVaultName"),
      sendMsg({ type: "GET_SETTINGS" }),
    ]);
    const clientSide = CLIENT_SIDE_ADAPTERS.map((d) => {
      if (d.adapterId === "obsidian-scheme") {
        return { ...d, connected: !!(obsidianVaultName || "").trim() };
      }
      return { ...d, connected: false };
    });

    const mode = settingsRes?.data?.mode || "cloud";

    let cloudAdapters;
    let cloudReady = false;
    let cloudReason = null; // "local" | "authError" | "unavailable" | "unknown"
    if (mode === "cloud") {
      const res = await sendMsg({ type: "LIST_DESTINATIONS" });
      if (res?.success && res.data?.ok) {
        // Drop Obsidian if the cloud list includes it — the client-side
        // entry is authoritative.
        cloudAdapters = (res.data.destinations || []).filter(
          (d) => d.adapterId !== "obsidian-scheme"
        );
        cloudReady = true;
      } else {
        // Classify so the teaser can show an accurate reason.
        if (res?.data?.authError) cloudReason = "authError";
        else if (res?.data?.unavailable) cloudReason = "unavailable";
        else cloudReason = "unknown";
        // Signed-out users should not see half-active cloud OAuth rows. Gate
        // them behind a single cloud sign-in CTA so Notion auth cannot race
        // against cloud account auth (YTT-323).
        cloudAdapters = cloudReason === "authError" ? [] : CLOUD_TEASER_ADAPTERS;
      }
    } else {
      // Self-hosted mode — hide cloud-only adapters entirely. They can't
      // work without the cloud backend, so a teaser would just be noise.
      cloudReason = "local";
      cloudAdapters = [];
    }

    destinationsCache = {
      ok: true,
      cloudReady,
      cloudReason,
      destinations: [...cloudAdapters, ...clientSide],
    };
    // Persist for instant render on next popup open. Only cache cloud-ready
    // results — teasers (auth error, unavailable) shouldn't be sticky since
    // they reflect transient state.
    if (cloudReady || mode !== "cloud") {
      writePersistedDestinations(destinationsCache, mode);
    }
    return destinationsCache;
  } finally {
    destinationsLoading = false;
  }
}

function connectedDestinations() {
  // Exclude needsReauth — sending would hit expired tokens and 401 upstream.
  // Users reconnect via Settings, where the row still renders with Reconnect.
  return (destinationsCache?.destinations || []).filter(
    (d) => d.connected && !d.needsReauth
  );
}

function setupDestinations() {
  const setup = (destinationsCache?.destinations || []).filter(
    (d) => !d.connected || d.needsReauth
  );
  if (destinationsCache?.cloudReason === "authError") {
    setup.unshift(CLOUD_CONNECTOR_GATE);
  }
  return setup;
}

function renderDestinationsSkeleton(rows = 2) {
  el.destinationsList.innerHTML = "";
  for (let i = 0; i < rows; i++) {
    const row = document.createElement("div");
    row.className = "destinations-row destinations-row-skeleton";
    row.innerHTML = `
      <div class="destinations-skeleton-icon"></div>
      <div class="destinations-row-text">
        <div class="destinations-skeleton-line destinations-skeleton-name"></div>
        <div class="destinations-skeleton-line destinations-skeleton-status"></div>
      </div>
      <div class="destinations-skeleton-toggle"></div>
    `;
    el.destinationsList.appendChild(row);
  }
}

// Cheap signature for change-detection so SWR doesn't thrash the DOM when
// the freshly fetched destinations list matches the cached paint.
function destinationsSignature(payload) {
  if (!payload || !Array.isArray(payload.destinations)) return "";
  const rows = payload.destinations
    .map(
      (d) =>
        `${d.adapterId}|${d.connected ? 1 : 0}|${d.needsReauth ? 1 : 0}`
    )
    .join(",");
  return `${payload.cloudReady ? 1 : 0}|${payload.cloudReason || ""}|${rows}`;
}

function paintDestinationsList(payload) {
  el.destinationsList.innerHTML = "";
  el.destinationsEmpty.hidden = true;
  const list = payload.destinations || [];
  if (!list.length) {
    el.destinationsEmpty.hidden = false;
    el.destinationsEmpty.textContent = "No destinations available.";
    return;
  }
  const ctx = {
    cloudReady: payload.cloudReady,
    cloudReason: payload.cloudReason,
  };
  for (const d of list) {
    el.destinationsList.appendChild(buildDestinationRow(d, ctx));
  }
  if (payload.cloudReason === "authError") {
    el.destinationsList.appendChild(buildCloudConnectorsGate());
  }
}

async function renderDestinationsSettings() {
  // Destinations always visible — Obsidian works in any mode (client-side
  // URL scheme), and cloud-only adapters render as "Sign in" teasers when
  // not reachable. The only state where the section is empty is if we
  // somehow have zero adapters total, which shouldn't happen.
  el.destinationsSection.hidden = false;
  el.destinationsEmpty.hidden = true;

  // Paint skeleton synchronously when there's no in-memory cache. The
  // persisted-cache read below is async (chrome.storage roundtrip) — without
  // this sync paint, the section header is visible for one microtask + the
  // storage read with an empty list underneath. Particularly noticeable after
  // a mode switch (cache cleared) or when the persisted TTL has expired.
  if (!destinationsCache && !el.settingsPanel.dataset.skipSkeleton) {
    renderDestinationsSkeleton();
  }

  // Stale-while-revalidate: paint cached destinations from the previous popup
  // session so the user sees real rows immediately. Network refresh happens
  // below; rows are replaced only if the fresh result differs.
  const cached = destinationsCache || (await readPersistedDestinations(currentMode));
  if (cached && cached.destinations?.length) {
    paintDestinationsList(cached);
  }
  // else: skeleton already showing from the sync paint above.

  const res = await fetchDestinations();

  // Re-paint only if the fresh result differs from what we already painted
  // from cache. Avoids DOM thrash on the common "nothing changed" case.
  const sameAsCached =
    cached &&
    cached.destinations?.length &&
    destinationsSignature(cached) === destinationsSignature(res);
  if (!sameAsCached) {
    paintDestinationsList(res);
  }

  // Obsidian inputs always visible since Obsidian is always in the list.
  el.obsidianVaultRow.hidden = false;
  el.obsidianAdvUriRow.hidden = false;
  const { obsidianVaultName, obsidianUseAdvancedUri } =
    await chrome.storage.sync.get(["obsidianVaultName", "obsidianUseAdvancedUri"]);
  el.obsidianVaultInput.value = obsidianVaultName || "";
  el.obsidianAdvUriInput.checked = !!obsidianUseAdvancedUri;
}

function buildDestinationRow(d, ctx) {
  // Back-compat: older callers passed a boolean cloudReady directly.
  const cloudReady = typeof ctx === "object" ? !!ctx.cloudReady : !!ctx;
  const cloudReason = (typeof ctx === "object" && ctx.cloudReason) || null;

  const frag = document.createDocumentFragment();
  const row = document.createElement("div");
  row.className = "destinations-row";
  if (d.locked) row.classList.add("destinations-row-locked");

  const icon = document.createElement("span");
  icon.className = "destinations-row-icon";
  const localIcon = LOCAL_DESTINATION_ICONS[d.adapterId];
  const iconSrc = localIcon || (typeof d.icon === "string" ? d.icon : "");
  if (iconSrc) {
    const img = document.createElement("img");
    img.src = iconSrc;
    img.alt = "";
    icon.appendChild(img);
  }

  const text = document.createElement("div");
  text.className = "destinations-row-text";
  const name = document.createElement("span");
  name.className = "destinations-row-name";
  name.textContent = d.name || d.adapterId;
  if (d.locked && d.requiresTier) {
    const pill = document.createElement("span");
    pill.className = "destinations-row-pill";
    // requiresTier is "pro" | "power" — title-case for display.
    pill.textContent =
      d.requiresTier.charAt(0).toUpperCase() + d.requiresTier.slice(1);
    name.appendChild(document.createTextNode(" "));
    name.appendChild(pill);
  }
  const status = document.createElement("span");
  status.className = "destinations-row-status";
  text.appendChild(name);
  text.appendChild(status);

  let actionEl;

  if (d.locked) {
    // Tier-gated adapter (YTT-268). Skip the Connect/OAuth flow entirely
    // and surface an Upgrade link instead. Server also enforces — this
    // is just the UX layer.
    status.textContent = "Available on " +
      (d.requiresTier
        ? d.requiresTier.charAt(0).toUpperCase() + d.requiresTier.slice(1)
        : "paid plans");
    actionEl = document.createElement("a");
    actionEl.href = d.upgradeUrl
      ? `https://www.transcribed.dev${d.upgradeUrl}`
      : "https://www.transcribed.dev/pricing";
    actionEl.target = "_blank";
    actionEl.rel = "noopener noreferrer";
    actionEl.className = "destinations-row-action destinations-row-upgrade";
    actionEl.textContent = "Upgrade";
  } else if (d.clientSide) {
    // Client-side adapter (Obsidian). "Connected" = local config saved.
    // Connect focuses the vault-name input below; Disconnect clears it.
    if (d.connected) {
      actionEl = makeDestinationToggle(true, async () => {
        if (d.adapterId === "obsidian-scheme") {
          await chrome.storage.sync.remove("obsidianVaultName");
          el.obsidianVaultInput.value = "";
          destinationsCache = null;
          renderDestinationsSettings();
        }
      });
    } else {
      actionEl = makeDestinationToggle(false, async () => {
        const { obsidianVaultName } = await chrome.storage.sync.get(
          "obsidianVaultName"
        );
        if ((obsidianVaultName || "").trim()) {
          destinationsCache = null;
          renderDestinationsSettings();
          return;
        }
        el.obsidianVaultInput.focus();
        el.obsidianVaultInput.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    }
  } else if (d.cloudOnly && !cloudReady) {
    // Cloud adapter, but the destinations fetch didn't succeed. Surface the
    // actual reason so the user knows what to do next — the common case is
    // "signed out", but it can also be offline / cloud 500.
    actionEl = document.createElement("a");
    actionEl.href = "https://www.transcribed.dev/auth/login";
    actionEl.target = "_blank";
    actionEl.className = "destinations-row-action";
    actionEl.textContent = "Sign in";
  } else {
    // Cloud adapter, cloud is reachable. Standard Connect/Disconnect flow.
    if (d.connected && d.needsReauth) {
      status.classList.add("needs-reauth");
      status.textContent = "Reconnect needed";
      actionEl = makeDestinationToggle(false, () =>
        handleConnect(d.adapterId, actionEl)
      );
    } else if (d.connected) {
      actionEl = makeDestinationToggle(true, () =>
        handleDisconnect(d.adapterId, actionEl)
      );
    } else {
      actionEl = makeDestinationToggle(false, () =>
        handleConnect(d.adapterId, actionEl)
      );
    }
  }

  row.appendChild(icon);
  row.appendChild(text);
  row.appendChild(actionEl);
  frag.appendChild(row);

  return frag;
}

function buildCloudConnectorsGate() {
  const row = document.createElement("div");
  row.className = "destinations-row destinations-cloud-gate";

  const icon = document.createElement("span");
  icon.className = "destinations-row-icon";

  const text = document.createElement("div");
  text.className = "destinations-row-text";
  const name = document.createElement("span");
  name.className = "destinations-row-name";
  name.textContent = "Notion";
  const status = document.createElement("span");
  status.className = "destinations-row-status";
  text.appendChild(name);
  text.appendChild(status);

  const action = document.createElement("button");
  action.type = "button";
  action.className = "destinations-row-action";
  action.textContent = "Sign in";
  action.addEventListener("click", signInForCloudConnectors);

  row.appendChild(icon);
  row.appendChild(text);
  row.appendChild(action);
  return row;
}

async function signInForCloudConnectors() {
  const res = await sendMsg({ type: "OPEN_GOOGLE_SIGNIN" });
  if (res?.success) {
    showPopupToast("Sign in opened. Connectors will refresh when you return.", "info");
  } else {
    showPopupToast(res?.error || "Couldn't open sign in", "error");
  }
}

// Mirrors the Toggle component in components/settings-panel.tsx — same shape,
// transitions, and aria-checked semantics so the connector switch matches the
// toggles used elsewhere in the local-hosted settings (OpenRouter, etc.).
function makeDestinationToggle(checked, onChange) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("role", "switch");
  btn.setAttribute("aria-checked", checked ? "true" : "false");
  btn.className = "destinations-toggle" + (checked ? " is-on" : "");
  const thumb = document.createElement("span");
  thumb.className = "destinations-toggle-thumb";
  btn.appendChild(thumb);
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    onChange(!checked);
  });
  return btn;
}

async function handleConnect(adapterId, btn) {
  btn.disabled = true;
  const res = await sendMsg({ type: "START_DESTINATION_OAUTH", adapterId });
  btn.disabled = false;
  if (!res?.success || !res.data?.ok) {
    const err = res?.data?.error || res?.error || "Couldn't start connection";
    console.warn("Connect failed:", err);
    destinationsCache = null;
    renderDestinationsSettings();
    return;
  }
  // Poll for connection flip — user completes OAuth in the opened tab.
  pollForConnection(adapterId);
}

async function handleDisconnect(adapterId, btn) {
  btn.disabled = true;
  const res = await sendMsg({ type: "DISCONNECT_DESTINATION", adapterId });
  btn.disabled = false;
  if (!res?.success || !res.data?.ok) {
    console.warn("Disconnect failed");
  }
  destinationsCache = null;
  renderDestinationsSettings();
}

async function pollForConnection(adapterId) {
  const start = Date.now();
  const deadline = start + 2 * 60 * 1000; // 2 min
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    destinationsCache = null;
    const res = await fetchDestinations();
    const match = (res.destinations || []).find((d) => d.adapterId === adapterId);
    if (match?.connected && !match.needsReauth) {
      renderDestinationsSettings();
      return;
    }
    // If the settings panel is no longer visible, stop polling — user left.
    if (el.settingsPanel.hidden) return;
  }
  // Timed out silently; next settings-panel open will refetch.
}

// ---------------------------------------------------------------------------
// Per-row ⋯ menu on recent transcripts (YTT-205 §3). Items:
//   - Send to <connected destination>  (one per connected adapter)
//   - ——
//   - Open in web app
//   - Copy link
// Mirrors the portal-to-body / fixed-position pattern of .recent-summarize.
// ---------------------------------------------------------------------------

let rowActionsOpen = null;

function closeRowActionsMenu() {
  if (rowActionsOpen) {
    if (typeof rowActionsOpen._cleanup === "function") rowActionsOpen._cleanup();
    if (rowActionsOpen._wrapper) rowActionsOpen._wrapper.classList.remove("open");
    rowActionsOpen.remove();
    rowActionsOpen = null;
    document.removeEventListener("mousedown", onOutsideRowActionsClick, true);
  }
}

function onOutsideRowActionsClick(e) {
  if (rowActionsOpen && !rowActionsOpen.contains(e.target)) {
    if (!(e.target.closest && e.target.closest(".row-actions-btn"))) {
      closeRowActionsMenu();
    }
  }
}

function buildRowActionsMenu(transcriptId, videoTitle) {
  const wrapper = document.createElement("div");
  wrapper.className = "row-actions";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "row-actions-btn";
  btn.title = "More actions";
  btn.setAttribute("aria-label", "More actions");
  btn.innerHTML = UI_ICONS.more || "";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleRowActionsMenu(wrapper, transcriptId, videoTitle);
  });
  wrapper.appendChild(btn);
  return wrapper;
}

function buildProcessingClearButton(transcriptId, title) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "recent-clear-processing";
  btn.title = "Clear processing item";
  btn.setAttribute("aria-label", "Clear processing item");
  btn.innerHTML = `
    <span class="recent-clear-processing-label">Clear</span>
  `;
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.disabled = true;
    btn.closest(".recent-item-wrap")?.classList.add("recent-item-clearing");
    const res = await sendMsg({ type: "DELETE_TRANSCRIPT", id: transcriptId });
    if (res?.success) {
      showPopupToast(`Cleared ${title || "processing item"}`, "info");
      await reconcileAfterProcessingClear();
      return;
    }
    btn.disabled = false;
    btn.closest(".recent-item-wrap")?.classList.remove("recent-item-clearing");
    showPopupToast(res?.error || "Couldn't clear item", "error");
  });
  return btn;
}

async function reconcileAfterProcessingClear() {
  isTranscribing = false;
  suppressPollFinalization = false;
  stopPolling();
  stopProgress();
  await init();
}

async function toggleRowActionsMenu(wrapper, transcriptId, videoTitle) {
  if (rowActionsOpen && rowActionsOpen._wrapper === wrapper) {
    closeRowActionsMenu();
    return;
  }
  closeRowActionsMenu();

  // YTT-293: if cache is empty (e.g. nulled by onExtensionFocus before the
  // user navigated to Settings), wait for fetch so the menu paints with
  // real destinations on first open. When cache is hot we fire-and-forget
  // a refresh so the next open reflects any mid-session connection changes.
  if (!destinationsCache) {
    await fetchDestinations();
  } else {
    fetchDestinations();
  }

  const menu = document.createElement("div");
  menu.className = "row-actions-menu";

  const connected = connectedDestinations();
  const setup = setupDestinations();

  if (connected.length > 0) {
    for (const d of connected) {
      menu.appendChild(
        buildRowActionItem(d.name || d.adapterId, iconFor(d), async (item) => {
          item.setAttribute("data-sending", "true");
          item.disabled = true;
          const destName = d.name || d.adapterId;
          const res = await sendMsg({
            type: "SEND_TO_DESTINATION",
            adapterId: d.adapterId,
            transcriptId,
            destinationName: destName,
          });
          const payload = res?.data?.data || {};
          const ok = res?.success && res.data?.ok;
          // Obsidian: popup writes clipboard (service worker can't) and
          // opens the scheme URL. Background returned the payload without
          // doing either. See buildObsidianSend.
          if (d.adapterId === "obsidian-scheme" && ok && payload.schemeUrl) {
            if (payload.clipboardText) {
              try {
                await navigator.clipboard.writeText(payload.clipboardText);
              } catch {
                // Clipboard blocked — user will see an empty note but the
                // toast already told them to paste. No hard failure.
              }
            }
            try {
              chrome.tabs.create({ url: payload.schemeUrl, active: true });
            } catch {
              // tabs.create fails silently in some extension contexts.
            }
          }
          // Notion (and other OAuth adapters) return the created page URL.
          // Open it so the user sees the result and Notion desktop gets
          // focus via its URL handler if installed.
          if (d.adapterId === "notion" && ok && payload.url) {
            try {
              chrome.tabs.create({ url: payload.url, active: true });
            } catch {
              // Open failure is non-fatal — the page still exists in Notion.
            }
          }
          closeRowActionsMenu();
          if (ok) {
            showPopupToast(`Sent to ${destName}`, "info");
          } else {
            const errData = res?.data || {};
            // YTT-268: defense-in-depth path — server refused because the
            // user is on a tier below the adapter's requiresTier (rare:
            // mid-session downgrade or stale destinations cache). Open
            // pricing in a new tab so the upgrade is one click away, and
            // explain what happened in the toast.
            if (errData.upgradeRequired) {
              const tier = errData.requiresTier
                ? errData.requiresTier.charAt(0).toUpperCase() +
                  errData.requiresTier.slice(1)
                : "a paid plan";
              const url = errData.upgradeUrl
                ? `https://www.transcribed.dev${errData.upgradeUrl}`
                : "https://www.transcribed.dev/pricing";
              try {
                chrome.tabs.create({ url, active: true });
              } catch {
                // tabs.create may be denied in some contexts — toast still
                // tells the user what to do.
              }
              showPopupToast(
                `${destName} requires ${tier} — opened pricing`,
                "error"
              );
            } else {
              const errMsg =
                errData.error ||
                res?.error ||
                `Couldn't send to ${destName}`;
              showPopupToast(errMsg, "error");
            }
          }
        })
      );
    }
    menu.appendChild(separator());
  }

  if (setup.length > 0) {
    for (const d of setup) {
      menu.appendChild(
        buildRowActionItem(setupLabelForDestination(d), iconFor(d), async (item) => {
          item.disabled = true;
          await openDestinationSetup(d, item);
        })
      );
    }
    menu.appendChild(separator());
  }

  menu.appendChild(
    buildRowActionItem("Download as markdown", downloadIcon(), async () => {
      closeRowActionsMenu();
      await downloadTranscriptMarkdown(transcriptId);
    })
  );

  menu.appendChild(
    buildRowActionItem("Copy transcript", copyIcon(), async (item) => {
      const ok = await copyTranscriptText(transcriptId);
      if (ok) {
        item.querySelector(".row-actions-menu-name").textContent = "Copied!";
        setTimeout(() => closeRowActionsMenu(), 600);
      } else {
        closeRowActionsMenu();
      }
    })
  );

  menu.appendChild(
    buildRowActionItem("Open in web app", openIcon(), async () => {
      closeRowActionsMenu();
      await sendMsg({ type: "OPEN_TRANSCRIPT", id: transcriptId });
    })
  );

  menu.addEventListener("click", (e) => e.stopPropagation());
  document.body.appendChild(menu);
  wrapper.classList.add("open");
  rowActionsOpen = menu;
  rowActionsOpen._wrapper = wrapper;
  positionRowActionsMenu(wrapper, menu);

  const reposition = () => {
    if (rowActionsOpen === menu) positionRowActionsMenu(wrapper, menu);
  };
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);
  menu._cleanup = () => {
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
  };

  setTimeout(() => {
    document.addEventListener("mousedown", onOutsideRowActionsClick, true);
  }, 0);
}

function setupLabelForDestination(d) {
  const name = d.name || d.adapterId;
  if (d.cloudGate) return "Sign in for Notion";
  if (d.locked) return `Upgrade for ${name}`;
  if (d.needsReauth) return `Reconnect ${name}`;
  if (d.adapterId === "obsidian-scheme") return `Set up ${name}`;
  return `Connect ${name}`;
}

async function openDestinationSetup(d, item) {
  const adapterId = d.adapterId;
  const name = d.name || adapterId;

  if (d.cloudGate) {
    closeRowActionsMenu();
    await signInForCloudConnectors();
    return;
  }

  if (d.locked) {
    const url = d.upgradeUrl
      ? `https://www.transcribed.dev${d.upgradeUrl}`
      : "https://www.transcribed.dev/pricing";
    closeRowActionsMenu();
    try {
      await openNextToCurrentTab(url);
    } catch {
      // Non-fatal — user can still reach pricing from Settings.
    }
    return;
  }

  if (adapterId === "obsidian-scheme") {
    closeRowActionsMenu();
    showSettingsView();
    setTimeout(() => {
      el.obsidianVaultInput?.scrollIntoView({ behavior: "smooth", block: "center" });
      el.obsidianVaultInput?.focus();
    }, 200);
    showPopupToast("Add your Obsidian vault name to enable sending", "info");
    return;
  }

  if (destinationsCache?.cloudReady && !d.clientSide) {
    item.setAttribute("data-sending", "true");
    const res = await sendMsg({ type: "START_DESTINATION_OAUTH", adapterId });
    closeRowActionsMenu();
    if (res?.success && res.data?.ok) {
      pollForConnection(adapterId);
      showPopupToast(`Connecting ${name}...`, "info");
    } else {
      const err = res?.data?.error || res?.error || `Couldn't connect ${name}`;
      showPopupToast(err, "error");
      showSettingsView();
    }
    return;
  }

  closeRowActionsMenu();
  showSettingsView();
  showPopupToast(`Open Connectors to set up ${name}`, "info");
}

function buildRowActionItem(label, iconHtml, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "row-actions-menu-item";
  btn.innerHTML = `
    <span class="row-actions-menu-icon">${iconHtml || ""}</span>
    <span class="row-actions-menu-name"></span>
  `;
  btn.querySelector(".row-actions-menu-name").textContent = label;
  btn.addEventListener("click", () => onClick(btn));
  return btn;
}

function separator() {
  const s = document.createElement("div");
  s.className = "row-actions-menu-separator";
  return s;
}

function positionRowActionsMenu(wrapper, menu) {
  const btn = wrapper.querySelector(".row-actions-btn");
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 200;
  const menuHeight = menu.offsetHeight || 100;
  const margin = 8;

  let left = rect.right - menuWidth;
  if (left < margin) left = margin;
  if (left + menuWidth > window.innerWidth - margin) {
    left = window.innerWidth - menuWidth - margin;
  }

  let top = rect.bottom + 6;
  if (top + menuHeight > window.innerHeight - margin) {
    top = rect.top - menuHeight - 6;
  }

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

function timestampFromMs(ms) {
  const totalSeconds = Math.floor((ms || 0) / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${String(h).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
}

async function copyTranscriptText(transcriptId) {
  const res = await sendMsg({ type: "GET_TRANSCRIPT", id: transcriptId });
  if (!res?.success || !res.data?.transcript) return false;
  let segments;
  try {
    segments = JSON.parse(res.data.transcript);
  } catch {
    return false;
  }
  const text = segments
    .map((seg, idx) => {
      const prev = segments[idx - 1];
      const speakerChanged = seg.speaker && (!prev || prev.speaker !== seg.speaker);
      const prefix = speakerChanged ? `[${seg.speaker}] ` : "";
      return `[${timestampFromMs(seg.startMs)}] ${prefix}${seg.text}`;
    })
    .join("\n");
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function downloadTranscriptMarkdown(transcriptId) {
  const cfgRes = await sendMsg({ type: "GET_SETTINGS" });
  const mode = cfgRes?.data?.mode || "cloud";
  const base = mode === "cloud"
    ? "https://www.transcribed.dev"
    : "http://localhost:19720";
  // The download route sets Content-Disposition: attachment, so a plain
  // anchor click triggers a file save rather than navigating the popup.
  const a = document.createElement("a");
  a.href = `${base}/api/transcripts/${encodeURIComponent(transcriptId)}/download`;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function iconFor(d) {
  const localIcon = LOCAL_DESTINATION_ICONS[d.adapterId];
  const iconSrc = localIcon || (typeof d.icon === "string" ? d.icon : "");
  if (iconSrc) {
    return `<img src="${escapeAttr(iconSrc)}" alt="" />`;
  }
  // Default destination icon — generic send/arrow glyph.
  return `
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor"
         stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 10l14-6-6 14-2-6-6-2z"/>
    </svg>
  `;
}

function openIcon() {
  return `
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor"
         stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M11 3h6v6M17 3l-8 8M8 4H5a2 2 0 00-2 2v9a2 2 0 002 2h9a2 2 0 002-2v-3"/>
    </svg>
  `;
}

function downloadIcon() {
  return `
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor"
         stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 3v10m0 0l-3.5-3.5M10 13l3.5-3.5"/>
      <path d="M3 15v1a1 1 0 001 1h12a1 1 0 001-1v-1"/>
    </svg>
  `;
}

function copyIcon() {
  return `
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor"
         stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <rect x="7" y="7" width="10" height="10" rx="2"/>
      <path d="M13 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2"/>
    </svg>
  `;
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendMsg(msg) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    chrome.runtime.sendMessage(msg, (response) => {
      globalThis.TranscriberPanelDiagnostics?.mark(`message:${msg.type}`, Date.now() - startedAt);
      if (chrome.runtime.lastError) {
        const error = chrome.runtime.lastError.message || "runtime_send_failed";
        console.debug("[ytt-popup] sendMessage failed", {
          type: msg?.type,
          error,
          elapsedMs: Date.now() - startedAt,
        });
        resolve({ success: false, error });
        return;
      }
      if (response === undefined) {
        console.debug("[ytt-popup] sendMessage returned undefined", {
          type: msg?.type,
          elapsedMs: Date.now() - startedAt,
        });
        resolve({ success: false, error: "No response from background script" });
        return;
      }
      resolve(response);
    });
  });
}

const ALL_STATES = [
  "NoService",
  "NotYoutube",
  "Ready",
  "Transcribing",
  "Error",
];

function isSettingsOpen() {
  return !el.settingsPanel.hidden;
}

function showState(name) {
  // Settings view is exclusive — don't let a stale init() / async flow
  // resurface library panels on top of it.
  if (isSettingsOpen()) return;
  for (const s of ALL_STATES) {
    const elem = el[`state${s}`];
    if (elem) elem.hidden = s !== name;
  }
  // Hide recent list only when offline / signed out — there's nothing to
  // show without auth. The NotYoutube state (user on YouTube but not on a
  // watch page, e.g. homepage / search / channel grid) keeps the Recent
  // list visible so users can still jump back to their library.
  if (name === "NoService") {
    el.recentSection.hidden = true;
  }
  currentPanelState = name;
  const launchContext = getPanelLaunchContext();
  globalThis.TranscriberPanelDiagnostics?.mark(
    `state:${name}-dom-updated`,
    undefined,
    launchContext,
  );
  globalThis.TranscriberPanelDiagnostics?.afterNextPaint(
    `state:${name}-frame-presented`,
    launchContext,
  );
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
  refreshOfflineStartUI();
}

// ---------------------------------------------------------------------------
// Native messaging host — one-click "Start Transcriber" button.
// The host (com.transcribed.host) is a small node script installed via
// `npm run install-native-host`. If it isn't installed, the popup falls
// back to the npm-run-dev copy/paste box.
// ---------------------------------------------------------------------------

const NATIVE_HOST = "com.transcribed.host";
let nativeHostAvailable = null; // null = unknown, true/false after first probe
let nativeStartInFlight = false;

function callNativeHost(cmd, payload = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (e) {
      reject(new Error("native_host_unavailable"));
      return;
    }

    const timer = setTimeout(() => {
      try { port.disconnect(); } catch {}
      reject(new Error("native_host_timeout"));
    }, timeoutMs);

    port.onMessage.addListener((msg) => {
      clearTimeout(timer);
      try { port.disconnect(); } catch {}
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

async function detectNativeHost() {
  try {
    await callNativeHost("ping", {}, 2500);
    nativeHostAvailable = true;
  } catch {
    nativeHostAvailable = false;
  }
  return nativeHostAvailable;
}

function refreshOfflineStartUI() {
  const haveHost = nativeHostAvailable === true;
  el.offlineHeading.textContent = "Local server is not running";
  el.offlineStartWrap.hidden = !haveHost;
  el.offlineCopyWrap.hidden = haveHost;
  if (haveHost) {
    el.offlineSub.textContent = "Start the local app from here, then the panel will reconnect.";
  } else {
    el.offlineSub.textContent = "Start Transcriber in Terminal, then check again.";
    el.setupCommand.textContent = "npm run dev";
    el.setupCommand.dataset.fullCmd = "npm run dev";
  }
}

async function ensureNativeHostDetected() {
  if (nativeHostAvailable !== null) return nativeHostAvailable;
  await detectNativeHost();
  refreshOfflineStartUI();
  return nativeHostAvailable;
}

async function startTranscriberClicked() {
  if (nativeStartInFlight) return;
  nativeStartInFlight = true;
  el.btnStartTranscriber.disabled = true;
  el.offlineStartError.hidden = true;
  el.btnStartTranscriber.querySelector(".start-spinner").hidden = false;
  el.btnStartTranscriber.querySelector(".start-label").textContent = "Starting…";

  try {
    const res = await callNativeHost("start", {}, 30000);
    if (res?.ok) {
      // Server is up — let init() pick up the change.
      stopOfflinePolling();
      init();
    } else if (res?.reason === "port_conflict") {
      el.offlineStartError.textContent =
        `Port ${res.port || 19720} is already in use by another app. ` +
        `Close it (or change the port) and try again.`;
      el.offlineStartError.hidden = false;
    } else if (res?.reason === "already_running") {
      stopOfflinePolling();
      init();
    } else {
      el.offlineStartError.textContent =
        res?.error || "Couldn't start the server. Check ~/Library/Logs/Transcriber/native-host.log";
      el.offlineStartError.hidden = false;
    }
  } catch (e) {
    if (e.message === "native_host_unavailable" ||
        /Specified native messaging host not found/i.test(e.message)) {
      nativeHostAvailable = false;
      refreshOfflineStartUI();
    } else {
      el.offlineStartError.textContent = `Start failed: ${e.message}`;
      el.offlineStartError.hidden = false;
    }
  } finally {
    nativeStartInFlight = false;
    el.btnStartTranscriber.disabled = false;
    el.btnStartTranscriber.querySelector(".start-spinner").hidden = true;
    el.btnStartTranscriber.querySelector(".start-label").textContent = "Start Transcriber";
  }
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

function formatRecentMeta(item) {
  return [item.author?.trim(), formatDate(item.createdAt)].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// Open transcript in app — reuse existing app tab
// ---------------------------------------------------------------------------

async function openTranscript(id, options = {}) {
  if (options.syncCurrentPage && pageInfo?.url && id === existingTranscriptId) {
    await sendMsg({
      type: "SYNC_TRANSCRIPT_METADATA",
      id,
      url: pageInfo.url,
      pageUrl: pageInfo.pageUrl,
      title: pageInfo.title,
      author: pageInfo.author,
      channelUrl: pageInfo.channelUrl,
    }).catch(() => null);
  }
  await sendMsg({ type: "OPEN_TRANSCRIPT", id });
}

// ---------------------------------------------------------------------------
// Inline transcript drawer — matches the web app's list-item accordion. Click
// a row to expand the transcript below it; click again to collapse. ⋯ menu
// still has "Open in web app" for the full-page view.
// ---------------------------------------------------------------------------

async function toggleInlineTranscript(wrap, transcriptId) {
  const expanded = wrap.classList.toggle("expanded");
  if (!expanded) {
    if (expandedTranscriptId === transcriptId) expandedTranscriptId = null;
    return;
  }
  expandedTranscriptId = transcriptId;
  const panel = wrap.querySelector(".recent-transcript-inner");
  if (panel.dataset.loaded === "1") return;
  panel.innerHTML = '<div class="recent-transcript-loading"><div class="transcript-spinner" aria-label="Loading"></div></div>';
  const res = await sendMsg({ type: "GET_TRANSCRIPT", id: transcriptId });
  if (!res?.success || !res.data?.transcript) {
    panel.innerHTML =
      '<div class="recent-transcript-error">Couldn\'t load transcript.</div>';
    return;
  }
  let segments;
  try {
    segments = JSON.parse(res.data.transcript);
  } catch {
    panel.innerHTML =
      '<div class="recent-transcript-error">Invalid transcript format.</div>';
    return;
  }
  await hydrateNativeSummary(transcriptId);
  panel.innerHTML =
    renderNativeSummaryForTranscript(transcriptId) +
    renderTranscriptBlocks(segments);
  panel.dataset.loaded = "1";
}

function nativeSummaryCacheKey(transcriptId) {
  if (!nativeSummaryCacheScope) return null;
  return `${NATIVE_SUMMARY_CACHE_PREFIX}${NATIVE_SUMMARY_CACHE_VERSION}:${nativeSummaryCacheScope}:${transcriptId}`;
}

function readSummaryExperienceDefault(sync = {}) {
  if (sync[SUMMARY_EXPERIENCE_DEFAULT_KEY]) {
    return sync.summaryExperienceV2 !== false;
  }
  return true;
}

async function persistSummaryExperienceDefault(sync = {}) {
  if (sync[SUMMARY_EXPERIENCE_DEFAULT_KEY]) return;
  try {
    await chrome.storage.sync.set({
      summaryExperienceV2: true,
      [SUMMARY_EXPERIENCE_DEFAULT_KEY]: SUMMARY_EXPERIENCE_DEFAULT_VERSION,
    });
  } catch {
    // Non-fatal: the in-memory default still applies for this popup session.
  }
}

async function hydrateNativeSummary(transcriptId) {
  if (!summaryExperienceV2 || currentMode !== "cloud") return null;
  const key = nativeSummaryCacheKey(transcriptId);
  if (!key) return null;
  if (nativeSummaryCache.has(key)) return nativeSummaryCache.get(key);
  try {
    const stored = await chrome.storage.local.get(key);
    const entry = stored?.[key];
    if (entry?.summary_md && entry.cacheVersion === NATIVE_SUMMARY_CACHE_VERSION) {
      nativeSummaryCache.set(key, entry);
      return entry;
    }
  } catch {
    // Non-fatal: transcript rendering should not depend on local summary cache.
  }
  return null;
}

async function persistNativeSummary(transcriptId, summary) {
  if (!summary?.summary_md) return;
  const key = nativeSummaryCacheKey(transcriptId);
  if (!key) return;
  nativeSummaryCache.set(key, summary);
  try {
    await chrome.storage.local.set({
      [key]: {
        summary_md: summary.summary_md,
        model: summary.model || null,
        cached: !!summary.cached,
        prompt_hash: summary.prompt_hash || null,
        cacheVersion: NATIVE_SUMMARY_CACHE_VERSION,
        savedAt: Date.now(),
      },
    });
  } catch {
    // Rendering already has the in-memory copy; storage persistence is best-effort.
  }
}

function renderNativeSummaryForTranscript(transcriptId) {
  if (!summaryExperienceV2 || currentMode !== "cloud") return "";
  const key = nativeSummaryCacheKey(transcriptId);
  if (!key) return "";
  const entry = nativeSummaryCache.get(key);
  if (!entry?.summary_md) return "";
  const meta = entry.cached ? "Cached summary" : "Summary";
  return `
    <div class="native-summary-card">
      <div class="native-summary-kicker">${meta}</div>
      <div class="native-summary-body">${renderSummaryMarkdown(entry.summary_md)}</div>
    </div>
  `;
}

function renderSummaryMarkdown(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      html.push(`<h4>${formatSummaryInline(heading[2])}</h4>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${formatSummaryInline(bullet[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${formatSummaryInline(line)}</p>`);
  }
  closeList();
  return html.join("");
}

function formatSummaryInline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

async function summarizeInline(wrap, transcriptId, videoTitle) {
  const panel = wrap.querySelector(".recent-transcript-inner");
  wrap.classList.add("expanded");
  if (panel) {
    panel.dataset.loaded = "";
    panel.innerHTML = '<div class="recent-transcript-loading"><div class="transcript-spinner" aria-label="Summarizing"></div></div>';
  }
  const res = await sendMsg({ type: "SUMMARIZE_TRANSCRIPT", id: transcriptId });
  if (!res?.success || !res.data?.summary_md) {
    const message = res?.error || "Couldn't summarize transcript.";
    if (panel) {
      panel.innerHTML = `<div class="recent-transcript-error">${escapeHtml(message)}</div>`;
    }
    showPopupToast(message, "error");
    return null;
  }
  await persistNativeSummary(transcriptId, res.data);
  if (panel) {
    panel.dataset.loaded = "";
    wrap.classList.remove("expanded");
    await toggleInlineTranscript(wrap, transcriptId);
  }
  showPopupToast(videoTitle ? `Summarized ${videoTitle}` : "Summary ready");
  return res.data;
}

function mergeSegmentsForDisplay(segments) {
  // Group consecutive segments into paragraph blocks. Breaks on: speaker
  // change, >20s time gap, or 8-segment cap so untimed captions still split.
  const PARAGRAPH_MAX = 8;
  const GAP_MS = 20000;
  const out = [];
  let buf = null;
  for (const s of segments) {
    const startMs = typeof s.startMs === "number" ? s.startMs : 0;
    const speaker = s.speaker || null;
    const text = (s.text || "").trim();
    if (!text) continue;
    const speakerChanged = buf && speaker !== buf.speaker;
    const gapBroke = buf && startMs - buf.endMs > GAP_MS;
    if (!buf || speakerChanged || gapBroke || buf.count >= PARAGRAPH_MAX) {
      if (buf) out.push(buf);
      buf = { startMs, endMs: startMs, speaker, text, count: 1 };
    } else {
      buf.text += " " + text;
      buf.endMs = startMs;
      buf.count += 1;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function renderTranscriptBlocks(segments) {
  const blocks = mergeSegmentsForDisplay(segments);
  if (blocks.length === 0) {
    return '<div class="recent-transcript-error">No transcript text.</div>';
  }
  return blocks
    .map((b, i) => {
      const prev = blocks[i - 1];
      const showSpeaker = b.speaker && (!prev || prev.speaker !== b.speaker);
      return `
        <div class="transcript-block">
          ${showSpeaker ? `<div class="transcript-speaker">${escapeHtml(b.speaker)}</div>` : ""}
          <div class="transcript-line">
            <span class="transcript-time">${timestampFromMs(b.startMs)}</span>
            <span class="transcript-text">${escapeHtml(b.text)}</span>
          </div>
        </div>
      `;
    })
    .join("");
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
// Cloud auth cache
//
// Cache the last known cloud auth result so we don't gate first paint on a
// network round-trip. A returning user opens the panel → we render the list
// optimistically while CHECK_SERVICE runs in the background, only swapping
// to the sign-in card on a confirmed 401.
//
// TTL is short (5 min) so a real signout (cookies cleared in the web app)
// stops being optimistic quickly. Confirmed 401 also clears the cache.
// ---------------------------------------------------------------------------

const AUTH_CACHE_KEY = "authCache_cloud";
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000;

async function getCachedAuth() {
  try {
    const obj = await chrome.storage.local.get(AUTH_CACHE_KEY);
    return obj?.[AUTH_CACHE_KEY] || null;
  } catch {
    return null;
  }
}

async function setCachedAuth(ok) {
  try {
    await chrome.storage.local.set({
      [AUTH_CACHE_KEY]: { ok: !!ok, ts: Date.now() },
    });
  } catch { /* ignore */ }
}

function isAuthCacheFresh(cache) {
  if (!cache || !cache.ok) return false;
  return Date.now() - cache.ts < AUTH_CACHE_TTL_MS;
}

// ---------------------------------------------------------------------------
// Recent transcripts (SWR)
//
// Cache last fetched list per mode in chrome.storage.local so the panel
// paints instantly on reopen instead of waiting on a network round-trip.
// On open: render cached list immediately, then fetch fresh; only re-render
// if the fresh result actually differs.
// ---------------------------------------------------------------------------

const RECENT_CACHE_KEY = (mode) => `recentCache_${mode}`;

async function getCachedRecent(mode) {
  try {
    const key = RECENT_CACHE_KEY(mode);
    const obj = await chrome.storage.local.get(key);
    const cached = obj?.[key];
    if (!cached || !Array.isArray(cached.items)) return null;
    return cached.items;
  } catch {
    return null;
  }
}

async function setCachedRecent(mode, items) {
  try {
    await chrome.storage.local.set({
      [RECENT_CACHE_KEY(mode)]: { items, ts: Date.now() },
    });
  } catch { /* ignore */ }
}

async function maybeFindCachedTranscript(videoId, mode) {
  if (!videoId) return null;
  const cached = await getCachedRecent(mode);
  if (!cached) return null;
  // Only finished transcripts count — a "processing" record in the cache
  // would otherwise make the panel claim the video is "already transcribed"
  // when it's actually still in flight (or stuck).
  return (
    cached.find(
      (t) => t.videoId === videoId && (t.status === "done" || !t.status)
    ) || null
  );
}

function recentListHash(items) {
  if (!Array.isArray(items)) return "";
  return items.map((t) => `${t.id}:${t.status || ""}:${t.title}:${t.author || ""}:${t.createdAt}`).join("|");
}

function recentRenderHash(items) {
  return `${recentListHash(items)}:native=${nativeSummaryFlow.isEnabled()}`;
}

let recentLoadVersion = 0;
async function loadRecent(mode = currentMode) {
  const requestVersion = ++recentLoadVersion;
  const startupVersion = initVersion;
  const stale = () => requestVersion !== recentLoadVersion ||
    startupVersion !== initVersion || mode !== currentMode;
  // 1. Optimistic render. Cached list if we have one (instant + correct
  // shape); otherwise a skeleton so the panel never shows a dark void
  // while the first /api/transcripts fetch is in flight.
  const cached = await getCachedRecent(mode);
  if (stale()) return;
  if (!isSettingsOpen()) {
    if (cached && cached.length) {
      renderRecentList(cached);
      globalThis.TranscriberPanelDiagnostics?.mark(
        "recent-cache-rendered",
        undefined,
        getPanelLaunchContext(),
      );
      globalThis.TranscriberPanelDiagnostics?.afterNextPaint(
        "recent-cache-frame-presented",
        getPanelLaunchContext(),
      );
    } else {
      renderRecentSkeleton();
    }
  }

  // 2. Fetch fresh; reconcile.
  const res = await sendMsg({ type: "GET_RECENT", mode });
  globalThis.TranscriberPanelDiagnostics?.mark(
    "recent-response",
    undefined,
    getPanelLaunchContext(),
  );
  if (stale() || isSettingsOpen()) return;
  const refreshAction = globalThis.TranscriberStartupPolicy.recentRefreshAction(res);
  if (refreshAction === "preserve") {
    // A transient service-worker or network failure is not evidence that the
    // library is empty. Keep a usable cached list instead of flashing blank.
    if (!cached?.length) {
      el.recentSection.hidden = true;
      el.recentList.innerHTML = "";
    }
    return;
  }
  if (refreshAction === "clear") {
    // Only a successful empty response is allowed to clear the cache.
    await setCachedRecent(mode, []);
    el.recentSection.hidden = true;
    el.recentList.innerHTML = "";
    return;
  }
  // Skip DOM churn when nothing changed — cached render is already correct.
  if (lastRecentRenderHash === recentRenderHash(res.data) && !justCompletedId) {
    return;
  }
  renderRecentList(res.data);
  globalThis.TranscriberPanelDiagnostics?.mark("recent-fresh-rendered");
  globalThis.TranscriberPanelDiagnostics?.afterNextPaint(
    "recent-fresh-frame-presented",
    getPanelLaunchContext(),
  );
  await setCachedRecent(mode, res.data);
}

function renderRecentSkeleton(rows = 3) {
  el.recentSection.hidden = false;
  el.recentList.innerHTML = "";
  for (let i = 0; i < rows; i++) {
    const wrap = document.createElement("div");
    wrap.className = "recent-item-skeleton";
    wrap.innerHTML = `
      <div class="recent-skeleton-stack">
        <div class="recent-skeleton-line recent-skeleton-title"></div>
        <div class="recent-skeleton-line recent-skeleton-meta"></div>
      </div>
    `;
    el.recentList.appendChild(wrap);
  }
}

function renderRecentList(items) {
  el.recentSection.hidden = false;
  lastRecentRenderHash = recentRenderHash(items);
  el.recentList.innerHTML = "";
  for (const t of items) {
    const isNew = justCompletedId && t.id === justCompletedId;
    const isProcessing = t.status === "processing";

    const wrap = document.createElement("div");
    wrap.className = "recent-item-wrap";

    const item = document.createElement("a");
    item.className = `recent-item${isNew ? " recent-item-new" : ""}${isProcessing ? " recent-item-processing" : ""}`;
    item.href = "#";
    item.addEventListener("click", (e) => {
      // Ignore clicks that land on inline action buttons (LLM, ⋯ menu).
      if (
        e.target.closest(".recent-summarize") ||
        e.target.closest(".row-actions") ||
        e.target.closest(".recent-clear-processing")
      ) {
        return;
      }
      e.preventDefault();
      if (isProcessing) return;
      toggleInlineTranscript(wrap, t.id);
    });
    item.innerHTML = `
      <div class="recent-item-content">
        ${isNew ? '<span class="recent-tick">&#10003;</span>' : ""}
        <div class="recent-text">
          <span class="recent-title">${escapeHtml(t.title)}</span>
          <span class="recent-meta">${escapeHtml(formatRecentMeta(t))}</span>
        </div>
      </div>
      ${isNew ? `<svg class="recent-arrow" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 4l6 6-6 6"/>
      </svg>` : ""}
    `;
    if (isProcessing) {
      item.appendChild(buildProcessingClearButton(t.id, t.title));
    } else {
      if (nativeSummaryFlow.isEnabled()) {
        item.appendChild(buildNativeSummaryButton(wrap, t.id, t.title));
      }
      // External AI handoff remains available as the secondary summary path.
      item.appendChild(buildLlmLauncher(t.id, t.title, t.videoId));
      // ⋯ menu — send to destinations, download, copy, open in web app (YTT-205 §3)
      item.appendChild(buildRowActionsMenu(t.id, t.title));
    }

    const panel = document.createElement("div");
    panel.className = "recent-transcript";
    const panelInner = document.createElement("div");
    panelInner.className = "recent-transcript-inner";
    panel.appendChild(panelInner);

    wrap.appendChild(item);
    wrap.appendChild(panel);
    el.recentList.appendChild(wrap);

    if (t.id === expandedTranscriptId && !isNew) {
      toggleInlineTranscript(wrap, t.id);
    }

    // Two-phase animation: visual fade, then smooth spatial collapse
    if (isNew) {
      // Auto-expand the newly transcribed item so the user sees the result
      // immediately rather than having to click to reveal it.
      toggleInlineTranscript(wrap, t.id);
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
  // YouTube, Spotify, and Google Drive are host-checked from the tab URL.
  // Social prefixed IDs still belong to their content-script flow.
  const id = TranscriberUrlUtils.extractContentId(url);
  return id && (!id.includes(":") || id.startsWith("drive:")) ? id : null;
}

let existingTranscriptId = null;
let pageStateVersion = 0;

async function showCurrentPageState() {
  if (isTranscribing) return;
  existingTranscriptId = null;
  const version = ++pageStateVersion;

  // Bail if the user switched to Settings before or during this flow.
  if (isSettingsOpen()) return;

  if (!pageInfo?.videoId) {
    showState("NotYoutube");
    return;
  }

  el.videoTitle.textContent = pageInfo.title || pageInfo.url;
  updateTranscribeButtonLabel();

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
  if (version !== pageStateVersion || isTranscribing) return;
  if (isSettingsOpen()) return;

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
function initWasSuperseded(version) {
  return version !== initVersion || isTranscribing || userActionInProgress;
}

// True after the first init() has completed its CHECK_SERVICE round-trip.
// The cold-start retry below is only useful on the genuinely cold first
// hit; subsequent init() calls (nav clicks, post-OAuth re-runs) talk to a
// warm service worker and don't need the 400ms retry tax.
let coldStartHandled = false;

async function init() {
  globalThis.TranscriberPanelDiagnostics?.mark("init-start");
  const thisInit = ++initVersion;
  let serviceConfirmedOnline = false;

  // Close settings if open, mark library active
  el.settingsPanel.hidden = true;
  el.btnNavLibrary.classList.add("active");
  el.btnNavSettings.classList.remove("active");
  applyFooterLink();

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
  // isTranscribing can leak true if the panel was closed mid-transcribe —
  // popup's await never resolved, so the assignment after sendMsg never
  // ran. PHASE 3 below sets it back to true if the bg actually has a
  // pending transcription. Otherwise the doTranscribe guard would block
  // every future click in this panel session.
  isTranscribing = false;
  // Update the DOM before Chrome API work. Actual paint still depends on Chrome
  // activating and scheduling this document; it is not guaranteed by this call.
  renderRecentSkeleton();
  hideStartupShell();
  globalThis.TranscriberPanelDiagnostics?.mark("skeleton-dom-updated");
  globalThis.TranscriberPanelDiagnostics?.afterNextPaint(
    "skeleton-frame-presented",
  );

  // PHASE 1 — start reads together, but only settings determine the library
  // mode. Tab detection and auth-cache reads must not hold cached history back.
  const readsStartedAt = performance.now();
  const tabRead = chrome.tabs.query({ active: true, currentWindow: true })
    .catch(() => [])
    .finally(() => globalThis.TranscriberPanelDiagnostics?.mark("tabs-query-complete", performance.now() - readsStartedAt));
  const authRead = getCachedAuth()
    .catch(() => null)
    .finally(() => globalThis.TranscriberPanelDiagnostics?.mark("auth-cache-complete", performance.now() - readsStartedAt));
  let syncStash;
  try {
    syncStash = await chrome.storage.sync.get([
        "mode",
        "transcribeMode",
        "summarizeProvider",
        "summaryExperienceV2",
        SUMMARY_EXPERIENCE_DEFAULT_KEY,
      ]).finally(() => globalThis.TranscriberPanelDiagnostics?.mark("settings-read-complete", performance.now() - readsStartedAt));
  } catch {
    // Unknown mode is not permission to display another server's cached list.
    if (!initWasSuperseded(thisInit)) showErrorState("Couldn't read extension settings. Please retry.");
    return;
  }
  if (initWasSuperseded(thisInit)) return;

  const mode = syncStash?.mode || "cloud";
  currentMode = mode;
  // Cache hydration is independent of page detection, so start it as soon as
  // the mode is known. The network refresh runs behind the optimistic list.
  loadRecent(mode);
  const [tabResult, authCache] = await Promise.all([tabRead, authRead]);
  if (initWasSuperseded(thisInit)) return;
  globalThis.TranscriberPanelDiagnostics?.mark("startup-reads-complete");
  // Hydrate the YTT-259 transcribe-mode setting alongside `mode` so the
  // primary button label is correct on first paint.
  transcribeMode =
    syncStash?.transcribeMode === "transcribe" ? "transcribe" : "transcribe-and-summarize";
  summarizeProvider = syncStash?.summarizeProvider || "claude";
  summaryExperienceV2 = readSummaryExperienceDefault(syncStash);
  await persistSummaryExperienceDefault(syncStash);
  applyTranscribeActionUI();
  // Only treat the cache as a hard "they are signed in" signal — used to
  // broaden the cold-start retry below. We always paint optimistically
  // regardless, so the panel never shows a dark void while CHECK_SERVICE
  // is in flight.
  const cachedAuthOk = mode === "cloud" && isAuthCacheFresh(authCache);
  const tab = tabResult?.[0];
  if (tab) {
    const pageInfoRequest = getFreshPageInfoForTab(tab);
    const storedPageInfo = await globalThis.TranscriberStartupPolicy.withTimeout(
      pageInfoRequest,
      350,
      {},
      (latePageInfo) => {
        if (initWasSuperseded(thisInit)) return;
        const reconciledPageInfo = pageInfoFromTab(tab, latePageInfo);
        if (!reconciledPageInfo.videoId) return;
        pageInfo = reconciledPageInfo;
        currentTabUrl = tab.url;
        currentTabId = tab.id;
        updateTranscribeButtonLabel();
        // Phase 3 checks the global in-flight job regardless of page metadata;
        // it also makes initWasSuperseded() true while active. Once online,
        // this reruns the complete per-video existing-transcript check.
        if (serviceConfirmedOnline) showCurrentPageState();
      }
    );
    pageInfo = pageInfoFromTab(tab, storedPageInfo);
    currentTabUrl = tab.url;
    currentTabId = tab.id;
    updateTranscribeButtonLabel();
  }

  // PHASE 2 — optimistic paint. Always render a state on the first frame
  // — page-state shell + Recent list (cached or skeleton) — regardless of
  // whether we have a fresh authCache. Network checks below either confirm
  // (no-op) or correct it (swap to offline / sign-in UI on confirmed 401).
  // The brief flash for an actually-signed-out user is a much better trade
  // than a dark void on every cold open.
  let optimisticRendered = false;
  if (pageInfo?.videoId) {
    el.videoTitle.textContent = pageInfo.title || pageInfo.url;
    el.liveNotice.hidden = true;
    // Optimistically show the Transcribe button so the panel always has an
    // action visible. If the cached recent list already contains this
    // videoId we know it's been transcribed before — render the
    // "Already transcribed" link instead. showCurrentPageState() will
    // reconcile via CHECK_EXISTING if our cache is wrong.
    const cachedHit = await maybeFindCachedTranscript(pageInfo.videoId, mode);
    if (initWasSuperseded(thisInit)) return;
    if (cachedHit) {
      existingTranscriptId = cachedHit.id;
      el.btnTranscribe.hidden = true;
      el.btnAlreadyTranscribed.hidden = false;
    } else {
      el.btnTranscribe.hidden = false;
      el.btnAlreadyTranscribed.hidden = true;
    }
    showState("Ready");
  } else {
    showState("NotYoutube");
  }
  optimisticRendered = true;

  // PHASE 3 — in-flight transcription check. Done after optimistic paint so
  // a returning user doesn't see a dark screen during this round-trip
  // either. If a transcription is in flight we'll override the optimistic
  // state with the Transcribing UI.
  const statusRes = await sendMsg({ type: "GET_TRANSCRIPTION_STATUS" });
  if (initWasSuperseded(thisInit)) return;
  if (statusRes?.success && statusRes.data) {
    const pending = statusRes.data;
    if (pending.status === "transcribing") {
      isTranscribing = true;
      activeRunContext = expectedSourceForPending(pending);
      el.transcribingTitle.textContent = pending.title || "Transcribing...";
      showState("Transcribing");
      // Only restart animation/polling if not already running — prevents
      // glitchy restart when switching tabs during an active transcription
      if (!pollInterval) {
        startProgress({ writeLabels: false });
        if (pending.progressText) showReportedProgress(pending);
        pollTranscriptionStatus();
      }
      showQueuePrompt(pending.url);
      renderQueueList();
      if (!optimisticRendered) loadRecent();
      return;
    }
    if (pending.status === "done" && pending.result) {
      isTranscribing = false;
      stopProgress();
      stopPolling();
      const expectedSource = expectedSourceForPending(pending);
      if (!(await ensureSourceMatch(expectedSource, pending.result, "resume_completion"))) {
        activeRunContext = null;
        await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
        showErrorState("A stale source was blocked before summarizing. Retry this video.");
        return;
      }
      await recordIntegrityEvent("transcription_completed", {
        stage: "resume_completion",
        expectedVideoId: expectedSource.videoId,
        actualVideoId: pending.result.videoId || "",
        transcriptId: pending.result.id,
      });
      await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
      const summaryServiceRes = await sendMsg({ type: "CHECK_SERVICE" });
      if (initWasSuperseded(thisInit)) return;
      nativeSummaryCacheScope =
        summaryServiceRes?.data?.summaryCacheScope || null;
      nativeSummariesAvailable =
        !!summaryServiceRes?.data?.nativeSummariesAvailable;
      const nativeSummary = await maybeNativeSummarizeAfterTranscribe(
        pending.result.id,
        expectedSource.title || pending.title || "",
        expectedSource
      );
      if (!nativeSummary && transcribeMode !== "transcribe") {
        const provider = LLM_PROVIDERS.find((item) => item.id === summarizeProvider);
        if (provider) {
          launchWithProvider(
            provider,
            pending.result.id,
            expectedSource.title || pending.title || "",
            expectedSource
          );
        }
      }
      showCompletedAndReturn(pending.result.id);
      activeRunContext = null;
      return;
    }
    if (pending.status === "error") {
      await recordIntegrityEvent("error", {
        stage: "resume_transcription",
        expectedVideoId: pending.videoId || activeRunContext?.videoId || "",
        message: pending.error || "Transcription failed",
      });
      activeRunContext = null;
      await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
      if (isServerDownError(pending.error)) {
        // Trigger full init to get mode-aware offline messaging
        init();
        return;
      }
      showErrorState(pending.error);
      if (!optimisticRendered) loadRecent();
      return;
    }
  }

  // PHASE 4 — confirm via CHECK_SERVICE. If we already painted optimistically
  // and the service is up + authed, this is a no-op visually. If we got it
  // wrong, swap to the offline / sign-in UI.
  let serviceRes = await sendMsg({ type: "CHECK_SERVICE" });
  if (initWasSuperseded(thisInit)) return;
  let online = serviceRes?.success && serviceRes.data?.online;

  // Cold-start race: /api/account can 401 on a Supabase cookie warmup. Retry
  // once if either (a) this is the first init() of the session and the user
  // has signed in before, or (b) we just optimistically rendered as authed
  // (a known-good signal that the 401 is a race, not a real signout).
  if (!online && (cachedAuthOk || !coldStartHandled)) {
    let shouldRetry = cachedAuthOk;
    if (!shouldRetry) {
      const { hasEverSignedIn } = await chrome.storage.local.get("hasEverSignedIn");
      shouldRetry = !!hasEverSignedIn;
    }
    if (shouldRetry) {
      await new Promise((r) => setTimeout(r, 400));
      if (initWasSuperseded(thisInit)) return;
      serviceRes = await sendMsg({ type: "CHECK_SERVICE" });
      if (initWasSuperseded(thisInit)) return;
      online = serviceRes?.success && serviceRes.data?.online;
    }
  }
  coldStartHandled = true;

  if (!online) {
    const cfgMode = serviceRes?.data?.mode || mode;
    const authError = serviceRes?.data?.authError;

    if (cfgMode === "cloud") {
      // Confirmed signed-out — kill cached optimism so next open doesn't
      // flash the list before the sign-in card.
      if (authError) await setCachedAuth(false);
      el.offlineLocalMsg.hidden = true;
      el.offlineCloudMsg.hidden = false;
      el.cloudNudge.hidden = true;
      el.localDetectedBanner.hidden = true;

      const firstTime = !!serviceRes?.data?.firstTime;
      if (authError && !firstTime) {
        // Returning user whose session expired
        el.cloudOnboarding.hidden = true;
        el.cloudAuthError.hidden = false;
      } else {
        // First-time install OR service reachable but no auth — show onboarding
        el.cloudOnboarding.hidden = false;
        el.cloudAuthError.hidden = true;
      }
      // Reset the in-panel sign-in card so it's ready for the next attempt
      // (or keep the "check your email" confirmation visible if we just sent).
      if (!el.cloudAuthSent.hidden) {
        el.cloudAuthCard.hidden = true;
      } else {
        el.cloudAuthCard.hidden = false;
        el.cloudAuthErrorMsg.hidden = true;
      }

      // Auto-detect local instance and show banner — unless user dismissed it.
      // Dismissal is sticky (chrome.storage.sync.localBannerDismissed) so a
      // casual cloud user with an unrelated localhost server isn't repeatedly
      // nudged toward self-hosted.
      const { localBannerDismissed } = await chrome.storage.sync.get([
        "localBannerDismissed",
      ]);
      if (!localBannerDismissed) {
        const localRes = await sendMsg({ type: "DETECT_LOCAL" });
        if (initWasSuperseded(thisInit)) return;
        if (localRes?.success && localRes.data?.available) {
          el.localDetectedBanner.hidden = false;
        }
      }
    } else {
      el.offlineLocalMsg.hidden = false;
      el.offlineCloudMsg.hidden = true;
      el.cloudNudge.hidden = false;
      el.localDetectedBanner.hidden = true;
      loadCachedPath();
      // Detect (or re-detect on each offline render) whether the native host
      // is installed so the right primary action shows.
      await ensureNativeHostDetected();
      if (initWasSuperseded(thisInit)) return;
      // Auto-route to Settings → Server when the host is installed. Server
      // controls live there now; landing the user directly on the Start
      // button feels more "embedded in the product" than the takeover
      // offline screen. Polling continues from Settings.
      if (nativeHostAvailable) {
        startOfflinePolling();
        showSettingsView();
        return;
      }
    }

    showState("NoService");
    startOfflinePolling();
    return;
  }
  stopOfflinePolling();
  serviceConfirmedOnline = true;

  // Confirmed online. Refresh auth cache for cloud so next reopen paints
  // optimistically without the round-trip gating.
  if (mode === "cloud") setCachedAuth(true);
  nativeSummaryCacheScope = serviceRes?.data?.summaryCacheScope || null;
  const nextNativeSummariesAvailable =
    !!serviceRes?.data?.nativeSummariesAvailable;
  if (nextNativeSummariesAvailable !== nativeSummariesAvailable) {
    nativeSummariesAvailable = nextNativeSummariesAvailable;
    applyTranscribeActionUI();
    loadRecent();
  }

  startHeartbeat();

  // Warm the destinations cache so the ⋯ menu renders instantly.
  // Always — Obsidian is available in local mode too.
  fetchDestinations();
  if (initWasSuperseded(thisInit)) return;

  // Show page state (re-runs in case optimistic was stale, e.g. videoId
  // resolved to "Already transcribed" from CHECK_EXISTING).
  showCurrentPageState();

  // Load recent — skip if optimistic already kicked it off (SWR handles
  // revalidation on its own).
  if (!optimisticRendered) loadRecent();
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
    // Show real progress text from cloud polling or the local SSE bridge.
    if (pending.status === "transcribing" && pending.progressText) {
      showReportedProgress(pending);
    }
    if (pending.status === "done" && pending.result) {
      if (suppressPollFinalization) {
        stopPolling();
        return;
      }
      isTranscribing = false;
      stopPolling();
      stopProgress();
      const expectedSource = expectedSourceForPending(pending);
      if (!(await ensureSourceMatch(expectedSource, pending.result, "poll_completion"))) {
        activeRunContext = null;
        await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
        showErrorState("A stale source was blocked before summarizing. Retry this video.");
        return;
      }
      await recordIntegrityEvent("transcription_completed", {
        stage: "poll_completion",
        expectedVideoId: expectedSource.videoId,
        actualVideoId: pending.result.videoId || "",
        transcriptId: pending.result.id,
      });
      await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
      await nativeSummaryFlow.refreshAvailability();
      await maybeNativeSummarizeAfterTranscribe(
        pending.result.id,
        expectedSource.title || pending.title || "",
        expectedSource
      );
      showCompletedAndReturn(pending.result.id);
      activeRunContext = null;
    } else if (pending.status === "error") {
      if (suppressPollFinalization) {
        stopPolling();
        return;
      }
      isTranscribing = false;
      stopPolling();
      stopProgress();
      await recordIntegrityEvent("error", {
        stage: "poll_transcription",
        expectedVideoId: pending.videoId || activeRunContext?.videoId || "",
        message: pending.error || "Transcription failed",
      });
      activeRunContext = null;
      await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
      if (isServerDownError(pending.error)) {
        init();
      } else {
        showErrorState(pending.error);
      }
    }
  }, 2000);
}

// ---------------------------------------------------------------------------
// Transcribe
// ---------------------------------------------------------------------------

async function doTranscribe() {
  // Guard against double-click. The first click awaits GET_SETTINGS
  // before starting progress (~100-300ms on cold SW), during which the
  // panel looks frozen. A user-perceived "nothing happened" second click
  // would otherwise spin up a parallel doTranscribe, two startProgress
  // calls fight, and the bar visibly resets to 0% — that was the
  // "lurching" people saw.
  if (isTranscribing) {
    console.warn("[ytt-popup] doTranscribe ignored: already transcribing");
    return;
  }
  userActionInProgress = true;
  if (!pageInfo?.url) {
    console.warn("[ytt-popup] doTranscribe blocked: missing pageInfo.url", {
      pageInfo,
      currentTabUrl,
      currentTabId,
    });
    userActionInProgress = false;
    el.errorMessage.textContent = "No video detected. Refresh YouTube and try again.";
    showState("Error");
    return;
  }
  const runContext = SOURCE_INTEGRITY.snapshotSource(pageInfo);
  activeRunContext = runContext;
  void recordIntegrityEvent("run_started", {
    stage: "transcription",
    expectedVideoId: runContext.videoId,
  });

  console.log("[ytt-popup] doTranscribe start", {
    url: runContext.url,
    title: runContext.title,
    videoId: runContext.videoId || null,
  });

  isTranscribing = true;
  userActionInProgress = false;
  initVersion++;
  pageStateVersion++;
  el.transcribingTitle.textContent = runContext.title || "Transcribing...";
  showState("Transcribing");
  el.queuePrompt.hidden = true;

  // Synchronous forward-only progress. Read mode from the in-memory mirror
  // (kept in sync via init() + mode-toggle handlers) instead of awaiting
  // GET_SETTINGS — the prior await + indeterminate `width:100%` prepaint
  // caused the bar to animate leftward (~65% → 0%) when startProgress later
  // reset width to 0% under the CSS `transition: width 0.7s ease-out`.
  startProgress({ writeLabels: false });
  suppressPollFinalization = true;
  pollTranscriptionStatus();

  const res = await sendMsg({
    type: "TRANSCRIBE",
    url: runContext.url,
    title: runContext.title,
    author: runContext.author,
    channelUrl: runContext.channelUrl,
    videoId: runContext.videoId,
    pageUrl: runContext.pageUrl,
  });
  console.log("[ytt-popup] TRANSCRIBE response", res);

  if (res?.success && res.data?.status === "processing" && res.data?.id) {
    suppressPollFinalization = false;
    const isCloudProcessing = currentMode === "cloud";
    if (!pollInterval) {
      pollTranscriptionStatus();
    }
    if (isCloudProcessing) {
      el.progressText.textContent = res.data.progress || "Transcription in progress...";
    }
    await nativeSummaryFlow.refreshAvailability();
    return;
  }

  isTranscribing = false;
  userActionInProgress = false;
  suppressPollFinalization = false;
  stopPolling();
  stopProgress();

  if (res?.success && res.data?.id) {
    if (!(await ensureSourceMatch(runContext, res.data, "transcription_response"))) {
      activeRunContext = null;
      await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
      showErrorState("A stale source was blocked before summarizing. Retry this video.");
      return;
    }
    await recordIntegrityEvent("transcription_completed", {
      stage: "transcription",
      expectedVideoId: runContext.videoId,
      actualVideoId: res.data.videoId || "",
      transcriptId: res.data.id,
    });
    await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
    await nativeSummaryFlow.refreshAvailability();
    const useNativeSummary = nativeSummaryFlow.shouldAutoSummarize();
    // YTT-259: chain summarize when the user has set the button mode to
    // "transcribe-and-summarize".
    if (useNativeSummary) {
      await maybeNativeSummarizeAfterTranscribe(res.data.id, runContext.title, runContext);
    } else if (transcribeMode !== "transcribe") {
      const provider = LLM_PROVIDERS.find((p) => p.id === summarizeProvider);
      if (provider) {
        // Fire-and-forget: handoff opens a new tab; the popup can then
        // continue with its normal post-transcribe flow (showing the
        // completed item, processing queue).
        launchWithProvider(provider, res.data.id, runContext.title, runContext);
      } else {
        console.warn("[ytt-popup] summarize chain skipped: unknown provider", summarizeProvider);
      }
    }
    showCompletedAndReturn(res.data.id);
    activeRunContext = null;
    processQueue();
  } else {
    await recordIntegrityEvent("error", {
      stage: "transcription",
      expectedVideoId: runContext.videoId,
      message: res?.error || "Transcription failed",
    });
    activeRunContext = null;
    await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
    console.debug("[ytt-popup] TRANSCRIBE failed", res);
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
    showErrorState(res?.error);
  }
}

const nativeSummaryFlow = {
  isEnabled() {
    return summaryExperienceV2 && currentMode === "cloud" && nativeSummariesAvailable;
  },
  shouldAutoSummarize() {
    return this.isEnabled() && transcribeMode !== "transcribe";
  },
  async refreshAvailability() {
    if (!summaryExperienceV2 || currentMode !== "cloud") {
      nativeSummaryCacheScope = null;
      return;
    }
    const serviceRes = await sendMsg({ type: "CHECK_SERVICE" });
    nativeSummaryCacheScope = serviceRes?.data?.summaryCacheScope || null;
    const nextNativeSummariesAvailable =
      !!serviceRes?.data?.nativeSummariesAvailable;
    if (nextNativeSummariesAvailable !== nativeSummariesAvailable) {
      nativeSummariesAvailable = nextNativeSummariesAvailable;
      applyTranscribeActionUI();
      loadRecent();
    }
  },
};

async function maybeNativeSummarizeAfterTranscribe(
  transcriptId,
  videoTitle,
  expectedSource = null
) {
  if (!nativeSummaryFlow.shouldAutoSummarize()) return null;
  el.transcribingTitle.textContent = videoTitle || "Summarizing...";
  showState("Transcribing");
  startProgress({ writeLabels: false });
  el.progressText.textContent = "Writing summary...";
  let res;
  try {
    res = await sendMsg({ type: "SUMMARIZE_TRANSCRIPT", id: transcriptId });
  } finally {
    stopProgress();
  }
  if (!res?.success || !res.data?.summary_md) {
    showState("Ready");
    const message = res?.error || "Summary failed. Transcript is ready.";
    showPopupToast(message, "error");
    await recordIntegrityEvent("error", {
      stage: "native_summary",
      provider: "transcriber",
      expectedVideoId: expectedSource?.videoId || "",
      transcriptId,
      message,
    });
    return null;
  }
  await persistNativeSummary(transcriptId, res.data);
  await recordIntegrityEvent("handoff_launched", {
    stage: "native_summary",
    provider: "transcriber",
    expectedVideoId: expectedSource?.videoId || "",
    actualVideoId: expectedSource?.videoId || "",
    transcriptId,
  });
  return res.data;
}

async function processQueue() {
  suppressPollFinalization = false;
  const res = await sendMsg({ type: "PROCESS_QUEUE" });
  if (res?.success && res.data?.processing) {
    el.transcribingTitle.textContent = res.data.title || "Transcribing...";
    showState("Transcribing");
    startProgress({ writeLabels: false });
    showQueuePrompt();
    renderQueueList();
    pollTranscriptionStatus();
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

el.btnTranscribe.addEventListener("click", doTranscribe);
el.btnRetry.addEventListener("click", handleErrorAction);
el.btnCheckAgain.addEventListener("click", init);

// In-panel sign-in. The user never leaves the YouTube tab:
// — Google: a small popup window runs the OAuth flow and closes itself.
// — Magic link: we POST to /api/auth/magic-link; the email link lands on
//   /auth/extension-bridge which auto-closes.
// In both cases the existing `startOfflinePolling()` loop picks up the
// restored session within ~5s and reruns init().
let lastAuthEmail = "";

async function sendMagicLink(email) {
  el.cloudAuthSubmit.disabled = true;
  el.cloudAuthResend.disabled = true;
  el.cloudAuthErrorMsg.hidden = true;
  el.cloudAuthErrorMsg.textContent = "";

  const res = await sendMsg({ type: "SEND_MAGIC_LINK", email });

  el.cloudAuthSubmit.disabled = false;
  el.cloudAuthResend.disabled = false;

  if (res?.success) {
    lastAuthEmail = email;
    el.cloudAuthSentEmail.textContent = email;
    el.cloudOnboarding.hidden = true;
    el.cloudAuthError.hidden = true;
    el.cloudAuthCard.hidden = true;
    el.cloudAuthSent.hidden = false;
    return;
  }
  el.cloudAuthErrorMsg.textContent =
    res?.error || "Couldn't send the magic link. Try again.";
  el.cloudAuthErrorMsg.hidden = false;
}

el.cloudAuthForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const email = el.cloudAuthEmail.value.trim();
  if (!email) return;
  sendMagicLink(email);
});

el.cloudAuthResend.addEventListener("click", () => {
  if (!lastAuthEmail) return;
  sendMagicLink(lastAuthEmail);
});

// Google OAuth: open /auth/login?provider=google in a small popup window
// so the YouTube tab stays focused. The login page auto-triggers the
// Supabase Google flow; the callback redirects to /auth/extension-bridge
// which closes the popup.
el.cloudAuthGoogle.addEventListener("click", async () => {
  el.cloudAuthGoogle.disabled = true;
  const res = await sendMsg({ type: "OPEN_GOOGLE_SIGNIN" });
  el.cloudAuthGoogle.disabled = false;
  if (!res?.success) {
    el.cloudAuthErrorMsg.textContent =
      res?.error || "Couldn't open the Google sign-in window.";
    el.cloudAuthErrorMsg.hidden = false;
  }
});

// "Switch to self-hosted" — auto-switch to local mode
el.btnUseLocal.addEventListener("click", async () => {
  await sendMsg({ type: "SAVE_SETTINGS", mode: "local" });
  init();
});

el.btnStartTranscriber.addEventListener("click", startTranscriberClicked);

el.btnCopySetup.addEventListener("click", () => {
  const cmd = el.setupCommand.dataset.fullCmd || el.setupCommand.textContent;
  navigator.clipboard.writeText(cmd);
  el.btnCopySetup.classList.add("copied");
  setTimeout(() => el.btnCopySetup.classList.remove("copied"), 1500);
});

el.btnAlreadyTranscribed.addEventListener("click", (e) => {
  e.preventDefault();
  if (existingTranscriptId) {
    openTranscript(existingTranscriptId, { syncCurrentPage: true });
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
    author: pageInfo.author,
    channelUrl: pageInfo.channelUrl,
    videoId: pageInfo.videoId,
    pageUrl: pageInfo.pageUrl,
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
        const storedPageInfo = await getFreshPageInfoForTab(tab);
        pageInfo = pageInfoFromTab(tab, storedPageInfo);
        showQueuePrompt();
      } else {
        init();
      }
    }
  } catch { /* ignore */ }
});

chrome.tabs.onUpdated?.addListener(async (tabId, changeInfo) => {
  // Only react to changes in the active tab
  if (tabId !== currentTabId) return;

  const urlChanged = changeInfo.url && changeInfo.url !== currentTabUrl;
  const titleChanged = !!changeInfo.title;
  if (!urlChanged && !titleChanged) return;

  if (urlChanged) currentTabUrl = changeInfo.url;

  // During active transcription, refresh pageInfo + queue prompt without
  // re-init (init clobbers the progress animation). Mirrors onActivated.
  // Without this, navigating to a new YouTube video in the same tab while
  // transcribing leaves the queue prompt showing the old video's title or
  // hidden entirely — user can't see what they'd be queuing.
  if (isTranscribing) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        const storedPageInfo = await getFreshPageInfoForTab(tab);
        pageInfo = pageInfoFromTab(tab, storedPageInfo);
        showQueuePrompt();
      }
    } catch { /* ignore */ }
    return;
  }

  init();
});

// content.js writes the active tab's video info to chrome.storage.session on
// every YouTube SPA navigation (yt-navigate-finish + MutationObserver fallback).
// Listening here catches in-page route changes that chrome.tabs.onUpdated
// sometimes misses, and gets the populated title — onUpdated fires before YT
// has updated document.title, so changeInfo.title can still be the old value.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session") return;
  if (currentTabId == null) return;
  const key = `tab_${currentTabId}`;
  if (!changes[key]) return;
  const next = changes[key].newValue;
  if (!next?.url) {
    pageInfo = pageInfoFromTab({ url: currentTabUrl || "" }, {});
    existingTranscriptId = null;
    if (isTranscribing) {
      showQueuePrompt();
    } else {
      showCurrentPageState();
    }
    return;
  }
  if (isTranscribing) {
    pageInfo = pageInfoFromTab(next, next);
    currentTabUrl = next.url;
    showQueuePrompt();
  } else if (next.url !== currentTabUrl) {
    currentTabUrl = next.url;
    init();
  } else {
    pageInfo = pageInfoFromTab(next, next);
    if (pageInfo?.videoId) {
      showCurrentPageState();
    }
  }
});

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

let currentSettingsMode = "cloud";

function showSettingsView() {
  closeLlmDropdown();
  closeRowActionsMenu();
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
  el.settingsPanel.dataset.skipSkeleton = "true";
  try {
    const [res] = await Promise.all([
      sendMsg({ type: "GET_SETTINGS" }),
      loadSourceIntegrityReport(),
    ]);
    if (!res?.success) return;
    const { mode } = res.data;
    await setModeUI(mode);
    await loadTranscribeAction();
  } finally {
    delete el.settingsPanel.dataset.skipSkeleton;
  }
}

async function loadSourceIntegrityReport() {
  const res = await sendMsg({ type: "GET_SOURCE_INTEGRITY_REPORT" });
  const report = res?.success ? res.data : null;
  if (!report || !el.sourceIntegrityStatus || !el.sourceIntegrityDetail) return;
  const incidentCount = report.staleSourceBlocks + report.errors;
  el.sourceIntegrityStatus.textContent = incidentCount === 0 ? "Healthy" : "Attention";
  el.sourceIntegrityStatus.classList.toggle("success", incidentCount === 0);
  el.sourceIntegrityStatus.classList.toggle("error", incidentCount > 0);
  el.sourceIntegrityDetail.textContent =
    `${report.handoffs} summary handoff${report.handoffs === 1 ? "" : "s"} · ` +
    `${report.staleSourceBlocks} stale source${report.staleSourceBlocks === 1 ? "" : "s"} blocked · ` +
    `${report.errors} error${report.errors === 1 ? "" : "s"}. ` +
    "Stored locally; transcript text is never recorded.";
}

// YTT-259: Load the user's primary-button mode + preferred summarize
// provider from chrome.storage.sync. First-run default is Transcribe &
// Summarize because the strongest user-facing value is transcript plus
// summary, and the explicit label makes the transcript step clear. Users can
// still switch back to transcript-only in Settings. Provider defaults to
// Claude for the secondary external handoff; the per-row launcher's last-used
// has its own UX context and seeding from it surprised users.
async function loadTranscribeAction() {
  const sync = await chrome.storage.sync.get([
    "transcribeMode",
    "summarizeProvider",
    "summaryExperienceV2",
    SUMMARY_EXPERIENCE_DEFAULT_KEY,
  ]);
  transcribeMode =
    sync.transcribeMode === "transcribe" ? "transcribe" : "transcribe-and-summarize";
  summarizeProvider = sync.summarizeProvider || "claude";
  summaryExperienceV2 = readSummaryExperienceDefault(sync);
  await persistSummaryExperienceDefault(sync);
  applyTranscribeActionUI();
}

function applyTranscribeActionUI() {
  // Radio state
  el.modeTranscribe.checked = transcribeMode === "transcribe";
  el.modeTranscribeSummarize.checked = transcribeMode === "transcribe-and-summarize";
  el.summaryExperienceV2.checked = summaryExperienceV2;
  const usesSummary = transcribeMode === "transcribe-and-summarize";
  const canShowNativeSummaryDestination =
    usesSummary && currentMode === "cloud" && nativeSummariesAvailable;
  el.summaryDestinationRow.hidden = !canShowNativeSummaryDestination;
  // Provider picker is the external handoff choice; native summaries remain
  // the default destination when available.
  el.summarizeProviderRow.hidden = !usesSummary;
  applyProviderPickerTrigger();
  // Primary button label morphs to match the mode
  updateTranscribeButtonLabel();
}

// Custom provider picker — branded with each LLM's icon. Native <select>
// can't render SVG inside <option>, so we use a button trigger + popup
// menu sourced from LLM_PROVIDERS so adding a provider lights up here too.
function applyProviderPickerTrigger() {
  const provider = LLM_PROVIDERS.find((p) => p.id === summarizeProvider);
  if (!provider) return;
  el.providerPickerIcon.innerHTML = provider.icon;
  el.providerPickerName.textContent = provider.name;
}

function buildProviderPickerMenu() {
  el.providerPickerMenu.innerHTML = "";
  for (const p of LLM_PROVIDERS) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "provider-picker-option";
    item.dataset.provider = p.id;
    const isSelected = p.id === summarizeProvider;
    if (isSelected) item.classList.add("is-selected");
    item.innerHTML = `${p.icon}<span class="provider-picker-option-name">${escapeHtml(p.name)}</span>`;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      saveSummarizeProvider(p.id);
      el.providerPickerMenu.hidden = true;
    });
    el.providerPickerMenu.appendChild(item);
  }
}

el.providerPickerTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  if (el.providerPickerMenu.hidden) buildProviderPickerMenu();
  el.providerPickerMenu.hidden = !el.providerPickerMenu.hidden;
});

document.addEventListener("click", (e) => {
  if (
    !el.providerPickerMenu.hidden &&
    !el.providerPickerTrigger.contains(e.target) &&
    !el.providerPickerMenu.contains(e.target)
  ) {
    el.providerPickerMenu.hidden = true;
  }
});

buildProviderPickerMenu();

function updateTranscribeButtonLabel() {
  if (!el.btnTranscribeLabel) return;
  const provider = LLM_PROVIDERS.find((p) => p.id === summarizeProvider);
  const usesSummarize = transcribeMode !== "transcribe" && !!provider;
  const isPrivateDrive = pageInfo?.platform === "drive";
  if (isPrivateDrive && transcribeMode === "transcribe-and-summarize" && provider) {
    el.btnTranscribeLabel.textContent = `Transcribe locally & open in ${provider.name}`;
  } else if (isPrivateDrive) {
    el.btnTranscribeLabel.textContent = "Transcribe locally";
  } else if (transcribeMode === "transcribe-and-summarize") {
    el.btnTranscribeLabel.textContent = "Transcribe & Summarize";
  } else {
    el.btnTranscribeLabel.textContent = "Transcribe";
  }
  if (el.drivePrivacyNotice) el.drivePrivacyNotice.hidden = !isPrivateDrive;
  if (el.btnTranscribe) {
    el.btnTranscribe.title = isPrivateDrive
      ? "Grants this app access to only this file, downloads it temporarily, and transcribes it with local Whisper"
      : usesSummarize && nativeSummaryFlow.isEnabled()
      ? "Shows summary in Transcriber"
      : usesSummarize
      ? `Summarizes with ${provider.name}`
      : "";
  }
}

async function saveTranscribeMode(mode) {
  transcribeMode = mode;
  await chrome.storage.sync.set({ transcribeMode: mode });
  applyTranscribeActionUI();
}

async function saveSummarizeProvider(providerId) {
  summarizeProvider = providerId;
  applyProviderPickerTrigger();
  await chrome.storage.sync.set({ summarizeProvider: providerId });
  // Also update the launcher's "last used" so cross-component history stays
  // coherent — the per-row dropdown will surface it as last-used too.
  try {
    await chrome.storage.local.set({ [LLM_STORAGE_KEY]: providerId });
  } catch {
    // storage failure — non-critical
  }
}

el.modeTranscribe.addEventListener("change", () => {
  if (el.modeTranscribe.checked) saveTranscribeMode("transcribe");
});
el.modeTranscribeSummarize.addEventListener("change", () => {
  if (el.modeTranscribeSummarize.checked) saveTranscribeMode("transcribe-and-summarize");
});
el.summaryExperienceV2.addEventListener("change", async () => {
  summaryExperienceV2 = !!el.summaryExperienceV2.checked;
  await chrome.storage.sync.set({
    summaryExperienceV2,
    [SUMMARY_EXPERIENCE_DEFAULT_KEY]: SUMMARY_EXPERIENCE_DEFAULT_VERSION,
  });
  await nativeSummaryFlow.refreshAvailability();
  applyTranscribeActionUI();
  loadRecent();
});

async function setModeUI(mode) {
  currentSettingsMode = mode;
  el.btnModeLocal.classList.toggle("active", mode === "local");
  el.btnModeCloud.classList.toggle("active", mode === "cloud");
  el.cloudAccountSection.hidden = mode !== "cloud";
  applyTranscribeActionUI();
  applyFooterLink(mode);
  // Server controls are useful in self-hosted mode. The local service state
  // wins over native-host state, because the server may already be running.
  await refreshServerSection(mode);
  // Destinations always render. Obsidian is client-side (works in any mode);
  // cloud-only adapters show as teasers with a Sign in CTA in local mode.
  await renderDestinationsSettings();
}

function applyServerControlView(phase) {
  const view = TranscriberServerControl.getServerControlView(phase);
  el.serverStatus.textContent = view.statusText;
  el.serverStatus.hidden = false;
  el.btnStartServer.hidden = view.startHidden;
  el.btnStopServer.hidden = view.stopHidden;
  el.btnStartServer.disabled = view.startDisabled;
  el.btnStartServer.querySelector(".start-server-label").textContent =
    view.startLabel;
  el.btnStartServer.querySelector(".start-spinner").hidden =
    view.spinnerHidden;
}

async function refreshServerSection(mode) {
  if (mode !== "local") {
    el.serverSection.hidden = true;
    return;
  }
  el.serverSection.hidden = false;
  el.stopServerHint.hidden = true;

  // Probe server state first. If localhost is already online, show Stop even
  // when the native host is unavailable or crashed.
  const serviceRes = await sendMsg({ type: "CHECK_SERVICE" });
  const serverOnline = !!(serviceRes?.success && serviceRes.data?.online);
  if (serverOnline) {
    applyServerControlView("running");
    return;
  }

  // Need native host to start a stopped server. If we don't know yet, probe so
  // Start can report a clear helper error if it is clicked.
  if (nativeHostAvailable === undefined || nativeHostAvailable === null) {
    await detectNativeHost();
  }

  applyServerControlView("stopped");
}

async function startServerClicked() {
  if (nativeStartInFlight) return;
  nativeStartInFlight = true;
  el.stopServerHint.hidden = true;
  applyServerControlView("starting");
  let startupSucceeded = false;
  try {
    const res = await callNativeHost("start", {}, 30000);
    if (res?.ok || res?.reason === "already_running") {
      // Keep Settings open and refresh its own server controls. Calling the
      // general init() here leaves the exclusive Settings view mounted, so
      // the stale "Server stopped" copy and Start button never changed.
      stopOfflinePolling();
      await refreshServerSection("local");
      startupSucceeded = true;
    } else if (res?.reason === "port_conflict") {
      el.stopServerHint.textContent =
        `Port ${res.port || 19720} is already in use by another app. ` +
        `Close it (or change the port) and try again.`;
      el.stopServerHint.hidden = false;
    } else {
      el.stopServerHint.textContent =
        res?.error || "Couldn't start the server. Check ~/Library/Logs/Transcriber/native-host.log";
      el.stopServerHint.hidden = false;
    }
  } catch (e) {
    if (e.message === "native_host_unavailable" ||
        /Specified native messaging host not found/i.test(e.message)) {
      nativeHostAvailable = false;
      el.stopServerHint.textContent =
        "Start helper is not connected. Reload the extension, then try Start again.";
    } else {
      el.stopServerHint.textContent = `Start failed: ${e.message}`;
    }
    el.stopServerHint.hidden = false;
  } finally {
    nativeStartInFlight = false;
    if (!startupSucceeded) applyServerControlView("stopped");
  }
}

el.btnStartServer.addEventListener("click", startServerClicked);

async function stopServerClicked() {
  if (nativeStartInFlight) return;
  el.btnStopServer.disabled = true;
  el.stopServerHint.hidden = true;
  el.btnStopServer.querySelector(".start-spinner").hidden = false;
  el.btnStopServer.querySelector(".stop-label").textContent = "Stopping…";
  try {
    const res = await callNativeHost("stop", {}, 10000);
    if (res?.stopped) {
      el.stopServerHint.textContent = "Server stopped.";
      el.stopServerHint.hidden = false;
    } else if (res?.reason === "not_running") {
      el.stopServerHint.textContent =
        "No tracked server. If you started it from a Terminal, stop it there (Ctrl-C).";
      el.stopServerHint.hidden = false;
    } else {
      el.stopServerHint.textContent = res?.error || "Couldn't stop the server.";
      el.stopServerHint.hidden = false;
    }
  } catch (e) {
    el.stopServerHint.textContent = `Stop failed: ${e.message}`;
    el.stopServerHint.hidden = false;
  } finally {
    el.btnStopServer.disabled = false;
    el.btnStopServer.querySelector(".start-spinner").hidden = true;
    el.btnStopServer.querySelector(".stop-label").textContent = "Stop";
    // Refresh the section so the button flips Stop → Start.
    refreshServerSection(currentSettingsMode);
  }
}

el.btnStopServer.addEventListener("click", stopServerClicked);

// Footer right-side link swaps with mode: GitHub repo for local devs,
// transcribed.dev wordmark for cloud users (CTA toward the web app).
async function applyFooterLink(modeOverride) {
  let mode = modeOverride;
  if (!mode) {
    const stored = await chrome.storage.sync.get(["mode"]);
    mode = stored.mode || "cloud";
  }
  const isCloud = mode === "cloud";
  el.cloudLink.hidden = !isCloud;
  el.githubLink.hidden = isCloud;
}

// Obsidian vault name — saved on every keystroke (debounced) to
// chrome.storage.sync. Used when sending to Obsidian.
let obsidianVaultSaveTimer = null;
function saveObsidianVaultName() {
  const value = el.obsidianVaultInput.value.trim();
  if (obsidianVaultSaveTimer) clearTimeout(obsidianVaultSaveTimer);
  obsidianVaultSaveTimer = setTimeout(async () => {
    await chrome.storage.sync.set({ obsidianVaultName: value });
    el.obsidianVaultSaved.hidden = false;
    el.obsidianVaultSaved.classList.add("show");
    setTimeout(() => {
      el.obsidianVaultSaved.classList.remove("show");
      setTimeout(() => { el.obsidianVaultSaved.hidden = true; }, 300);
    }, 1200);
    // Connection state for Obsidian is derived from whether a vault name is
    // saved. When the value flips empty↔non-empty, re-render so the toggle
    // reflects the new state instead of getting stuck off after a disconnect.
    const cached = (destinationsCache?.destinations || []).find(
      (d) => d.adapterId === "obsidian-scheme"
    );
    const isConnected = !!value;
    if (cached && cached.connected !== isConnected) {
      destinationsCache = null;
      renderDestinationsSettings();
    }
  }, 350);
}
el.obsidianVaultInput.addEventListener("input", saveObsidianVaultName);
el.obsidianVaultInput.addEventListener("blur", () => {
  if (obsidianVaultSaveTimer) {
    clearTimeout(obsidianVaultSaveTimer);
    obsidianVaultSaveTimer = null;
  }
  saveObsidianVaultName();
});

el.obsidianAdvUriInput.addEventListener("change", async () => {
  await chrome.storage.sync.set({
    obsidianUseAdvancedUri: !!el.obsidianAdvUriInput.checked,
  });
});

async function switchMode(newMode) {
  destinationsCache = null;
  // Mode switch invalidates the apiConfigCache in the background worker.
  // The first /api/account hit after rebuild can 401 on a cookie race the
  // same way a true cold start does, so reopen the retry window.
  coldStartHandled = false;
  currentMode = newMode;
  // Drop any in-flight state from the previous mode. Without this, an
  // interrupted cloud transcribe can leave bg state="transcribing" — PHASE 3
  // of init() then re-arms isTranscribing=true and the next Transcribe
  // click is silently blocked by the doTranscribe guard. User saw this as
  // "first click after mode switch does nothing".
  isTranscribing = false;
  // Hide stale destinations rows immediately. The two awaits below take
  // 100-500ms; without this, switching cloud → self-hosted leaves the
  // Notion row visible during that window, looking like a bug. Skeletons
  // are mode-agnostic so they're a safe placeholder.
  if (isSettingsOpen()) renderDestinationsSkeleton();
  await sendMsg({ type: "CLEAR_TRANSCRIPTION" });
  await sendMsg({ type: "SAVE_SETTINGS", mode: newMode });
  // Persist FIRST, render SECOND. setModeUI triggers
  // renderDestinationsSettings → fetchDestinations → GET_SETTINGS — if we
  // re-render before SAVE_SETTINGS resolves, that GET returns the *previous*
  // mode and the destinations list is built from stale state. Symptom seen:
  // self-hosted → cloud only showed Obsidian (cloud branch never ran);
  // cloud → self-hosted showed Notion as a "Cloud unreachable" teaser
  // (the cloud branch ran with a defunct cloud server, fell back to teasers).
  await setModeUI(newMode);
  // Mode toggles live inside the settings panel — keep the user there.
  // init() (which collapses settings into the library view) runs when the
  // user navigates back via the Library nav button.
  if (!isSettingsOpen()) init();
}

// Setup wall — gates first-time switch to self-hosted. Skipped for users
// who've already set up self-hosted before (selfHostedSetupCompleted flag).
const SETUP_GUIDE_URL =
  "https://github.com/lifesized/youtube-transcriber#install";

async function isSelfHostedSetupCompleted() {
  const { selfHostedSetupCompleted } = await chrome.storage.sync.get([
    "selfHostedSetupCompleted",
  ]);
  return !!selfHostedSetupCompleted;
}

async function markSelfHostedSetupCompleted() {
  await chrome.storage.sync.set({ selfHostedSetupCompleted: true });
}

function showSetupWall() {
  el.setupWallModal.hidden = false;
}

function hideSetupWall() {
  el.setupWallModal.hidden = true;
}

el.setupWallStay.addEventListener("click", () => {
  hideSetupWall();
  // Toggle visually reverts — UI state is driven by currentMode (still "cloud").
  setModeUI(currentMode);
});

el.setupWallContinue.addEventListener("click", async () => {
  hideSetupWall();
  await markSelfHostedSetupCompleted();
  chrome.tabs.create({ url: SETUP_GUIDE_URL });
  await switchMode("local");
});

el.btnModeLocal.addEventListener("click", async () => {
  if (currentMode === "local") return;
  if (await isSelfHostedSetupCompleted()) {
    switchMode("local");
    return;
  }
  showSetupWall();
});
el.btnModeCloud.addEventListener("click", () => switchMode("cloud"));

// Auto-detect path: server already running, so by definition setup is done.
// Mark graduated immediately so subsequent toggles skip the wall. The original
// btnUseLocal handler (above) still runs and flips mode — both run on click.
el.btnUseLocal.addEventListener("click", () => {
  markSelfHostedSetupCompleted();
});

// Local-detected banner dismiss — stops the nudge for users who don't want
// to switch but happen to have a server running on localhost (other tools).
el.btnDismissBanner.addEventListener("click", async () => {
  el.localDetectedBanner.hidden = true;
  await chrome.storage.sync.set({ localBannerDismissed: true });
});

// Existing self-hosted users: retroactively mark setup completed and show
// a one-time toast that the toggle moved into Advanced. Runs once per install.
async function migrateExistingSelfHostedUser() {
  const stored = await chrome.storage.sync.get([
    "mode",
    "selfHostedSetupCompleted",
    "advancedRelocationToastShown",
  ]);
  if (stored.mode === "local" && !stored.selfHostedSetupCompleted) {
    await chrome.storage.sync.set({ selfHostedSetupCompleted: true });
  }
  if (
    stored.mode === "local" &&
    !stored.advancedRelocationToastShown &&
    el.popupToast
  ) {
    el.popupToast.textContent =
      "Settings moved — Self-hosted mode is now under Advanced.";
    el.popupToast.hidden = false;
    setTimeout(() => {
      el.popupToast.hidden = true;
    }, 5000);
    await chrome.storage.sync.set({ advancedRelocationToastShown: true });
  }
}
migrateExistingSelfHostedUser();

// Start
init();
}
