importScripts(
  "local-auth-headers.js",
  "send-url.js",
  "connect-target.js",
  "local-mode-lock.js",
  "target-client.js"
);

const CAPTION_EXTRACT_TIMEOUT_MS = 2500;

let _pairAttempted = false;

async function resolveTarget() {
  const stored = await chrome.storage.local.get(ConnectTarget.STORAGE_KEY);
  return ConnectTarget.getTarget(ConnectTarget.normalize(stored[ConnectTarget.STORAGE_KEY]));
}

/** Only the packaged app has a pairing endpoint; the dev host is paired by its installer. */
async function requestNativeHostPairOnce(target) {
  if (target.id !== ConnectTarget.APP || _pairAttempted) return false;
  _pairAttempted = true;
  try {
    await fetch(ConnectTarget.getTarget(ConnectTarget.APP).pairUrl, { method: "POST" });
    return true;
  } catch {
    // App may not be running yet.
    return false;
  }
}

function callNativeHostCmd(cmd, payload = {}, timeoutMs = 5000, hostName) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connectNative(hostName);
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

// In-memory only — never persist the loopback token (YTT-435 / YTT-442).
const targetClient = TargetClient.create({
  ConnectTarget,
  callHost: (hostName, cmd, payload, timeoutMs) =>
    callNativeHostCmd(cmd, payload, timeoutMs, hostName),
  fetch: (url, init) => fetch(url, init),
  pair: requestNativeHostPairOnce,
});

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
    const tabs = await chrome.tabs.query({ url: ["*://*.youtube.com/*", "*://m.youtube.com/*"] });
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

async function tryExtractCaptions(url, title) {
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
  if (response === null) {
    console.log("[ytt-bg] caption fast-path: no listener — injecting + retrying", { tabId: tab.id });
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
        injectImmediately: true,
      });
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
    title: title || "",
    languageCode: response.languageCode || "",
    isAutoGenerated: !!response.isAutoGenerated,
  };
}

function clearLocalTokenMemory() {
  targetClient.clearTokens();
}

importScripts("linkedin-url.js", "linkedin-capture.js");

async function sendPageUrl(pageUrl, title) {
  const target = await resolveTarget();
  const auth = await targetClient.authFor(target);
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const isLinkedIn = isLinkedInPageUrl(pageUrl);
  let request;
  if (isLinkedIn) {
    request = await prepareLinkedInSend(pageUrl, auth.token, target.apiBase);
  } else {
    // Try caption extraction for YouTube URLs
    const captions = youtubeVideoId(pageUrl) ? await tryExtractCaptions(pageUrl, title) : null;
    request = auth.token
      ? buildLocalSendRequest(pageUrl, auth.token, captions, target.apiBase)
      : buildTokenlessDevSendRequest(pageUrl, captions);
  }
  if (!request.ok) {
    // Request build failed (bad URL etc.)
    return { ok: false, reason: "other", ...(request.error ? { error: request.error } : {}) };
  }

  const sent = await targetClient.send(
    target,
    request.url,
    { method: "POST", headers: request.headers, body: request.body },
    auth
  );
  if (!sent.ok) return { ok: false, reason: sent.reason };
  const res = sent.res;

  if (!res.ok) {
    // YTT-448: Never return server error text
    if (isLinkedIn && res.status === 422) return { ok: false, reason: "other", error: LINKEDIN_ERRORS.server };
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

async function apiGet(path, timeoutMs) {
  const target = await resolveTarget();
  const init = { method: "GET" };
  if (timeoutMs) init.signal = AbortSignal.timeout(timeoutMs);
  return targetClient.apiFetch(target, path, init);
}

async function checkService() {
  const r = await apiGet("/api/health", 3000);
  const mode = LocalModeLock.resolveMode();
  if (!r.ok) {
    return {
      online: false,
      mode,
      reason: r.reason,
      authError: r.reason === "unauthorized",
    };
  }
  const res = r.res;
  if (res.ok) {
    try {
      const data = await res.json();
      if (data.projectPath) {
        chrome.storage.local.set({ projectPath: data.projectPath });
      }
    } catch {
      /* health body is optional */
    }
  }
  const online = res.ok || res.status === 503;
  return { online, mode, reason: online ? null : "unreachable", tokenless: r.tokenless };
}

async function apiJson(path) {
  const r = await apiGet(path);
  if (!r.ok) throw new Error(ConnectTarget.errorMessage(r.reason, (await resolveTarget()).id));
  if (!r.res.ok) throw new Error(`HTTP ${r.res.status}`);
  return r.res.json();
}

async function getRecent() {
  const all = await apiJson("/api/transcripts");
  return all.slice(0, 5);
}

async function checkExisting(videoId) {
  let all;
  try {
    all = await apiJson("/api/transcripts");
  } catch {
    return null;
  }
  return all.find((t) => t.videoId === videoId) || null;
}

async function targetStatuses() {
  const ids = [ConnectTarget.APP, ConnectTarget.DEV];
  const results = await Promise.all(
    ids.map((id) => targetClient.probe(ConnectTarget.getTarget(id)))
  );
  return Object.fromEntries(results.map((r) => [r.id, r]));
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
    
    // Host and auth problems get their own message; only "other" is generic.
    const target = await resolveTarget();
    state.error = ConnectTarget.errorMessage(result.reason || "other", target.id);
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender?.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: "Invalid sender" });
    return;
  }

  const handle = async () => {
    switch (message.type) {
      case "SEND_PAGE_URL":
        return await sendPageUrl(message.url, message.title);

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
        const target = await resolveTarget();
        const fullUrl = `${target.apiBase}/?layout=list&id=${encodeURIComponent(transcriptId)}&t=${Date.now()}`;
        const allTabs = await chrome.tabs.query({});
        const appTab = allTabs.find((t) => {
          try {
            const url = new URL(t.url || "");
            return url.hostname === "127.0.0.1" && url.port === target.port;
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

      case "GET_SETTINGS": {
        // LOCAL build: ignore leftover chrome.storage.sync.mode from a
        // dual-mode install. Cloud sign-in is never a valid panel mode.
        return { mode: LocalModeLock.resolveMode() };
      }

      case "SAVE_SETTINGS": {
        await chrome.storage.sync.set({ mode: LocalModeLock.resolveMode() });
        return { ok: true };
      }

      case "GET_TRANSCRIPT": {
        const transcriptId = message.id;
        if (typeof transcriptId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(transcriptId)) {
          throw new Error("Invalid transcript id");
        }
        const data = await apiJson(`/api/transcripts/${encodeURIComponent(transcriptId)}`);
        return { transcript: data.transcript, title: data.title };
      }

      case "TARGET_STATUS":
        return await targetStatuses();

      case "START_TARGET": {
        const target = await resolveTarget();
        const r = await targetClient.start(target);
        return r.ok
          ? { ok: true, targetId: target.id }
          : {
              ok: false,
              targetId: target.id,
              reason: r.reason,
              message: ConnectTarget.errorMessage(r.reason, target.id),
            };
      }

      case "STOP_TARGET": {
        const target = await resolveTarget();
        const r = await targetClient.stop(target);
        return r.ok
          ? { ok: true }
          : { ok: false, reason: r.reason, message: ConnectTarget.errorMessage(r.reason, target.id) };
      }

      case "CALL_NATIVE_HOST": {
        try {
          const hostName = (await resolveTarget()).nativeHostName;
          const result = await callNativeHostCmd(
            message.cmd,
            message.payload,
            message.timeoutMs || 5000,
            hostName
          );
          return { ok: true, result };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }

      case "CLEAR_LOCAL_TOKEN":
        clearLocalTokenMemory();
        return { ok: true };

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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[ConnectTarget.STORAGE_KEY]) {
    clearLocalTokenMemory();
  }
});

chrome.sidePanel.setOptions({ path: "popup.html", enabled: true }).catch(() => {});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch(() => {});

chrome.action.onClicked.addListener((tab) => {
  if (!Number.isInteger(tab.windowId)) return;
  chrome.sidePanel.open({ windowId: tab.windowId });
});
