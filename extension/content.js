function extractVideoId(url) {
  return youtubeVideoId(url);
}

function isYouTubeVideoPage(url) {
  return !!youtubeVideoId(url);
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
  const player = document.getElementById("movie_player");
  if (!player?.classList.contains("ytp-live")) return false;
  const badge = document.querySelector(".ytp-live-badge");
  if (!badge) return false;
  if (badge.hasAttribute("disabled")) return false;
  if (badge.offsetParent === null && getComputedStyle(badge).display === "none") return false;
  return true;
}

/** Fire-and-forget to the service worker. Side panel closed is normal. */
function sendRuntimeMessage(msg) {
  try {
    chrome.runtime.sendMessage(msg, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    observer?.disconnect();
  }
}

function reportPageInfo() {
  const videoId = extractVideoId(window.location.href);
  sendRuntimeMessage({
    type: "PAGE_INFO",
    url: window.location.href,
    title: getVideoTitle(),
    videoId: videoId,
    isLive: videoId ? isLiveStream() : false,
  });
}

reportPageInfo();

let lastUrl = window.location.href;
let observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    setTimeout(reportPageInfo, 800);
  }
});
observer.observe(document.body, { childList: true, subtree: true });

window.addEventListener("yt-navigate-finish", () => {
  setTimeout(reportPageInfo, 300);
});

function closePanel() {
  sendRuntimeMessage({ type: "CLOSE_PANEL" });
}

function onFullscreenChange() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    closePanel();
  }
}
document.addEventListener("fullscreenchange", onFullscreenChange);
document.addEventListener("webkitfullscreenchange", onFullscreenChange);

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

document.addEventListener("keydown", (e) => {
  if (e.key === "f" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const tag = e.target?.tagName;
    if (tag !== "INPUT" && tag !== "TEXTAREA" && !e.target?.isContentEditable) {
      setTimeout(closePanel, 100);
    }
  }
});

// ---------------------------------------------------------------------------
// Client-side transcript scrape (fast path).
//
// We open YouTube's "Show transcript" panel, wait for transcript rows to
// render, and read them straight from the DOM. Same data the page is about
// to display — no extra network call, no server round-trip, no auth.
// Background's EXTRACT_CAPTIONS message routes here; if scrape returns no
// segments, background falls back to its server transcribe path.
// ---------------------------------------------------------------------------

const CAPTIONS_DEBUG_PREFIX = "[ytt-content]";

function debugCaptionLog(message, extra = undefined) {
  try {
    if (extra === undefined) {
      console.log(`${CAPTIONS_DEBUG_PREFIX} ${message}`);
    } else {
      console.log(`${CAPTIONS_DEBUG_PREFIX} ${message}`, extra);
    }
  } catch { /* ignore console failures */ }
}

debugCaptionLog("script attached", {
  href: window.location.href,
  readyState: document.readyState,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTimestampToSeconds(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const parts = text.split(":").map((part) => Number(part.trim()));
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

const SEGMENT_TAG_SELECTOR =
  "transcript-segment-view-model, ytd-transcript-segment-renderer";

function extractTranscriptSegmentsFromDom(root = document) {
  const items = Array.from(root.querySelectorAll(SEGMENT_TAG_SELECTOR));
  const segments = [];
  for (const item of items) {
    const textEl =
      item.querySelector(".ytAttributedStringHost") ||
      item.querySelector(".segment-text") ||
      item.querySelector("#segment-text") ||
      item.querySelector("yt-formatted-string") ||
      item.querySelector("span[role='text']");
    const timeEl =
      item.querySelector(".ytwTranscriptSegmentViewModelTimestamp") ||
      item.querySelector(".segment-timestamp") ||
      item.querySelector("#segment-timestamp") ||
      item.querySelector("[class*='Timestamp']:not([class*='A11y'])") ||
      item.querySelector("[class*='timestamp']");
    const text = String(textEl?.textContent || "").replace(/\s+/g, " ").trim();
    const start = parseTimestampToSeconds(timeEl?.textContent || "");
    if (!text || start == null) continue;
    segments.push({ start, duration: 0, text });
  }
  for (let i = 0; i < segments.length; i++) {
    const next = segments[i + 1];
    if (next && next.start >= segments[i].start) {
      segments[i].duration = Math.max(0, next.start - segments[i].start);
    }
  }
  return segments;
}

function findTranscriptPanel() {
  const allPanels = document.querySelectorAll(
    "ytd-engagement-panel-section-list-renderer"
  );
  for (const panel of allPanels) {
    const vis = panel.getAttribute("visibility") || "";
    if (vis.includes("EXPANDED") && panel.querySelector(SEGMENT_TAG_SELECTOR)) {
      return panel;
    }
  }
  return document.querySelector(
    "ytd-engagement-panel-section-list-renderer[target-id*='transcript']"
  );
}

function isTranscriptPanelExpanded() {
  const allPanels = document.querySelectorAll(
    "ytd-engagement-panel-section-list-renderer"
  );
  for (const panel of allPanels) {
    const vis = panel.getAttribute("visibility") || "";
    if (vis.includes("EXPANDED") && panel.querySelector(SEGMENT_TAG_SELECTOR)) {
      return true;
    }
  }
  return false;
}

async function waitForTranscriptSegments(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const segments = extractTranscriptSegmentsFromDom(document);
    if (segments.length) return segments;
    await sleep(100);
  }
  return [];
}

function findClickableByText(textPattern) {
  const all = document.querySelectorAll(
    "button, tp-yt-paper-item, ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, ytd-button-renderer, yt-button-shape"
  );
  for (const el of all) {
    if (el.offsetParent === null) continue;
    if (getComputedStyle(el).display === "none") continue;
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    const text = String(el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (textPattern.test(aria) || textPattern.test(text)) {
      if (el.tagName === "BUTTON") return el;
      return el.querySelector("button") || el;
    }
  }
  return null;
}

function findShowTranscriptDirectButton() {
  return findClickableByText(/^show transcript\b|^transcript$/);
}

function findShowTranscriptMenuItem() {
  return findClickableByText(/show transcript/);
}

function findMoreActionsButton() {
  const selectors = [
    "#above-the-fold #actions button[aria-label='More actions']",
    "#above-the-fold #actions yt-button-shape button",
    "ytd-watch-metadata button[aria-label='More actions']",
    "ytd-watch-metadata button[aria-label='More']",
    "ytd-watch-metadata tp-yt-paper-button[aria-label='More actions']",
    "ytd-watch-metadata ytd-menu-renderer button[aria-label*='More']",
  ];
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (el.offsetParent !== null) return el;
    }
  }
  return null;
}

async function expandDescription() {
  const expander = document.querySelector(
    "ytd-watch-metadata tp-yt-paper-button#expand, ytd-text-inline-expander tp-yt-paper-button#expand, #description-inline-expander tp-yt-paper-button#expand"
  );
  if (expander) {
    expander.click();
    await sleep(150);
    return true;
  }
  return false;
}

async function openTranscriptPanel() {
  if (isTranscriptPanelExpanded()) {
    debugCaptionLog("transcript panel already expanded");
    return true;
  }

  let direct = findShowTranscriptDirectButton();
  if (!direct) {
    const expanded = await expandDescription();
    if (expanded) direct = findShowTranscriptDirectButton();
  }
  if (direct) {
    debugCaptionLog("clicking direct 'Show transcript' button");
    direct.click();
    await sleep(500);
    if (isTranscriptPanelExpanded()) return true;
  }

  const moreButton = findMoreActionsButton();
  if (!moreButton) {
    debugCaptionLog("no transcript path: More actions button missing");
    return false;
  }
  debugCaptionLog("clicking More actions button");
  moreButton.click();
  await sleep(400);

  const item = findShowTranscriptMenuItem();
  if (!item) {
    debugCaptionLog("no transcript path: menu has no Show transcript item");
    return false;
  }
  debugCaptionLog("clicking Show transcript menu item");
  item.click();
  await sleep(500);
  return isTranscriptPanelExpanded();
}

function findExpandedTranscriptPanel() {
  for (const panel of document.querySelectorAll("ytd-engagement-panel-section-list-renderer")) {
    const vis = panel.getAttribute("visibility") || "";
    if (vis.includes("EXPANDED") && panel.querySelector(SEGMENT_TAG_SELECTOR)) {
      return panel;
    }
  }
  return null;
}

function closeTranscriptPanel() {
  const panel = findExpandedTranscriptPanel();
  if (!panel) return false;
  const closeBtn =
    panel.querySelector("button[aria-label='Close']") ||
    panel.querySelector("yt-icon-button#visibility-button button") ||
    panel.querySelector("#visibility-button button");
  if (closeBtn) {
    closeBtn.click();
    return true;
  }
  const direct = findShowTranscriptDirectButton();
  if (direct) {
    direct.click();
    return true;
  }
  return false;
}

const SCRAPE_HIDE_STYLE_ID = "ytt-scrape-hide-style";

function injectScrapeHideStyle() {
  if (document.getElementById(SCRAPE_HIDE_STYLE_ID)) return null;
  const style = document.createElement("style");
  style.id = SCRAPE_HIDE_STYLE_ID;
  style.textContent = `
    ytd-engagement-panel-section-list-renderer[target-id*='transcript'],
    ytd-engagement-panel-section-list-renderer:has(transcript-segment-view-model),
    ytd-engagement-panel-section-list-renderer:has(ytd-transcript-segment-renderer) {
      visibility: hidden !important;
    }
  `;
  document.head.appendChild(style);
  return style;
}

function removeScrapeHideStyle() {
  document.getElementById(SCRAPE_HIDE_STYLE_ID)?.remove();
}

async function waitForTranscriptReadiness(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      document.querySelector(
        "ytd-engagement-panel-section-list-renderer[target-id*='transcript']"
      ) ||
      findShowTranscriptDirectButton() ||
      findExpandedTranscriptPanel()
    ) {
      return true;
    }
    await sleep(150);
  }
  return false;
}

async function tryExtractTranscriptFromPanel() {
  const wasInitiallyExpanded = !!findExpandedTranscriptPanel();
  const preexisting = extractTranscriptSegmentsFromDom(document);
  if (preexisting.length) {
    debugCaptionLog("transcript scrape success (panel pre-open)", {
      segmentsLen: preexisting.length,
    });
    return { ok: true, segments: preexisting };
  }

  const ready = await waitForTranscriptReadiness(3000);
  if (!ready) {
    debugCaptionLog(
      "transcript scrape: no transcript markers after 3s — likely uncaptioned"
    );
    return { ok: false, error: "no_panel" };
  }

  const hideStyle = wasInitiallyExpanded ? null : injectScrapeHideStyle();

  try {
    const opened = await openTranscriptPanel();
    if (!opened) {
      debugCaptionLog("transcript scrape: panel could not be opened");
      return { ok: false, error: "no_panel" };
    }
    const segments = await waitForTranscriptSegments(5000);
    debugCaptionLog("transcript scrape result", {
      opened,
      segmentsLen: segments.length,
    });
    if (segments.length && !wasInitiallyExpanded) {
      const closed = closeTranscriptPanel();
      debugCaptionLog("transcript panel auto-closed", { closed });
    }
    if (!segments.length) return { ok: false, error: "no_segments" };
    return { ok: true, segments };
  } finally {
    if (hideStyle) removeScrapeHideStyle();
  }
}

function requestFromPage(eventName, resultName, detail, timeoutMs) {
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => {
      window.removeEventListener(resultName, onResult);
      resolve(null);
    }, timeoutMs);
    function onResult(event) {
      if (!event || !event.detail || event.detail.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener(resultName, onResult);
      resolve(event.detail);
    }
    window.addEventListener(resultName, onResult);
    window.dispatchEvent(
      new CustomEvent(eventName, { detail: { ...(detail || {}), requestId } })
    );
  });
}

async function tryExtractFromCaptionTracks(currentVid) {
  const tracksApi = globalThis.CaptionTracks;
  if (!tracksApi) return { ok: false, error: "no_tracks" };
  const tracksResult = await requestFromPage(
    "ytt-caption-tracks-request",
    "ytt-caption-tracks-result",
    {},
    2000
  );
  if (!tracksApi.tracksMatchCurrentVideo(tracksResult, currentVid)) {
    return { ok: false, error: "stale_video" };
  }
  const tracks = tracksResult && Array.isArray(tracksResult.tracks) ? tracksResult.tracks : [];
  if (!tracks.length) return { ok: false, error: "no_tracks" };
  const track = tracksApi.selectCaptionTrack(tracks, ["en"]);
  if (!track || !track.baseUrl) return { ok: false, error: "no_tracks" };
  if (!tracksApi.isSameOriginYoutubeTimedText(track.baseUrl)) {
    return { ok: false, error: "track_forbidden" };
  }

  for (const fmt of ["json3", "vtt"]) {
    const url = tracksApi.withCaptionFmt(track.baseUrl, fmt);
    if (!tracksApi.isSameOriginYoutubeTimedText(url)) continue;
    const fetched = await requestFromPage(
      "ytt-timedtext-request",
      "ytt-timedtext-result",
      { url },
      4000
    );
    if (!fetched || !fetched.ok || !fetched.text) continue;
    if (!tracksApi.timedtextWithinLimit(fetched.text)) continue;
    const segments = tracksApi.parseTimedText(fetched.text, fmt);
    if (segments.length) {
      return {
        ok: true,
        segments,
        languageCode: track.languageCode || "",
        isAutoGenerated: tracksApi.isAsrTrack(track),
      };
    }
  }
  return { ok: false, error: "track_empty" };
}

function postExtractResult(payload) {
  try {
    const port = chrome.runtime.connect({ name: "extract-captions" });
    port.postMessage(payload);
    port.disconnect();
    return;
  } catch {
    /* fall through to sendMessage */
  }
  try {
    chrome.runtime.sendMessage(payload, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    /* service worker gone */
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "PING_TRANSCRIBER") {
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type !== "EXTRACT_CAPTIONS") return undefined;
  const requestId = msg.requestId;
  sendResponse({ accepted: true, requestId });
  (async () => {
    let result;
    try {
      if (!isYouTubeVideoPage(window.location.href)) {
        result = { ok: false, error: "not_video_page" };
      } else {
        const currentVid = extractVideoId(window.location.href);
        const panel = await tryExtractTranscriptFromPanel();
        if (panel.ok) {
          result = panel;
        } else {
          const tracks = await tryExtractFromCaptionTracks(currentVid);
          result = tracks.ok
            ? tracks
            : { ok: false, error: panel.error || tracks.error || "no_captions" };
        }
        debugCaptionLog("EXTRACT_CAPTIONS done", {
          currentVid,
          ok: !!result.ok,
          error: result.error || null,
          segmentsLen: Array.isArray(result.segments) ? result.segments.length : 0,
        });
      }
    } catch (err) {
      debugCaptionLog("EXTRACT_CAPTIONS error", String(err?.message || err));
      result = { ok: false, error: String(err?.message || err) };
    }
    postExtractResult({
      type: "EXTRACT_CAPTIONS_RESULT",
      requestId,
      ...result,
    });
  })();
  return false;
});
