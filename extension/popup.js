const pageUrlEl = document.getElementById("pageUrl");
const pageUrlText = document.getElementById("pageUrlText");
const sendButton = document.getElementById("btnSend");
const statusEl = document.getElementById("status");
const deepLinkEl = document.getElementById("deepLink");

let currentUrl = null;
let sending = false;
let lastTranscriptId = null;

function setStatus(message, tone) {
  statusEl.textContent = message;
  if (tone) statusEl.dataset.tone = tone;
  else delete statusEl.dataset.tone;
}

async function readActivePageUrl() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  return typeof tab?.url === "string" ? tab.url : "";
}

async function refresh() {
  if (sending) return;
  let raw = "";
  try {
    raw = await readActivePageUrl();
  } catch {
    raw = "";
  }
  const normalized = normalizePageUrl(raw);
  const changed = normalized !== currentUrl;
  currentUrl = normalized;
  pageUrlEl.classList.remove("is-pending");

  if (!normalized) {
    pageUrlText.textContent = "This page has no URL to send.";
    sendButton.disabled = true;
    setStatus("Open an http(s) page to send its URL.", "muted");
    return;
  }

  pageUrlText.textContent = normalized;
  sendButton.disabled = false;
  if (changed && statusEl.dataset.tone !== "pending") setStatus("", "");
}

sendButton.addEventListener("click", async () => {
  if (sending || !currentUrl) return;
  const url = currentUrl;
  sending = true;
  sendButton.disabled = true;
  sendButton.setAttribute("aria-busy", "true");
  sendButton.textContent = "Sending…";
  setStatus("Sending…", "pending");
  deepLinkEl.hidden = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "SEND_PAGE_URL",
      url,
    });
    if (response?.ok === true) {
      lastTranscriptId = response.transcriptId;
      // YTT-448: Shorten to "Sent." when deep-link button is showing
      setStatus("Sent.", "ok");
      if (lastTranscriptId) {
        deepLinkEl.hidden = false;
      }
    } else {
      lastTranscriptId = null;
      // YTT-448: Design-locked strings, never show server error
      if (response?.reason === "unreachable") {
        setStatus("Start the Transcriber app.", "error");
      } else if (response?.reason === "unauthorized") {
        setStatus("Token missing or out of date — restart Transcriber.", "error");
      } else {
        setStatus("Couldn't send this URL.", "error");
      }
    }
  } catch {
    lastTranscriptId = null;
    setStatus("Couldn't send this URL.", "error");
  } finally {
    sending = false;
    sendButton.textContent = "Send this page";
    sendButton.removeAttribute("aria-busy");
    await refresh();
  }
});

deepLinkEl.addEventListener("click", () => {
  if (lastTranscriptId) {
    const targetUrl = `http://127.0.0.1:19720/?id=${encodeURIComponent(lastTranscriptId)}`;
    chrome.tabs.create({ url: targetUrl });
  }
});

chrome.tabs.onActivated.addListener(() => {
  refresh();
});

chrome.tabs.onUpdated.addListener(() => {
  refresh();
});

if (typeof requestIdleCallback === "function") {
  requestIdleCallback(() => refresh(), { timeout: 300 });
} else {
  setTimeout(() => refresh(), 0);
}
