"use strict";

/**
 * LOCAL build lock — the friends-beta / Store LOCAL extension never
 * falls through to hosted cloud auth.
 *
 * Dual-mode leftovers (chrome.storage.sync.mode === "cloud", a CHECK_SERVICE
 * payload that still says mode:"cloud", GET_SETTINGS failing) must not
 * render Google / magic-link sign-in or navigate to transcribed.dev.
 */

(function (root, factory) {
  const exported = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exported;
  }
  root.LocalModeLock = exported;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const BUILD_TARGET = "local";

  const CLOUD_SIGNIN_IDS = Object.freeze([
    "cloudAuthCard",
    "cloudAuthGoogle",
    "cloudAuthForm",
    "cloudAuthEmail",
    "cloudAuthSubmit",
    "cloudAuthResend",
    "cloudAuthSent",
    "cloudAuthSentEmail",
    "cloudAuthError",
    "cloudAuthErrorMsg",
    "cloudOnboarding",
    "offlineCloudMsg",
    "cloudNudge",
    "cloudAccountSection",
    "cloudLink",
    "btnModeCloud",
    "setupWallModal",
  ]);

  function isLocalBuild() {
    return BUILD_TARGET === "local";
  }

  function resolveMode(_storedMode, _serviceMode) {
    if (isLocalBuild()) return "local";
    return _serviceMode || _storedMode || "cloud";
  }

  function shouldShowCloudAuth(_mode) {
    return !isLocalBuild() && resolveMode(_mode) === "cloud";
  }

  function isCloudHostedUrl(url) {
    const raw = String(url || "");
    if (!raw) return false;
    try {
      const parsed = new URL(raw, "http://127.0.0.1");
      return /(^|\.)transcribed\.dev$/i.test(parsed.hostname);
    } catch {
      return /transcribed\.dev/i.test(raw);
    }
  }

  function hideCloudSignIn(doc) {
    if (!doc || typeof doc.getElementById !== "function") return;
    for (const id of CLOUD_SIGNIN_IDS) {
      const node = doc.getElementById(id);
      if (node) node.hidden = true;
    }
  }

  /**
   * Paint the LOCAL offline first-screen. Always hides leftover cloud
   * sign-in nodes, even if they leaked into the document.
   */
  function paintLocalOffline(doc, options = {}) {
    hideCloudSignIn(doc);

    const hide = (id) => {
      const node = doc.getElementById(id);
      if (node) node.hidden = true;
    };
    const show = (id) => {
      const node = doc.getElementById(id);
      if (node) node.hidden = false;
      return node;
    };

    hide("startupShell");
    hide("stateReady");
    hide("stateNotYoutube");
    hide("stateTranscribing");
    hide("stateError");
    hide("settingsPanel");
    show("stateNoService");
    show("offlineLocalMsg");

    const setup = doc.getElementById("offlineLocalSetup");
    const authErr = doc.getElementById("offlineLocalAuthError");
    const heading = doc.getElementById("offlineHeading");
    const sub = doc.getElementById("offlineSub");
    const startWrap = doc.getElementById("offlineStartWrap");
    const copyWrap = doc.getElementById("offlineCopyWrap");
    const checkAgain = doc.getElementById("btnCheckAgain");

    const authError = !!options.authError;
    const pairing =
      options.nativeHostState === "pairing" && options.targetId !== "dev";
    const isDev = options.targetId === "dev";
    const haveHost = options.nativeHostAvailable === true;

    if (authErr) authErr.hidden = !authError;
    if (setup) setup.hidden = !!authError;

    if (authError) {
      return { state: "offline-auth", heading: "Reconnect to Transcriber" };
    }

    if (haveHost) {
      if (heading) heading.textContent = "Transcriber isn't running";
      if (sub) sub.textContent = "Start it to transcribe this video.";
      if (startWrap) startWrap.hidden = false;
      if (copyWrap) copyWrap.hidden = true;
      if (checkAgain) checkAgain.hidden = true;
      return { state: "offline-start", heading: "Transcriber isn't running" };
    }

    if (pairing) {
      if (heading) heading.textContent = "Allow Transcriber to connect";
      if (sub) sub.textContent = "Click Allow in the Transcriber dialog on your Mac.";
      if (startWrap) startWrap.hidden = true;
      if (copyWrap) copyWrap.hidden = true;
      if (checkAgain) checkAgain.hidden = false;
      return { state: "offline-pairing", heading: "Allow Transcriber to connect" };
    }

    if (isDev) {
      if (heading) heading.textContent = "Dev server setup";
      if (sub) sub.textContent = "Run this in your terminal to get going";
      if (startWrap) startWrap.hidden = true;
      if (copyWrap) copyWrap.hidden = false;
      if (checkAgain) checkAgain.hidden = false;
      return { state: "offline-dev-setup", heading: "Dev server setup" };
    }

    if (heading) heading.textContent = "Transcriber isn't running";
    if (sub) sub.textContent = "Open Transcriber from your Applications folder.";
    if (startWrap) startWrap.hidden = true;
    if (copyWrap) copyWrap.hidden = true;
    if (checkAgain) checkAgain.hidden = false;
    return { state: "offline-app-missing", heading: "Transcriber isn't running" };
  }

  return {
    BUILD_TARGET,
    CLOUD_SIGNIN_IDS,
    isLocalBuild,
    resolveMode,
    shouldShowCloudAuth,
    isCloudHostedUrl,
    hideCloudSignIn,
    paintLocalOffline,
  };
});
