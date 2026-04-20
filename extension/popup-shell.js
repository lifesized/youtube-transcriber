const port = chrome.runtime.connect({ name: "sidepanel" });

port.onMessage.addListener((msg) => {
  if (msg.type === "CLOSE") window.close();
});

const frame = document.getElementById("appFrame");
const error = document.getElementById("shellError");

// Show error state if iframe fails to load
let loaded = false;
frame.addEventListener("load", () => { loaded = true; });

setTimeout(() => {
  if (!loaded) {
    frame.style.display = "none";
    error.style.display = "flex";
  }
}, 8000);

document.getElementById("btnRetryLoad").addEventListener("click", (e) => {
  e.preventDefault();
  error.style.display = "none";
  frame.style.display = "block";
  frame.src = frame.src;
  loaded = false;
  setTimeout(() => {
    if (!loaded) {
      frame.style.display = "none";
      error.style.display = "flex";
    }
  }, 8000);
});

// Forward messages between iframe and background.
// Strict origin check — only accept frames from transcribed.dev, and
// post responses back to the same origin (no "*" wildcards).
const ALLOWED_ORIGIN = "https://transcribed.dev";
window.addEventListener("message", (event) => {
  if (event.origin !== ALLOWED_ORIGIN) return;
  if (event.source !== frame.contentWindow) return;
  if (!event.data || typeof event.data.type !== "string") return;
  const requestId = event.data._requestId;
  chrome.runtime.sendMessage(event.data, (response) => {
    if (!frame.contentWindow) return;
    frame.contentWindow.postMessage(
      { _responseId: requestId, ...response },
      ALLOWED_ORIGIN
    );
  });
});
