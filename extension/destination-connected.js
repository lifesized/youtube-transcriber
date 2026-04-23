// OAuth redirect landing page. Cloud callback 307s here with hash params:
//   #destination=<adapterId>&status=connected|error&reason=<optional>
// Hash (not query) because ad/privacy blockers frequently match
// chrome-extension:// URLs with tracking-shaped query strings and block them
// with ERR_BLOCKED_BY_CLIENT. Hash fragments bypass that heuristic.
// Relays to the extension via runtime messaging so any open settings UI
// can refresh the destinations list, then closes itself.

(function () {
  const raw = (window.location.hash || "").replace(/^#/, "");
  const params = new URLSearchParams(raw);
  const adapterId = params.get("destination") || "";
  const status = params.get("status") || "error";
  const reason = params.get("reason") || "";

  const box = document.getElementById("box");
  const title = document.getElementById("title");
  const msg = document.getElementById("msg");

  if (status === "connected") {
    title.textContent = "Connected";
    msg.textContent = "You can close this window.";
  } else {
    box.classList.add("error");
    title.textContent = "Couldn't connect";
    msg.textContent = reason || "Something went wrong. Try again from the extension.";
  }

  try {
    chrome.runtime.sendMessage(
      { type: "OAUTH_RETURN", adapterId, status, reason },
      () => {
        // Small delay so the user can read the status before the window disappears.
        setTimeout(() => {
          try { window.close(); } catch { /* ignore */ }
        }, status === "connected" ? 400 : 2000);
      }
    );
  } catch {
    // If messaging fails (e.g. extension reloaded), leave the page open.
  }
})();
