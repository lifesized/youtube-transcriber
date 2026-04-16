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
