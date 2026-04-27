function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.pathname === "/watch") return u.searchParams.get("v");
    if (u.pathname.startsWith("/shorts/"))
      return u.pathname.split("/shorts/")[1]?.split("/")[0];
    if (u.pathname.startsWith("/embed/"))
      return u.pathname.split("/embed/")[1]?.split("/")[0];
  } catch {
    // ignore
  }
  return null;
}

function getVideoTitle() {
  const meta = document.querySelector('meta[name="title"]');
  if (meta?.content) return meta.content;
  const h1 = document.querySelector(
    "h1.ytd-watch-metadata yt-formatted-string"
  );
  if (h1?.textContent) return h1.textContent.trim();
  return document.title.replace(" - YouTube", "").trim();
}

function isLiveStream() {
  // YouTube player has a .ytp-live class when playing a live stream
  const player = document.getElementById("movie_player");
  if (!player?.classList.contains("ytp-live")) return false;
  // Confirm with the live badge — it must exist, not be disabled, and be visible.
  // YouTube keeps .ytp-live-badge in the DOM for premiered/VOD videos but hides
  // it or sets the disabled attribute.
  const badge = document.querySelector(".ytp-live-badge");
  if (!badge) return false;
  if (badge.hasAttribute("disabled")) return false;
  if (badge.offsetParent === null && getComputedStyle(badge).display === "none") return false;
  return true;
}

function reportPageInfo() {
  const videoId = extractVideoId(window.location.href);
  try {
    chrome.runtime.sendMessage({
      type: "PAGE_INFO",
      url: window.location.href,
      title: getVideoTitle(),
      videoId: videoId,
      isLive: videoId ? isLiveStream() : false,
    });
  } catch {
    // Extension context invalidated (reloaded) — stop observing
    observer?.disconnect();
  }
}

// Initial report
reportPageInfo();

// YouTube SPA navigation — MutationObserver
let lastUrl = window.location.href;
let observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    setTimeout(reportPageInfo, 800);
  }
});
observer.observe(document.body, { childList: true, subtree: true });

// YouTube's own navigation event
window.addEventListener("yt-navigate-finish", () => {
  setTimeout(reportPageInfo, 300);
});

// Close side panel when entering fullscreen
function closePanel() {
  try {
    chrome.runtime.sendMessage({ type: "CLOSE_PANEL" });
  } catch { /* ignore */ }
}

function onFullscreenChange() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    closePanel();
  }
}
document.addEventListener("fullscreenchange", onFullscreenChange);
document.addEventListener("webkitfullscreenchange", onFullscreenChange);

// YouTube's player class changes when entering fullscreen
const ytObserver = new MutationObserver(() => {
  const player = document.getElementById("movie_player");
  if (player?.classList.contains("ytp-fullscreen")) {
    closePanel();
  }
});
function watchPlayer() {
  const player = document.getElementById("movie_player");
  if (player) {
    ytObserver.observe(player, { attributes: true, attributeFilter: ["class"] });
  } else {
    setTimeout(watchPlayer, 1000);
  }
}
watchPlayer();

// Catch YouTube's 'f' fullscreen shortcut — close panel after a short delay
// to let YouTube's fullscreen kick in
document.addEventListener("keydown", (e) => {
  if (e.key === "f" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const tag = e.target?.tagName;
    // Only act if not typing in an input/textarea
    if (tag !== "INPUT" && tag !== "TEXTAREA" && !e.target?.isContentEditable) {
      setTimeout(closePanel, 100);
    }
  }
});

// ---------------------------------------------------------------------------
// Client-side caption scrape (fast path).
//
// content-captions-main.js (MAIN world) reads window.ytInitialPlayerResponse
// and dispatches "ytt-captions-tracks" with caption track metadata. We cache
// the latest snapshot here and expose an EXTRACT_CAPTIONS message handler
// that fetches the chosen track's JSON3 timed-text URL and parses to
// segments. Background uses this to skip the server-side caption fetch when
// the page already has captions, matching competitors' "instant transcript"
// UX for caption-able videos.
// ---------------------------------------------------------------------------

// Tag the cache with the videoId it came from so SPA navigation can't serve
// up the previous video's tracks. extractVideoId() is defined at the top of
// this file.
let captionTracksCache = { videoId: null, tracks: [] };
let captionTracksWaiters = [];

document.addEventListener("ytt-captions-tracks", (e) => {
  const tracks = e?.detail?.tracks;
  if (!Array.isArray(tracks)) return;
  captionTracksCache = {
    videoId: extractVideoId(window.location.href),
    tracks,
  };
  // Wake any EXTRACT_CAPTIONS handlers awaiting a fresh dispatch.
  const waiters = captionTracksWaiters;
  captionTracksWaiters = [];
  for (const resolve of waiters) {
    try { resolve(); } catch { /* ignore */ }
  }
});

function awaitCaptionsRefresh(timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    captionTracksWaiters.push(() => {
      if (settled) return;
      settled = true;
      resolve();
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve();
    }, timeoutMs);
  });
}

function pickCaptionTrack(tracks, preferredLang) {
  if (!tracks?.length) return null;
  if (preferredLang) {
    const exact = tracks.find(
      (t) => t.languageCode?.toLowerCase() === preferredLang.toLowerCase()
    );
    if (exact) return exact;
    // Try language root (e.g. "en" matching "en-US")
    const root = preferredLang.split("-")[0].toLowerCase();
    const partial = tracks.find(
      (t) => t.languageCode?.toLowerCase().split("-")[0] === root
    );
    if (partial) return partial;
  }
  // Prefer manual (non-ASR) captions over auto-generated.
  const manual = tracks.find((t) => t.kind !== "asr");
  return manual || tracks[0];
}

function parseJson3Captions(data) {
  const events = data?.events || [];
  const segments = [];
  for (const ev of events) {
    if (!ev?.segs || !Array.isArray(ev.segs)) continue;
    const text = ev.segs
      .map((s) => s?.utf8 || "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    segments.push({
      start: (ev.tStartMs || 0) / 1000,
      duration: (ev.dDurationMs || 0) / 1000,
      text,
    });
  }
  return segments;
}

async function fetchCaptionsForTrack(track) {
  // Force JSON3 — easier to parse than the default XML format.
  const url = track.baseUrl + (track.baseUrl.includes("?") ? "&" : "?") + "fmt=json3";
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`captions fetch ${res.status}`);
  const data = await res.json();
  return parseJson3Captions(data);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "EXTRACT_CAPTIONS") return undefined;
  (async () => {
    try {
      const currentVid = extractVideoId(window.location.href);
      // Cache is stale if it's empty OR tagged with a previous video's id
      // (SPA navigation hasn't dispatched the new tracks yet). Nudge the
      // MAIN-world script and wait for the next dispatch before reading.
      const stale =
        !captionTracksCache.tracks.length ||
        captionTracksCache.videoId !== currentVid;
      if (stale) {
        document.dispatchEvent(new CustomEvent("ytt-captions-request"));
        await awaitCaptionsRefresh(600);
      }
      // After the wait, only trust the cache if it now matches the current
      // page. If not, the page either has no captions or the dispatch
      // didn't land in time — fall back to the server path.
      const fresh = captionTracksCache.videoId === currentVid
        ? captionTracksCache.tracks
        : [];
      if (!fresh.length) {
        sendResponse({ ok: false, error: "no_captions" });
        return;
      }
      const track = pickCaptionTrack(fresh, msg.preferredLang);
      if (!track?.baseUrl) {
        sendResponse({ ok: false, error: "no_captions" });
        return;
      }
      const segments = await fetchCaptionsForTrack(track);
      if (!segments.length) {
        sendResponse({ ok: false, error: "empty_captions" });
        return;
      }
      sendResponse({
        ok: true,
        segments,
        languageCode: track.languageCode || "",
        isAutoGenerated: track.kind === "asr",
      });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true; // async sendResponse
});
