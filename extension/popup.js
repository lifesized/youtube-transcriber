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
  popupToast: document.getElementById("popupToast"),
};

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
  const bar = document.getElementById("progressBar");
  bar.classList.remove("indeterminate");
  bar.style.width = "0%";
  let stageIdx = 0;
  let elapsed = 0;

  el.progressText.textContent = writeLabels
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
      if (writeLabels) {
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

const LLM_ICONS = {
  claude: `
    <svg class="recent-summarize-icon" width="14" height="14" viewBox="0 0 100 100" fill="#D97757" aria-hidden="true">
      <path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z"/>
    </svg>
  `,
  chatgpt: `
    <svg class="recent-summarize-icon" width="14" height="14" viewBox="0 0 320 320" fill="currentColor" aria-hidden="true">
      <path d="m297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68-15.25-17.18-37.16-26.95-60.13-26.81-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61 41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zm-120.28 168.11c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.92-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74v-74.39c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z"/>
    </svg>
  `,
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
    // Fallback when the user declines the host permission: ChatGPT supports
    // URL prefill via ?q=, which populates the composer but requires the
    // user to click Send manually.
    urlTemplate: "https://chatgpt.com/?q={prompt}",
    clipboardFallback: false,
    openUrl: null,
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

function buildLlmLauncher(transcriptId, videoTitle) {
  const wrapper = document.createElement("div");
  wrapper.className = "recent-summarize";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "recent-summarize-btn";
  btn.title = "Summarize with LLM...";
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none"
         stroke="currentColor" stroke-width="1.75"
         stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2"/>
      <path d="M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41"/>
      <circle cx="10" cy="10" r="2"/>
    </svg>
  `;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleLlmDropdown(wrapper, transcriptId, videoTitle);
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

async function toggleLlmDropdown(wrapper, transcriptId, videoTitle) {
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
      launchWithProvider(provider, transcriptId, videoTitle);
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

async function launchWithProvider(provider, transcriptId, videoTitle) {
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
    return;
  }

  let transcriptText;
  try {
    const segments = JSON.parse(res.data.transcript);
    transcriptText = flattenSegments(segments);
  } catch {
    console.warn("Summarize: transcript parse failed");
    return;
  }

  const instruction = llmPromptTemplate.replace(/\{title\}/g, videoTitle);
  const prompt = `${instruction}\n\nTranscript:\n\n${transcriptText}`;

  // Primary path for every provider: content-script handoff so the prompt
  // lands in the composer AND the send button fires automatically.
  if (provider.handoffOrigins && provider.handoffUrl) {
    const launched = await tryLlmHandoff(provider, prompt);
    if (launched) return;
  }

  // Fallback 1: URL prefill template (ChatGPT's ?q=) — puts text in the
  // composer but user still has to click Send.
  if (provider.urlTemplate) {
    const encoded = encodeURIComponent(prompt);
    const maxLen = 6000;
    const safe = encoded.length > maxLen ? encoded.slice(0, maxLen) : encoded;
    const url = provider.urlTemplate.replace("{prompt}", safe);
    await openNextToCurrentTab(url);
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

// Listen for OAuth return broadcasts from destination-connected.html so the settings
// list reflects a fresh connection without waiting for the polling fallback.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "OAUTH_RETURN") return;
  destinationsCache = null;
  if (el.settingsPanel && !el.settingsPanel.hidden) {
    renderDestinationsSettings();
  }
});

// Bundled icons — cloud returns relative paths like "/icons/notion.svg" that
// 404 from chrome-extension:// origin, so we override by adapterId.
const LOCAL_DESTINATION_ICONS = {
  "notion": "icons/notion.svg",
  "obsidian-scheme": "icons/obsidian.svg",
};

// Client-side adapters — available in any mode, no cloud account required.
// Obsidian's "connected" state is derived from whether the user has saved
// a vault name, not from any server call.
const CLIENT_SIDE_ADAPTERS = [
  { adapterId: "obsidian-scheme", name: "Obsidian", icon: "", clientSide: true },
];

// Cloud-only teasers — shown when the user is in cloud mode but the
// destinations fetch failed (signed out, offline, 5xx). Renders with a
// "Sign in" CTA instead of Connect. Hidden entirely in self-hosted mode
// since these adapters can't work without the cloud backend.
const CLOUD_TEASER_ADAPTERS = [
  { adapterId: "notion", name: "Notion", icon: "", cloudOnly: true },
];

async function fetchDestinations() {
  if (destinationsLoading) return destinationsCache;
  destinationsLoading = true;
  try {
    const { obsidianVaultName } = await chrome.storage.sync.get(
      "obsidianVaultName"
    );
    const clientSide = CLIENT_SIDE_ADAPTERS.map((d) => {
      if (d.adapterId === "obsidian-scheme") {
        return { ...d, connected: !!(obsidianVaultName || "").trim() };
      }
      return { ...d, connected: false };
    });

    const settingsRes = await sendMsg({ type: "GET_SETTINGS" });
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
        cloudAdapters = CLOUD_TEASER_ADAPTERS;
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

async function renderDestinationsSettings() {
  // Destinations always visible — Obsidian works in any mode (client-side
  // URL scheme), and cloud-only adapters render as "Sign in" teasers when
  // not reachable. The only state where the section is empty is if we
  // somehow have zero adapters total, which shouldn't happen.
  el.destinationsSection.hidden = false;
  el.destinationsList.innerHTML = "";
  el.destinationsEmpty.hidden = true;

  const res = await fetchDestinations();
  const list = res.destinations || [];

  if (!list.length) {
    el.destinationsEmpty.hidden = false;
    el.destinationsEmpty.textContent = "No destinations available.";
    return;
  }

  const ctx = {
    cloudReady: res.cloudReady,
    cloudReason: res.cloudReason,
  };

  for (const d of list) {
    el.destinationsList.appendChild(buildDestinationRow(d, ctx));
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
  const status = document.createElement("span");
  status.className = "destinations-row-status";
  text.appendChild(name);
  text.appendChild(status);

  let actionEl;

  if (d.clientSide) {
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
      status.textContent = "Add vault name below";
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
    if (cloudReason === "authError") {
      status.textContent = "Session expired — sign in again";
    } else if (cloudReason === "unavailable") {
      status.textContent = "Cloud unreachable — retry shortly";
    } else if (cloudReason === "local") {
      status.textContent = "Switch to Cloud mode to use";
    } else {
      status.textContent = "Sign in to transcribed.dev to use";
    }
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
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <circle cx="4" cy="10" r="1.6"/>
      <circle cx="10" cy="10" r="1.6"/>
      <circle cx="16" cy="10" r="1.6"/>
    </svg>
  `;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleRowActionsMenu(wrapper, transcriptId, videoTitle);
  });
  wrapper.appendChild(btn);
  return wrapper;
}

async function toggleRowActionsMenu(wrapper, transcriptId, videoTitle) {
  if (rowActionsOpen && rowActionsOpen._wrapper === wrapper) {
    closeRowActionsMenu();
    return;
  }
  closeRowActionsMenu();

  // Kick off a refresh so the menu reflects connection changes while the
  // side panel has been open.
  fetchDestinations();

  const menu = document.createElement("div");
  menu.className = "row-actions-menu";

  const connected = connectedDestinations();

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
            const errMsg =
              errData.error ||
              res?.error ||
              `Couldn't send to ${destName}`;
            showPopupToast(errMsg, "error");
          }
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

  if (connected.length === 0) {
    const note = document.createElement("div");
    note.className = "row-actions-menu-empty";
    note.textContent = "Connect a destination in Settings to send";
    menu.appendChild(separator());
    menu.appendChild(note);
  }

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

// ---------------------------------------------------------------------------
// Inline transcript drawer — matches the web app's list-item accordion. Click
// a row to expand the transcript below it; click again to collapse. ⋯ menu
// still has "Open in web app" for the full-page view.
// ---------------------------------------------------------------------------

async function toggleInlineTranscript(wrap, transcriptId) {
  const expanded = wrap.classList.toggle("expanded");
  if (!expanded) return;
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
  panel.innerHTML = renderTranscriptBlocks(segments);
  panel.dataset.loaded = "1";
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
  return items.map((t) => `${t.id}:${t.title}:${t.createdAt}`).join("|");
}

async function loadRecent() {
  const modeRes = await sendMsg({ type: "GET_SETTINGS" });
  const mode = modeRes?.data?.mode || "cloud";

  // 1. Optimistic render. Cached list if we have one (instant + correct
  // shape); otherwise a skeleton so the panel never shows a dark void
  // while the first /api/transcripts fetch is in flight.
  const cached = await getCachedRecent(mode);
  if (!isSettingsOpen()) {
    if (cached && cached.length) {
      renderRecentList(cached);
    } else {
      renderRecentSkeleton();
    }
  }

  // 2. Fetch fresh; reconcile.
  const res = await sendMsg({ type: "GET_RECENT" });
  if (isSettingsOpen()) return;
  if (!res?.success || !res.data?.length) {
    // Empty list — clear cache and hide section unless we're still rendering
    // a stale optimistic list that we now know is gone.
    await setCachedRecent(mode, []);
    el.recentSection.hidden = true;
    el.recentList.innerHTML = "";
    return;
  }
  // Skip DOM churn when nothing changed — cached render is already correct.
  if (cached && recentListHash(cached) === recentListHash(res.data) && !justCompletedId) {
    return;
  }
  renderRecentList(res.data);
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
  el.recentList.innerHTML = "";
  for (const t of items) {
    const isNew = justCompletedId && t.id === justCompletedId;

    const wrap = document.createElement("div");
    wrap.className = "recent-item-wrap";

    const item = document.createElement("a");
    item.className = `recent-item${isNew ? " recent-item-new" : ""}`;
    item.href = "#";
    item.addEventListener("click", (e) => {
      // Ignore clicks that land on inline action buttons (LLM, ⋯ menu).
      if (e.target.closest(".recent-summarize") || e.target.closest(".row-actions")) {
        return;
      }
      e.preventDefault();
      toggleInlineTranscript(wrap, t.id);
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
    // Summarize-with-LLM button — hover-reveal per row, mirrors web-app LlmLauncher
    item.appendChild(buildLlmLauncher(t.id, t.title));
    // ⋯ menu — send to destinations, download, copy, open in web app (YTT-205 §3)
    item.appendChild(buildRowActionsMenu(t.id, t.title));

    const panel = document.createElement("div");
    panel.className = "recent-transcript";
    const panelInner = document.createElement("div");
    panelInner.className = "recent-transcript-inner";
    panel.appendChild(panelInner);

    wrap.appendChild(item);
    wrap.appendChild(panel);
    el.recentList.appendChild(wrap);

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

  // Bail if the user switched to Settings before or during this flow.
  if (isSettingsOpen()) return;

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
// True after the first init() has completed its CHECK_SERVICE round-trip.
// The cold-start retry below is only useful on the genuinely cold first
// hit; subsequent init() calls (nav clicks, post-OAuth re-runs) talk to a
// warm service worker and don't need the 400ms retry tax.
let coldStartHandled = false;

async function init() {
  const thisInit = ++initVersion;

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

  // PHASE 1 — cheap parallel reads. None of these hit the network. Combined
  // they take a few ms; doing them in parallel (and skipping the bg
  // GET_SETTINGS round-trip in favor of a direct chrome.storage.sync read)
  // means we have everything needed for an optimistic first paint before the
  // first network fetch even starts.
  let tabResult = [];
  let syncStash = {};
  let authCache = null;
  try {
    [tabResult, syncStash, authCache] = await Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      chrome.storage.sync.get(["mode"]),
      getCachedAuth(),
    ]);
  } catch { /* ignore */ }
  if (thisInit !== initVersion) return;

  const mode = syncStash?.mode || "cloud";
  // Only treat the cache as a hard "they are signed in" signal — used to
  // broaden the cold-start retry below. We always paint optimistically
  // regardless, so the panel never shows a dark void while CHECK_SERVICE
  // is in flight.
  const cachedAuthOk = mode === "cloud" && isAuthCacheFresh(authCache);
  const tab = tabResult?.[0];
  if (tab) {
    const videoId = extractVideoId(tab.url || "");
    let isLive = false;
    try {
      const stored = await chrome.storage.session.get(`tab_${tab.id}`);
      isLive = !!stored[`tab_${tab.id}`]?.isLive;
    } catch { /* ignore */ }
    pageInfo = { url: tab.url, title: tab.title, videoId, isLive };
    currentTabUrl = tab.url;
    currentTabId = tab.id;
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
  loadRecent();
  optimisticRendered = true;

  // PHASE 3 — in-flight transcription check. Done after optimistic paint so
  // a returning user doesn't see a dark screen during this round-trip
  // either. If a transcription is in flight we'll override the optimistic
  // state with the Transcribing UI.
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
        const isCloud = mode === "cloud";
        startProgress({ writeLabels: !isCloud });
        if (isCloud && pending.progressText) {
          el.progressText.textContent = pending.progressText;
        }
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
      if (!optimisticRendered) loadRecent();
      return;
    }
  }

  // PHASE 4 — confirm via CHECK_SERVICE. If we already painted optimistically
  // and the service is up + authed, this is a no-op visually. If we got it
  // wrong, swap to the offline / sign-in UI.
  let serviceRes = await sendMsg({ type: "CHECK_SERVICE" });
  if (thisInit !== initVersion) return;
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
      if (thisInit !== initVersion) return;
      serviceRes = await sendMsg({ type: "CHECK_SERVICE" });
      if (thisInit !== initVersion) return;
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

  // Confirmed online. Refresh auth cache for cloud so next reopen paints
  // optimistically without the round-trip gating.
  if (mode === "cloud") setCachedAuth(true);

  startHeartbeat();

  // Warm the destinations cache so the ⋯ menu renders instantly.
  // Always — Obsidian is available in local mode too.
  fetchDestinations();

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

  // Same staged width animation in both modes. Local fills in fake stage
  // labels; cloud suppresses them and lets the poll overwrite progressText
  // with the real backend stage.
  const cfgRes = await sendMsg({ type: "GET_SETTINGS" });
  const isCloud = cfgRes?.data?.mode === "cloud";
  startProgress({ writeLabels: !isCloud });
  if (isCloud) {
    suppressPollFinalization = true;
    pollTranscriptionStatus();
  } else {
    suppressPollFinalization = false;
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
    const cfg = await sendMsg({ type: "GET_SETTINGS" });
    const isCloud = cfg?.data?.mode === "cloud";
    startProgress({ writeLabels: !isCloud });
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
  const res = await sendMsg({ type: "GET_SETTINGS" });
  if (!res?.success) return;
  const { mode } = res.data;
  setModeUI(mode);
}

function setModeUI(mode) {
  currentSettingsMode = mode;
  el.btnModeLocal.classList.toggle("active", mode === "local");
  el.btnModeCloud.classList.toggle("active", mode === "cloud");
  el.cloudAccountSection.hidden = mode !== "cloud";
  applyFooterLink(mode);
  // Destinations always render. Obsidian is client-side (works in any mode);
  // cloud-only adapters show as teasers with a Sign in CTA in local mode.
  renderDestinationsSettings();
}

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

el.btnModeLocal.addEventListener("click", async () => {
  destinationsCache = null;
  coldStartHandled = false;
  setModeUI("local");
  await sendMsg({ type: "SAVE_SETTINGS", mode: "local" });
  // Mode toggles live inside the settings panel — keep the user there.
  // init() (which collapses settings into the library view) runs when the
  // user navigates back via the Library nav button.
  if (!isSettingsOpen()) init();
});
el.btnModeCloud.addEventListener("click", async () => {
  destinationsCache = null;
  // Mode switch invalidates the apiConfigCache in the background worker.
  // The first /api/account hit after rebuild can 401 on a cookie race the
  // same way a true cold start does, so reopen the retry window.
  coldStartHandled = false;
  setModeUI("cloud");
  await sendMsg({ type: "SAVE_SETTINGS", mode: "cloud" });
  if (!isSettingsOpen()) init();
});

// Start
init();
