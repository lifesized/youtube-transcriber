// Marks transcribed.dev pages so the web app can hide extension-install CTAs
// for users who already have the extension installed.
(function markTranscriberExtensionInstalled() {
  try {
    document.documentElement.dataset.transcriberExtensionInstalled = "true";
    window.dispatchEvent(new CustomEvent("transcriber-extension-installed"));
  } catch {
    // Best-effort only. The website also has a chrome-extension:// fetch fallback.
  }
})();
