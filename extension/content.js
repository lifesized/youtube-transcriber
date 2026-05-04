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

function isYouTubeVideoPage(url) {
  return !!extractVideoId(url);
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

// YT ships two transcript-segment renderers depending on layout vintage:
//   - <transcript-segment-view-model> (ytwTranscriptSegmentViewModelHost)
//     — modern, used since late-2024
//   - <ytd-transcript-segment-renderer> — older Polymer build
// Match both so we don't regress on either when YT A/B-tests one bucket back.
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

// The transcript engagement panel can land under a few target-ids
// (PAmodern_transcript_view, engagement-panel-searchable-transcript) and
// since late-2024 the *expanded* one sometimes has no target-id at all.
// We treat "panel exists" loosely (any matching node) but distinguish
// "panel actually open" via the visibility= attribute, since the HIDDEN
// panel is in the DOM from page load and always matches.
function findTranscriptPanel() {
  // 1. An expanded panel that actually holds transcript segments is the
  //    truth — return that even if its target-id is empty.
  const allPanels = document.querySelectorAll(
    "ytd-engagement-panel-section-list-renderer"
  );
  for (const panel of allPanels) {
    const vis = panel.getAttribute("visibility") || "";
    if (vis.includes("EXPANDED") && panel.querySelector(SEGMENT_TAG_SELECTOR)) {
      return panel;
    }
  }
  // 2. Fall back to any panel whose target-id mentions transcript — this is
  //    the placeholder/HIDDEN one before the user opens it.
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
    // Always scan from document — the HIDDEN placeholder panel matches
    // findTranscriptPanel() but contains no segments, so scoping to it
    // would always return [].
    const segments = extractTranscriptSegmentsFromDom(document);
    if (segments.length) return segments;
    await sleep(100);
  }
  return [];
}

// Generic text-based finder — looks for a clickable element whose visible
// text or aria-label matches "show transcript" / "transcript". Far more
// resilient to DOM changes than tag-name selectors. Skips hidden elements.
// When the match is a wrapper (ytd-button-renderer / yt-button-shape), we
// drill down to the inner <button> so YouTube's actual click handler fires
// — clicking the wrapper alone is a no-op on modern YT.
function findClickableByText(textPattern) {
  const all = document.querySelectorAll(
    "button, tp-yt-paper-item, ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, ytd-button-renderer, yt-button-shape"
  );
  for (const el of all) {
    if (el.offsetParent === null && getComputedStyle(el).display === "none") continue;
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
  // Modern YouTube renders a "Show transcript" button in the description
  // expansion (under the video). Try that first — it's the cleanest path.
  return findClickableByText(/^show transcript\b|^transcript$/);
}

function findShowTranscriptMenuItem() {
  // Inside the More-actions menu, the item label is "Show transcript".
  return findClickableByText(/show transcript/);
}

function findMoreActionsButton() {
  // YouTube ships multiple "More actions" buttons on a watch page (player
  // overlay, ytd-watch-metadata legacy slot, comments dropdown). Several
  // of those are display:none ghosts that match selectors but never react
  // to clicks. Always prefer the *visible* button inside the modern
  // #above-the-fold #actions row.
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
  // The "Show transcript" direct button only appears once the description
  // is expanded. ytd-text-inline-expander has a "...more" toggle.
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

  // Strategy 1: direct "Show transcript" button under description.
  let direct = findShowTranscriptDirectButton();
  if (!direct) {
    // Description may be collapsed — expand and retry.
    const expanded = await expandDescription();
    if (expanded) direct = findShowTranscriptDirectButton();
  }
  if (direct) {
    debugCaptionLog("clicking direct 'Show transcript' button");
    direct.click();
    await sleep(500);
    if (isTranscriptPanelExpanded()) return true;
  }

  // Strategy 2: More-actions menu → Show transcript item.
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
  // Don't disturb a transcript panel the user opened themselves before they
  // clicked Transcribe — that would feel like the extension is yanking UI
  // out from under them. We only close panels we opened.
  const panel = findExpandedTranscriptPanel();
  if (!panel) return false;
  // Engagement panel headers expose a Close button. Selector covers the
  // modern (yt-icon-button) and legacy (ytd-icon-button) renderers.
  const closeBtn =
    panel.querySelector("button[aria-label='Close']") ||
    panel.querySelector("yt-icon-button#visibility-button button") ||
    panel.querySelector("#visibility-button button");
  if (closeBtn) {
    closeBtn.click();
    return true;
  }
  // Fallback: re-click "Show transcript" to toggle off. Some YT layouts
  // bind the description button to a toggle action.
  const direct = findShowTranscriptDirectButton();
  if (direct) {
    direct.click();
    return true;
  }
  return false;
}

// Inject a style block that hides YouTube's transcript engagement panel
// during scrape. Verified against live YT DOM: segments render based on the
// panel's internal `visibility=` attribute and not CSS visibility, so YT
// still populates `<transcript-segment-view-model>` rows while the panel
// is invisible to the user. Net effect: zero visible flash when we click
// Show transcript → mount panel → read segments → close panel.
//
// Selector covers three cases: the placeholder panel that lives in DOM
// from page load (`target-id*='transcript'`) plus the expanded panel which
// on modern YT can have an empty target-id (matched via :has() against
// either segment renderer name).
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

// Wait for YouTube to mount the markers that indicate transcript availability.
// Without this, a user clicking Transcribe within ~1s of opening a video
// hits openTranscriptPanel before the "Show transcript" button or the
// PAmodern_transcript_view engagement-panel placeholder render — scrape
// returns empty and we fall through to the slow server path even though
// captions are ~200-1000ms away.
//
// Returning false after the deadline means "no transcript markers ever
// appeared" → treat as uncaptioned → return [] from the caller, which
// triggers the server fallback (yt-dlp / Whisper). The 3s tax is
// negligible vs Whisper's 30s-5min anyway.
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
    return preexisting;
  }

  // Wait for YT to mount transcript markers before deciding whether captions
  // exist. Race condition: user clicks Transcribe < 1s after page nav, before
  // the engagement panel placeholder or "Show transcript" button render.
  // Without this, the click silently falls through to the slow server path.
  const ready = await waitForTranscriptReadiness(3000);
  if (!ready) {
    debugCaptionLog(
      "transcript scrape: no transcript markers after 3s — likely uncaptioned"
    );
    return [];
  }

  // Only hide if we'd be opening the panel ourselves. If the user already
  // had it expanded (say they opened it manually, then clicked our button
  // before segments finished loading), yanking it invisible mid-use would
  // be jarring. wasInitiallyExpanded handles that case.
  const hideStyle = wasInitiallyExpanded ? null : injectScrapeHideStyle();

  try {
    const opened = await openTranscriptPanel();
    if (!opened) {
      debugCaptionLog("transcript scrape: panel could not be opened");
      return [];
    }
    // Panel mounted but rows can take a moment to render — bumped from 2.5s
    // to 5s after observing real captioned videos miss the previous deadline.
    const segments = await waitForTranscriptSegments(5000);
    debugCaptionLog("transcript scrape result", {
      opened,
      segmentsLen: segments.length,
    });
    // Restore the user's prior UI state. If they didn't have the transcript
    // panel open before we touched it, close it so they aren't left with
    // two transcripts side-by-side (YT's panel + our extension panel).
    if (segments.length && !wasInitiallyExpanded) {
      const closed = closeTranscriptPanel();
      debugCaptionLog("transcript panel auto-closed", { closed });
    }
    return segments;
  } finally {
    if (hideStyle) removeScrapeHideStyle();
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Liveness probe — bg uses this to detect whether the new content script
  // is already attached on an existing tab before deciding to inject. Must
  // respond synchronously so chrome.runtime.lastError doesn't fire when the
  // listener is the only one for this message type.
  if (msg?.type === "PING_TRANSCRIBER") {
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type !== "EXTRACT_CAPTIONS") return undefined;
  (async () => {
    try {
      if (!isYouTubeVideoPage(window.location.href)) {
        sendResponse({ ok: false, error: "not_video_page" });
        return;
      }
      const currentVid = extractVideoId(window.location.href);
      const segments = await tryExtractTranscriptFromPanel();
      if (!segments.length) {
        debugCaptionLog("EXTRACT_CAPTIONS no transcript panel", { currentVid });
        sendResponse({ ok: false, error: "no_captions" });
        return;
      }
      debugCaptionLog("EXTRACT_CAPTIONS success", {
        currentVid,
        segmentsLen: segments.length,
      });
      sendResponse({ ok: true, segments });
    } catch (err) {
      debugCaptionLog("EXTRACT_CAPTIONS error", String(err?.message || err));
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true; // async sendResponse
});
