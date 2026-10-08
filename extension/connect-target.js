"use strict";

/**
 * LOCAL extension target: packaged Transcriber app vs checkout dev server.
 * Strings are Design-locked. Persist the choice in chrome.storage.local.
 * Never auto-switch when a target is down.
 */

(function (root, factory) {
  const exported = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exported;
  }
  root.ConnectTarget = exported;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STORAGE_KEY = "connectTarget";
  const APP = "app";
  const DEV = "dev";

  const CONNECT_TO_LABEL = "Connect to";
  const CONNECT_HELPER =
    "Use Dev server only if you run Transcriber from a code checkout.";
  const RETRY_LABEL = "Retry";

  const TARGETS = {
    [APP]: {
      id: APP,
      label: "Transcriber app",
      apiBase: "http://127.0.0.1:19721",
      port: "19721",
      nativeHostName: "com.transcribed.app.host",
      pairUrl: "http://127.0.0.1:19721/api/native-host/pair",
      nativeHostLogHint: "~/Library/Logs/Transcriber App/native-host.log",
      unreachable: "Transcriber app isn't running.",
    },
    [DEV]: {
      id: DEV,
      label: "Dev server",
      apiBase: "http://127.0.0.1:19720",
      port: "19720",
      nativeHostName: "com.transcribed.host",
      pairUrl: "http://127.0.0.1:19720/api/native-host/pair",
      nativeHostLogHint: "~/Library/Logs/Transcriber/native-host.log",
      unreachable: "Can't reach your dev server. Start it, then try again.",
    },
  };

  function normalize(value) {
    return value === DEV ? DEV : APP;
  }

  function getTarget(id) {
    return TARGETS[normalize(id)];
  }

  function unreachableMessage(id) {
    return getTarget(id).unreachable;
  }

  function shouldShowRetry(id) {
    return normalize(id) === DEV;
  }

  function shouldReuseStartTranscriber(id) {
    return normalize(id) === APP;
  }

  /** Switching targets never auto-picks the other one if the current is down. */
  function nextTargetWhenUnreachable(currentId) {
    return normalize(currentId);
  }

  const LOOPBACK_ORIGINS = Object.freeze(
    Object.values(TARGETS).map((t) => t.apiBase)
  );

  return {
    STORAGE_KEY,
    APP,
    DEV,
    CONNECT_TO_LABEL,
    CONNECT_HELPER,
    RETRY_LABEL,
    TARGETS,
    LOOPBACK_ORIGINS,
    normalize,
    getTarget,
    unreachableMessage,
    shouldShowRetry,
    shouldReuseStartTranscriber,
    nextTargetWhenUnreachable,
  };
});
