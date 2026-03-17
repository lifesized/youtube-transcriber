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

function reportPageInfo() {
  const videoId = extractVideoId(window.location.href);
  try {
    chrome.runtime.sendMessage({
      type: "PAGE_INFO",
      url: window.location.href,
      title: getVideoTitle(),
      videoId: videoId,
    });
  } catch {
    // Extension context invalidated (reloaded) — stop observing
    observer.disconnect();
  }
}

// Initial report
reportPageInfo();

// YouTube SPA navigation — MutationObserver
let lastUrl = window.location.href;
const observer = new MutationObserver(() => {
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
function onFullscreenChange() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    try {
      chrome.runtime.sendMessage({ type: "CLOSE_PANEL" });
    } catch { /* ignore */ }
  }
}
document.addEventListener("fullscreenchange", onFullscreenChange);
document.addEventListener("webkitfullscreenchange", onFullscreenChange);
