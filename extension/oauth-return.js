// OAuth redirect landing page. Cloud callback 307s here with query params:
//   ?destination=<adapterId>&status=connected|error&reason=<optional>
// Relays to the extension via runtime messaging so any open settings UI
// can refresh the destinations list, then closes itself.

(function () {
  const params = new URLSearchParams(window.location.search);
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
