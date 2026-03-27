function extractEpisodeId(url) {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/^\/episode\/([a-zA-Z0-9]{22})/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function getEpisodeTitle() {
  // Spotify sets og:title meta tag
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle?.content) return ogTitle.content;
  // Fallback to page title (format: "Episode Name | Podcast - Spotify")
  const title = document.title.replace(/\s*[-|]\s*Spotify\s*$/, "").trim();
  return title || null;
}

function reportPageInfo() {
  const episodeId = extractEpisodeId(window.location.href);
  if (!episodeId) return;

  try {
    chrome.runtime.sendMessage({
      type: "PAGE_INFO",
      url: window.location.href,
      title: getEpisodeTitle(),
      videoId: episodeId,
    });
  } catch {
    observer.disconnect();
  }
}

// Initial report (with delay for SPA hydration)
setTimeout(reportPageInfo, 500);

// Spotify is a React SPA — watch for URL changes
let lastUrl = window.location.href;
const observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    setTimeout(reportPageInfo, 800);
  }
});
observer.observe(document.body, { childList: true, subtree: true });

// Also listen for popstate (back/forward navigation)
window.addEventListener("popstate", () => {
  setTimeout(reportPageInfo, 300);
});
