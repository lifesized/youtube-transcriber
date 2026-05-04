// ---------------------------------------------------------------------------
// API Configuration — runtime mode switching (local / cloud)
// ---------------------------------------------------------------------------

const LOCAL_BASE = "http://localhost:19720";
// Apex (no `www.`) — the site 307-redirects `www.` to apex, and that
// redirect hop can drop the session cookie when host-only. Hitting the
// apex directly keeps credentials intact.
const CLOUD_BASE = "https://transcribed.dev";

let _apiConfigCache = null;

async function getApiConfig() {
  if (_apiConfigCache) return _apiConfigCache;
  const { mode } = await chrome.storage.sync.get(["mode"]);
  _apiConfigCache = buildConfig(mode || "cloud");
  return _apiConfigCache;
}

function buildConfig(mode) {
  if (mode === "cloud") {
    // Cloud auth rides on the user's transcribed.dev session cookie.
    // `credentials: "include"` on fetch sends the cookie cross-origin;
    // host_permissions for transcribed.dev allows it.
    return {
      mode: "cloud",
      baseUrl: CLOUD_BASE,
      headers: {},
      credentials: "include",
    };
  }
  return { mode: "local", baseUrl: LOCAL_BASE, headers: {}, credentials: "omit" };
}

// Invalidate cache when settings change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.mode) {
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
  {
    id: "claude-handoff",
    matches: ["https://claude.ai/*"],
    js: ["content-llm-handoff.js"],
    runAt: "document_idle",
  },
  {
    id: "chatgpt-handoff",
    matches: ["https://chatgpt.com/*"],
    js: ["content-llm-handoff.js"],
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

  // Only register scripts whose match patterns are covered by currently-granted
  // permissions. Optional hosts (e.g. claude.ai) are registered lazily after
  // chrome.permissions.request() grants access.
  const eligible = [];
  for (const script of CONTENT_SCRIPTS) {
    try {
      const ok = await chrome.permissions.contains({ origins: script.matches });
      if (ok) eligible.push(script);
    } catch {
      // permissions API hiccup — skip this script rather than breaking registration
    }
  }
  if (eligible.length) {
    await chrome.scripting.registerContentScripts(eligible);
  }
  // Chrome doesn't auto-inject newly-registered content scripts into tabs
  // that were already open — only into future page loads. Without manual
  // intervention, an extension update leaves users with stale (or absent)
  // content scripts on every YouTube tab they have open until they reload
  // each one. Inject programmatically into existing matching tabs so the
  // post-update state matches the post-reload state.
  await injectIntoExistingTabs(eligible);
}

async function injectIntoExistingTabs(scripts) {
  for (const script of scripts) {
    let tabs;
    try {
      tabs = await chrome.tabs.query({ url: script.matches });
    } catch {
      continue;
    }
    for (const tab of tabs) {
      if (!tab.id || (tab.url || "").startsWith("chrome://")) continue;

      // ISOLATED scripts add chrome.runtime.onMessage listeners — re-injecting
      // when one is already alive would duplicate every response. Ping first;
      // skip if the new content script already answers.
      if (script.world !== "MAIN") {
        const alive = await new Promise((resolve) => {
          try {
            chrome.tabs.sendMessage(
              tab.id,
              { type: "PING_TRANSCRIBER" },
              (reply) => {
                if (chrome.runtime.lastError) return resolve(false);
                resolve(!!reply?.ok);
              }
            );
          } catch {
            resolve(false);
          }
        });
        if (alive) continue;
      }

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: script.js,
          world: script.world,
          injectImmediately: true,
        });
      } catch {
        // chrome://, restricted hosts, page about to navigate, etc. —
        // best-effort; the next page load will pick up the registered
        // script anyway.
      }
    }
  }
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
  const health = await tryHealthCheck(config.baseUrl, config.headers, config.mode, config.credentials);

  // In cloud mode, /api/health doesn't require auth — so a 200 from it
  // doesn't mean the user is signed in. Validate the session separately
  // by hitting an authenticated endpoint with the cookie.
  if (health.online && config.mode === "cloud") {
    try {
      const res = await fetch(`${config.baseUrl}/api/account`, {
        method: "GET",
        credentials: config.credentials,
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 401) {
        // Distinguish first-time users (never signed in on this install)
        // from returning users whose session expired, so the UI can pick
        // "Get started" vs "Signed out" copy.
        const { hasEverSignedIn } = await chrome.storage.local.get(
          "hasEverSignedIn"
        );
        return {
          online: false,
          mode: "cloud",
          authError: true,
          firstTime: !hasEverSignedIn,
        };
      }
      if (res.ok) {
        // Remember that this install has authed at least once.
        await chrome.storage.local.set({ hasEverSignedIn: true });
      }
    } catch {
      // Network error on session check — still treat as online since health passed
    }
  }

  return health;
}

/**
 * Send a Supabase magic-link email to `email`, keeping the user on their
 * current tab. Cloud endpoint sets the post-auth redirect so the email
 * link completes the session on transcribed.dev (cross-origin cookie
 * already allowed by host_permissions), and the side panel's offline
 * poller picks up the new session automatically.
 */
async function sendMagicLink(email) {
  const trimmed = (email || "").trim();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error("Enter a valid email address.");
  }
  let res;
  try {
    res = await fetch(`${CLOUD_BASE}/api/auth/magic-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: trimmed, source: "extension" }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error("Network error. Check your connection.");
  }
  if (res.ok) return { sent: true };
  let message = "Couldn't send the magic link. Try again.";
  try {
    const data = await res.json();
    if (data?.error) message = data.error;
  } catch { /* ignore */ }
  throw new Error(message);
}

/**
 * Open transcribed.dev/auth/login in a small popup window with
 * ?provider=google so the login page auto-triggers the Supabase Google
 * OAuth redirect. The callback lands on /auth/extension-bridge which
 * closes the popup; the side panel's offline poll restores the session.
 */
async function openGoogleSignin() {
  const next = encodeURIComponent("/auth/extension-bridge");
  const url = `${CLOUD_BASE}/auth/login?provider=google&next=${next}`;
  const width = 420;
  const height = 560;

  // Center the popup over whichever window the user is currently in.
  let left;
  let top;
  try {
    const current = await chrome.windows.getCurrent();
    if (current?.width && current?.height) {
      left = Math.round((current.left ?? 0) + (current.width - width) / 2);
      top = Math.round((current.top ?? 0) + (current.height - height) / 2);
    }
  } catch { /* fall back to Chrome default placement */ }

  let win;
  try {
    win = await chrome.windows.create({
      url,
      type: "popup",
      width,
      height,
      ...(left != null && top != null ? { left, top } : {}),
    });
  } catch (err) {
    throw new Error(err?.message || "Could not open the sign-in window.");
  }

  // Auto-close the popup when it reaches the extension-bridge URL. Falling
  // back to the bridge page's own window.close() isn't 100% reliable across
  // browsers, so we close the window from the extension side too.
  const windowId = win.id;
  if (windowId != null) {
    const onUpdated = (_tabId, changeInfo, tab) => {
      if (tab?.windowId !== windowId) return;
      const u = changeInfo.url || tab.url || "";
      if (u.includes("/auth/extension-bridge")) {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        // Brief delay so Supabase sets the session cookie before we close.
        setTimeout(() => {
          chrome.windows.remove(windowId).catch(() => { /* already closed */ });
        }, 400);
      }
    };
    const onRemoved = (closedId) => {
      if (closedId === windowId) {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.windows.onRemoved.removeListener(onRemoved);
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onRemoved.addListener(onRemoved);
  }

  return { opened: true };
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

async function tryHealthCheck(baseUrl, headers, mode, credentials) {
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      method: "GET",
      headers,
      credentials: credentials || "omit",
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

async function transcribeRequest(url, extras = {}) {
  const config = await getApiConfig();
  const body = { url };
  if (extras?.segments?.length) {
    body.segments = extras.segments;
    if (extras.languageCode) body.languageCode = extras.languageCode;
    if (typeof extras.isAutoGenerated === "boolean") {
      body.isAutoGenerated = extras.isAutoGenerated;
    }
    // The fast-path endpoint can't fetch metadata (Vercel is blocked from
    // YouTube), so the extension supplies title scraped from the page.
    if (extras.title) body.title = extras.title;
  }
  const res = await fetch(`${config.baseUrl}/api/transcripts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...config.headers },
    credentials: config.credentials,
    body: JSON.stringify(body),
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

// ---------------------------------------------------------------------------
// Caption fast path — ask the active YouTube tab for the segments via the
// MAIN-world content script (which can read window.ytInitialPlayerResponse)
// before hitting the server. Best-effort with a tight timeout: if the page
// has no captions, the user is on a non-YouTube tab, or anything else goes
// wrong, we fall back to the existing server-side fetch path silently.
// ---------------------------------------------------------------------------

const CAPTION_EXTRACT_TIMEOUT_MS = 2500;

function youtubeVideoId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "youtube.com" && host !== "m.youtube.com") return null;
    if (u.pathname === "/watch") return u.searchParams.get("v");
    if (u.pathname.startsWith("/shorts/"))
      return u.pathname.split("/shorts/")[1]?.split("/")[0];
    if (u.pathname.startsWith("/embed/"))
      return u.pathname.split("/embed/")[1]?.split("/")[0];
  } catch { /* ignore */ }
  return null;
}

async function findYouTubeTabForUrl(targetUrl) {
  const targetVid = youtubeVideoId(targetUrl);
  if (!targetVid) return null;
  try {
    const tabs = await chrome.tabs.query({ url: ["*://*.youtube.com/*"] });
    // Prefer exact URL match, fall back to videoId match (covers cases where
    // YouTube has appended &t= or other params after the user opened the panel).
    const exact = tabs.find((t) => t.url === targetUrl);
    if (exact) return exact;
    return tabs.find((t) => youtubeVideoId(t.url || "") === targetVid) || null;
  } catch {
    return null;
  }
}

function sendMessageWithTimeout(tabId, message, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // chrome.runtime.lastError fires when no listener responded —
        // surface as null so the caller falls back gracefully.
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response ?? null);
      });
    } catch {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    }
  });
}

async function tryExtractCaptions(url) {
  const tab = await findYouTubeTabForUrl(url);
  if (!tab?.id) {
    console.log("[ytt-bg] caption fast-path: no matching youtube tab", { url });
    return null;
  }
  let response = await sendMessageWithTimeout(
    tab.id,
    { type: "EXTRACT_CAPTIONS" },
    CAPTION_EXTRACT_TIMEOUT_MS
  );
  // Null response = no listener on the tab. Common when the user opened the
  // YouTube tab BEFORE the extension loaded, or after a `chrome://extensions`
  // reload didn't fire registerContentScripts in the right window. Inject
  // content.js on-demand and retry once. This is the belt-and-suspenders
  // recovery the on-install registration alone can't cover.
  if (response === null) {
    console.log("[ytt-bg] caption fast-path: no listener — injecting + retrying", { tabId: tab.id });
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
        injectImmediately: true,
      });
      // Fresh content script needs a beat to attach the message listener.
      await new Promise((r) => setTimeout(r, 100));
      response = await sendMessageWithTimeout(
        tab.id,
        { type: "EXTRACT_CAPTIONS" },
        CAPTION_EXTRACT_TIMEOUT_MS
      );
    } catch (err) {
      console.log("[ytt-bg] caption fast-path: inject failed", err?.message || err);
      return null;
    }
  }
  console.log("[ytt-bg] caption fast-path response", {
    tabId: tab.id,
    ok: !!response?.ok,
    segments: Array.isArray(response?.segments) ? response.segments.length : 0,
    error: response?.error || null,
  });
  if (!response?.ok || !Array.isArray(response.segments) || !response.segments.length) {
    return null;
  }
  return {
    segments: response.segments,
    languageCode: response.languageCode || "",
    isAutoGenerated: !!response.isAutoGenerated,
  };
}

async function pollUntilDone(id, config) {
  const maxAttempts = 120; // 6 minutes at 3s intervals
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const res = await fetch(`${config.baseUrl}/api/transcripts/${id}`, {
        headers: config.headers,
        credentials: config.credentials,
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
  if (status === 401) return "Sign in at transcribed.dev to continue.";
  if (status === 429) return "Quota reached. Upgrade your plan at transcribed.dev/pricing";
  if (status >= 500) return "Cloud service error. Try again in a moment.";
  return data?.error || `HTTP ${status}`;
}

async function getRecent() {
  const config = await getApiConfig();
  const res = await fetch(`${config.baseUrl}/api/transcripts`, {
    headers: config.headers,
    credentials: config.credentials,
  });
  if (!res.ok) throw new Error(await classifyError(res.status, {}));
  const all = await res.json();
  return all.slice(0, 5);
}

async function getTranscript(id) {
  const config = await getApiConfig();
  const res = await fetch(`${config.baseUrl}/api/transcripts/${id}`, {
    headers: config.headers,
    credentials: config.credentials,
  });
  if (!res.ok) throw new Error(await classifyError(res.status, {}));
  return await res.json();
}

async function getPreferences() {
  const config = await getApiConfig();
  if (config.mode !== "cloud") return { summarizePrompt: null };
  try {
    const res = await fetch(`${config.baseUrl}/api/preferences`, {
      headers: config.headers,
      credentials: config.credentials,
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { summarizePrompt: null };
    return await res.json();
  } catch {
    return { summarizePrompt: null };
  }
}

async function checkExisting(videoId) {
  const config = await getApiConfig();
  const res = await fetch(`${config.baseUrl}/api/transcripts`, {
    headers: config.headers,
    credentials: config.credentials,
  });
  if (!res.ok) return null;
  const all = await res.json();
  // "Done" if the record explicitly says so OR if the backend returns no
  // status field at all. The local server schema (transcriber-local
  // prisma/schema.prisma Video) has no status column — every local record
  // is implicitly complete the moment it's saved (no async worker hop). A
  // strict `=== "done"` check would silently hide the "Already transcribed"
  // link for every video in local mode. Only excludes records that say
  // "processing" or "error" explicitly.
  return (
    all.find(
      (t) => t.videoId === videoId && (t.status === "done" || !t.status)
    ) || null
  );
}

// ---------------------------------------------------------------------------
// Destination adapters (YTT-205 §2) — cloud-hosted registry per YTT-211.
// Extension is a thin client: cloud owns OAuth tokens, client_secret, and the
// actual send() implementations. Obsidian scheme URLs are built server-side
// and opened client-side via chrome.tabs.create.
// ---------------------------------------------------------------------------

const DESTINATIONS_UNAVAILABLE = {
  ok: false,
  unavailable: true,
  error: "Destinations not yet available",
};

// Track the last OAuth popup window so we can close stale ones on retry and
// force-close on OAUTH_RETURN in case destination-connected.html couldn't.
let oauthWindowId = null;

async function closeOauthWindow() {
  if (oauthWindowId == null) return;
  try {
    await chrome.windows.remove(oauthWindowId);
  } catch {
    // Already closed by the user or by destination-connected.js — ignore.
  }
  oauthWindowId = null;
}

async function destinationsFetch(path, init = {}) {
  const config = await getApiConfig();
  if (config.mode !== "cloud") return DESTINATIONS_UNAVAILABLE;
  try {
    const res = await fetch(`${config.baseUrl}/api/destinations${path}`, {
      credentials: config.credentials,
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...config.headers,
        ...(init.headers || {}),
      },
    });
    if (res.status === 401) {
      return { ok: false, authError: true, error: "Sign in at transcribed.dev to continue." };
    }
    // 204 No Content (e.g. DELETE /connection) — no body to parse.
    if (res.status === 204) return { ok: true, data: {} };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch {
    return DESTINATIONS_UNAVAILABLE;
  }
}

async function listDestinations() {
  const res = await destinationsFetch("");
  if (!res.ok) return res;
  return { ok: true, destinations: Array.isArray(res.data) ? res.data : [] };
}

async function startDestinationOauth(adapterId) {
  // Cloud redirects here after the provider callback. Must match the
  // server-side allowlist (chrome-extension://* is whitelisted).
  const returnUrl = chrome.runtime.getURL("destination-connected.html");
  return await destinationsFetch(
    `/${encodeURIComponent(adapterId)}/oauth/start`,
    { method: "POST", body: JSON.stringify({ returnUrl }) }
  );
}

async function disconnectDestination(adapterId) {
  return await destinationsFetch(
    `/${encodeURIComponent(adapterId)}/connection`,
    { method: "DELETE" }
  );
}

// ---------------------------------------------------------------------------
// Obsidian — client-side adapter. No cloud, no OAuth. The extension builds an
// obsidian:// URL from the user's vault name + the transcript and hands it
// off to the OS, which launches Obsidian to create the note. Works across
// Mac/Linux/Windows — the extension code is identical, Obsidian's installer
// registers the URL scheme per platform.
//
// URL content length is capped around 30 KB for the `content=` param before
// running into kernel argv / browser URL limits. Long transcripts fall back
// to a clipboard-based flow: open an empty note, paste with ⌘V.
// ---------------------------------------------------------------------------

const OBSIDIAN_CONTENT_URL_CAP = 30 * 1024; // encoded chars, leave headroom

// Break segments into paragraphs so the note is readable rather than a
// single wall of text. Heuristics (first match wins):
//   1. Speaker change — prepend **Speaker:** label, start a new paragraph
//   2. Time gap > ~75s since the current paragraph began (if timestamps
//      exist) — start a new paragraph
//   3. Fallback cap of 18 segments per paragraph so untimed captions still
//      get broken up
// Thresholds chosen for human readability — 2-3 sentence paragraphs feel
// choppy when the underlying speech runs on a single thought; ~75s lets a
// full beat land before breaking.
function segmentsToMarkdown(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return "";

  const PARAGRAPH_TIME_SECS = 75;
  const PARAGRAPH_SEGMENT_CAP = 18;
  const paragraphs = [];
  let current = [];
  let currentStart = null;
  let lastSpeaker = null;

  const flush = () => {
    if (current.length > 0) {
      paragraphs.push(current.join(" ").trim());
      current = [];
      currentStart = null;
    }
  };

  for (const s of segments) {
    const text = (s && typeof s.text === "string" ? s.text : "").trim();
    if (!text) continue;

    const start = typeof s.start === "number" ? s.start : null;
    const speakerChanged = s.speaker && s.speaker !== lastSpeaker;
    const timeGap =
      currentStart !== null &&
      start !== null &&
      start - currentStart > PARAGRAPH_TIME_SECS;
    const segmentCapHit = current.length >= PARAGRAPH_SEGMENT_CAP;

    if (current.length > 0 && (speakerChanged || timeGap || segmentCapHit)) {
      flush();
    }

    if (currentStart === null) currentStart = start;

    const prefixed = speakerChanged && s.speaker
      ? `**${s.speaker}:** ${text}`
      : text;
    current.push(prefixed);
    if (s.speaker) lastSpeaker = s.speaker;
  }
  flush();

  return paragraphs.join("\n\n");
}

function buildObsidianMarkdown(transcript) {
  let segments = [];
  try {
    segments = JSON.parse(transcript.transcript || "[]");
  } catch {
    segments = [];
  }
  const body = segmentsToMarkdown(segments);
  // Drop the H1 — Obsidian already shows the filename in the tab bar, so
  // repeating it inside the note is noise.
  const meta = [];
  if (transcript.author) meta.push(`**By:** ${transcript.author}`);
  if (transcript.videoUrl) meta.push(`**Source:** ${transcript.videoUrl}`);
  if (transcript.createdAt) {
    const d = new Date(transcript.createdAt);
    if (!Number.isNaN(d.getTime())) {
      meta.push(`**Recorded:** ${d.toISOString().slice(0, 10)}`);
    }
  }
  return meta.length ? `${meta.join("\n")}\n\n${body}` : body;
}

async function buildObsidianSend(transcriptId) {
  const { obsidianVaultName, obsidianUseAdvancedUri } =
    await chrome.storage.sync.get([
      "obsidianVaultName",
      "obsidianUseAdvancedUri",
    ]);
  const vault = (obsidianVaultName || "").trim();
  if (!vault) {
    return {
      ok: false,
      error: "Set your Obsidian vault name in Settings first",
      needsVaultName: true,
    };
  }

  let transcript;
  try {
    transcript = await getTranscript(transcriptId);
  } catch (err) {
    return { ok: false, error: err.message || "Couldn't load transcript" };
  }

  const markdown = buildObsidianMarkdown(transcript);
  // Strip filesystem-illegal characters. `\ / :` are rejected on macOS/Linux;
  // `| ? " < > *` are additionally rejected on Windows. Obsidian enforces the
  // cross-platform union so a note typed in on Mac syncs to a Windows client.
  const fileName = (transcript.title || "Transcript")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Transcript";

  const encodedContent = encodeURIComponent(markdown);
  const shortFits = encodedContent.length <= OBSIDIAN_CONTENT_URL_CAP;

  // Advanced URI plugin path — user opted in, meaning they've installed the
  // community plugin `obsidian-advanced-uri`. Its `clipboard=true&mode=new`
  // combo makes Obsidian auto-paste the clipboard into the new note, so the
  // user never has to press ⌘V.
  if (obsidianUseAdvancedUri) {
    const advFilePath = encodeURIComponent(`${fileName}.md`);
    const advParams = `vault=${encodeURIComponent(vault)}&filepath=${advFilePath}`;
    if (shortFits) {
      return {
        ok: true,
        data: {
          schemeUrl: `obsidian://advanced-uri?${advParams}&data=${encodedContent}&mode=new`,
        },
      };
    }
    return {
      ok: true,
      data: {
        schemeUrl: `obsidian://advanced-uri?${advParams}&clipboard=true&mode=new`,
        clipboardText: markdown,
        autoPaste: true,
      },
    };
  }

  // Default `obsidian://new` path. No plugin required, but long transcripts
  // need the user to ⌘V inside Obsidian.
  const baseParams = `vault=${encodeURIComponent(vault)}&name=${encodeURIComponent(fileName)}`;
  if (shortFits) {
    return {
      ok: true,
      data: {
        schemeUrl: `obsidian://new?${baseParams}&content=${encodedContent}`,
      },
    };
  }
  return {
    ok: true,
    data: {
      schemeUrl: `obsidian://new?${baseParams}`,
      clipboardText: markdown,
      pasteHint: true,
    },
  };
}

async function sendToDestination(adapterId, transcriptId, opts) {
  // Notion's target database is provisioned server-side during OAuth (via the
  // integration's Template page duplication) and stored in DestinationToken
  // config. No client-side picker — cloud adapter resolves databaseId from
  // config when opts.databaseId is missing.
  const res = await destinationsFetch("/send", {
    method: "POST",
    body: JSON.stringify({ adapterId, transcriptId, opts: opts || {} }),
  });
  if (!res.ok) return res;

  // Obsidian scheme case — cloud built the URL, client opens it.
  const payload = res.data || {};
  if (payload.schemeUrl && typeof payload.schemeUrl === "string") {
    try {
      await chrome.tabs.create({ url: payload.schemeUrl, active: true });
    } catch (err) {
      return { ok: false, error: `Couldn't open Obsidian: ${err.message}` };
    }
  }
  return { ok: true, data: payload };
}

// ---------------------------------------------------------------------------
// Toast — chrome.notifications wrapper. `notifications` is declared in
// optional_permissions; request on first use and fall back to badge if denied.
// ---------------------------------------------------------------------------

async function showToast({ title, message, kind = "info" }) {
  const perm = { permissions: ["notifications"] };
  let granted = false;
  try {
    granted = await chrome.permissions.contains(perm);
  } catch { /* ignore */ }
  if (!granted) {
    try {
      granted = await chrome.permissions.request(perm);
    } catch { /* ignore */ }
  }
  if (!granted) {
    // Fallback: quick badge flash so the user still gets feedback.
    const color = kind === "error" ? "#ef4444" : "#22c55e";
    const text = kind === "error" ? "!" : "✓";
    setBadge(text, color);
    setTimeout(() => setBadge(""), 3000);
    return;
  }
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: title || "Transcriber",
      message: message || "",
      priority: kind === "error" ? 2 : 0,
    });
  } catch { /* ignore notification failures */ }
}

// ---------------------------------------------------------------------------
// LLM prompt handoff — popup stashes the built prompt here, content script
// on the provider (claude.ai, chatgpt.com) pulls it after the page loads and
// injects into the composer. Uses chrome.storage.session so the prompt
// survives a service-worker restart but never persists to disk. A short TTL
// guards against orphaned prompts if the user closes the provider tab before
// the content script claims.
// ---------------------------------------------------------------------------

const HANDOFF_KEY_PREFIX = "llmHandoff_";
const HANDOFF_TTL_MS = 60 * 1000;

function randomHandoffToken() {
  // 22-char URL-safe token — collision resistant enough for a 60s TTL.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function stashHandoffPrompt(prompt) {
  const token = randomHandoffToken();
  const key = HANDOFF_KEY_PREFIX + token;
  await chrome.storage.session.set({
    [key]: { prompt, expiresAt: Date.now() + HANDOFF_TTL_MS },
  });
  setTimeout(() => {
    chrome.storage.session.remove(key).catch(() => {});
  }, HANDOFF_TTL_MS);
  return token;
}

async function claimHandoffPrompt(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{10,64}$/.test(token)) {
    return null;
  }
  const key = HANDOFF_KEY_PREFIX + token;
  const stored = await chrome.storage.session.get(key);
  const entry = stored[key];
  if (!entry) return null;
  await chrome.storage.session.remove(key);
  if (entry.expiresAt && entry.expiresAt < Date.now()) return null;
  return entry.prompt || null;
}

// ---------------------------------------------------------------------------
// Core transcribe — runs in background, persists state
// ---------------------------------------------------------------------------

async function doTranscribe(url, title) {
  console.log("[ytt-bg] doTranscribe start", {
    url,
    videoId: youtubeVideoId(url),
    title: title || "",
  });
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
    // Fast path: scrape captions client-side via the YouTube tab and send
    // them along with the transcribe request. Server-side caption fetch is
    // a wasted round-trip when the page already has them. Falls back
    // silently if no captions are available or anything goes wrong.
    const t0 = performance.now();
    const captions = await tryExtractCaptions(url);
    const tCaptions = performance.now() - t0;
    const extras = captions ? { ...captions, title: title || "" } : {};
    const tReq = performance.now();
    const data = await transcribeRequest(url, extras);
    const tServer = performance.now() - tReq;
    const tTotal = performance.now() - t0;
    const benchmark = {
      ts: Date.now(),
      url,
      videoId: youtubeVideoId(url),
      pathway: captions ? "captions-client" : "server",
      captionTracks: captions ? captions.segments?.length || 0 : 0,
      isAutoGenerated: captions?.isAutoGenerated ?? null,
      timings: {
        captionScrapeMs: Math.round(tCaptions),
        serverRequestMs: Math.round(tServer),
        totalMs: Math.round(tTotal),
      },
    };
    console.log("[transcribe-bench]", benchmark);
    // Persist last 20 benchmark records for in-panel debug surfacing.
    try {
      const { transcribeBench } = await chrome.storage.local.get("transcribeBench");
      const arr = Array.isArray(transcribeBench) ? transcribeBench : [];
      arr.push(benchmark);
      while (arr.length > 20) arr.shift();
      await chrome.storage.local.set({ transcribeBench: arr });
    } catch { /* benchmark logging is best-effort */ }
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
    console.warn("[ytt-bg] doTranscribe failed", {
      url,
      message: err?.message || String(err),
    });
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
// Message payload validation
// Content scripts run in pages we don't control (YouTube / Spotify DOM),
// so every string that crosses the background boundary gets type- and
// shape-checked. Popup messages are validated the same way for defense
// in depth and consistent error surfaces.
// ---------------------------------------------------------------------------

const MAX_URL_LEN = 2048;
const MAX_TITLE_LEN = 512;
const ID_MAX_LEN = 128;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isStr(v, maxLen) {
  return typeof v === "string" && v.length > 0 && v.length <= maxLen;
}

function validHttpUrl(u) {
  if (!isStr(u, MAX_URL_LEN)) return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function clampTitle(t) {
  if (typeof t !== "string") return "";
  return t.length > MAX_TITLE_LEN ? t.slice(0, MAX_TITLE_LEN) : t;
}

function validId(id) {
  return isStr(id, ID_MAX_LEN) && ID_PATTERN.test(id);
}

function validMode(m) {
  return m === "cloud" || m === "local";
}

const ADAPTER_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
function validAdapterId(id) {
  return typeof id === "string" && ADAPTER_ID_PATTERN.test(id);
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Reject anything not shaped like { type: string }
  if (!message || typeof message.type !== "string") {
    sendResponse({ success: false, error: "Invalid message" });
    return false;
  }

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

      case "SEND_MAGIC_LINK":
        return await sendMagicLink(message.email);

      case "OPEN_GOOGLE_SIGNIN":
        return await openGoogleSignin();

      case "TRANSCRIBE": {
        if (!validHttpUrl(message.url)) {
          throw new Error("Invalid url");
        }
        return await doTranscribe(message.url, clampTitle(message.title));
      }

      case "GET_TRANSCRIPTION_STATUS":
        return await getState();

      case "CLEAR_TRANSCRIPTION":
        await clearState();
        setBadge("");
        return { ok: true };

      case "GET_RECENT":
        return await getRecent();

      case "GET_TRANSCRIPT": {
        if (!validId(message.id)) throw new Error("Invalid id");
        return await getTranscript(message.id);
      }

      case "GET_PREFERENCES":
        return await getPreferences();

      case "CHECK_EXISTING": {
        if (!validId(message.videoId)) throw new Error("Invalid videoId");
        return await checkExisting(message.videoId);
      }

      case "QUEUE_ADD": {
        if (!validHttpUrl(message.url)) {
          throw new Error("Invalid url");
        }
        const queue = await getQueue();
        const already = queue.some((q) => q.url === message.url);
        if (!already) {
          queue.push({ url: message.url, title: clampTitle(message.title) });
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
        if (!validId(message.id)) throw new Error("Invalid id");
        const transcriptId = message.id;
        const config = await getApiConfig();
        const appBase = config.mode === "cloud" ? CLOUD_BASE : LOCAL_BASE;
        // Append timestamp to bust Chrome's same-URL no-op optimization
        const fullUrl = `${appBase}/?layout=list&id=${encodeURIComponent(transcriptId)}&t=${Date.now()}`;

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
      case "PAGE_CHANGED": {
        // Content scripts run in untrusted YouTube/Spotify DOM — validate
        // every string before persisting. Silently drop malformed payloads
        // instead of erroring so a hostile page can't spam the console.
        if (!sender.tab?.id) return { ok: true };
        if (!validHttpUrl(message.url)) return { ok: true };
        const vid = typeof message.videoId === "string" ? message.videoId : null;
        if (vid !== null && !validId(vid)) return { ok: true };
        await chrome.storage.session.set({
          [`tab_${sender.tab.id}`]: {
            url: message.url,
            title: clampTitle(message.title),
            videoId: vid,
            isLive: !!message.isLive,
          },
        });
        return { ok: true };
      }

      case "GET_SETTINGS": {
        const { mode } = await chrome.storage.sync.get(["mode"]);
        return { mode: mode || "cloud" };
      }

      case "DETECT_LOCAL": {
        const localAvailable = await detectLocalInstance();
        return { available: localAvailable };
      }

      case "SAVE_SETTINGS": {
        const settings = {};
        if (message.mode !== undefined) {
          if (!validMode(message.mode)) throw new Error("Invalid mode");
          settings.mode = message.mode;
        }
        await chrome.storage.sync.set(settings);
        _apiConfigCache = null;
        return { ok: true };
      }

      case "LIST_DESTINATIONS":
        return await listDestinations();

      case "START_DESTINATION_OAUTH": {
        if (!validAdapterId(message.adapterId)) throw new Error("Invalid adapterId");
        const res = await startDestinationOauth(message.adapterId);
        if (res.ok && res.data?.authUrl && typeof res.data.authUrl === "string") {
          // Close any lingering popup from a prior attempt so the user doesn't
          // end up with a stale provider error tab after a successful retry.
          await closeOauthWindow();
          try {
            const win = await chrome.windows.create({
              url: res.data.authUrl,
              type: "popup",
              width: 500,
              height: 700,
            });
            oauthWindowId = win?.id ?? null;
          } catch (err) {
            return { ok: false, error: `Couldn't open auth window: ${err.message}` };
          }
        }
        return res;
      }

      case "OAUTH_RETURN": {
        // Sent by destination-connected.html after cloud redirects back. Popup also
        // listens directly so settings UI can re-render; background just
        // acks + force-closes the window in case the landing page couldn't
        // close itself (stale popup from earlier attempt, etc).
        await closeOauthWindow();
        return { ok: true };
      }

      case "DISCONNECT_DESTINATION": {
        if (!validAdapterId(message.adapterId)) throw new Error("Invalid adapterId");
        return await disconnectDestination(message.adapterId);
      }

      case "SEND_TO_DESTINATION": {
        if (!validAdapterId(message.adapterId)) throw new Error("Invalid adapterId");
        if (!validId(message.transcriptId)) throw new Error("Invalid transcriptId");

        // Obsidian is a client-side URL-scheme adapter. Build the payload
        // here but let the popup handle clipboard write + tab open because
        // service workers can't write the clipboard.
        if (message.adapterId === "obsidian-scheme") {
          const res = await buildObsidianSend(message.transcriptId);
          if (res.ok) {
            showToast({
              title: "Sent to Obsidian",
              message: res.data.pasteHint
                ? "Paste in Obsidian with ⌘V"
                : "Note created in your vault",
              kind: "info",
            });
          } else {
            showToast({
              title: "Send failed",
              message: res.error || "Couldn't send to Obsidian",
              kind: "error",
            });
          }
          return res;
        }

        const res = await sendToDestination(
          message.adapterId,
          message.transcriptId,
          message.opts
        );
        if (res.ok) {
          showToast({
            title: "Sent",
            message: message.destinationName
              ? `Sent to ${message.destinationName}`
              : "Transcript sent",
            kind: "info",
          });
        } else if (res.needsConfig) {
          showToast({
            title: "Needs setup",
            message: res.error || "Configure this destination in Settings.",
            kind: "error",
          });
        } else if (!res.unavailable && !res.authError) {
          showToast({
            title: "Send failed",
            message: res.error || "Couldn't send transcript",
            kind: "error",
          });
        }
        return res;
      }

      case "STASH_LLM_PROMPT": {
        if (typeof message.prompt !== "string" || !message.prompt.trim()) {
          throw new Error("Invalid prompt");
        }
        const token = await stashHandoffPrompt(message.prompt);
        return { token };
      }

      case "CLAIM_LLM_PROMPT": {
        const prompt = await claimHandoffPrompt(message.token);
        return { prompt };
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
