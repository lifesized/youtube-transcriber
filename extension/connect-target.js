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

  const CONNECT_TO_LABEL = "Library";
  const CONNECT_HELPER =
    "Two separate libraries. Transcribe saves to the one selected.";
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
    },
    [DEV]: {
      id: DEV,
      label: "Dev server",
      apiBase: "http://127.0.0.1:19720",
      port: "19720",
      nativeHostName: "com.transcribed.host",
      pairUrl: "http://127.0.0.1:19720/api/native-host/pair",
      nativeHostLogHint: "~/Library/Logs/Transcriber/native-host.log",
    },
  };

  const STATUS = Object.freeze({
    RUNNING: "running",
    STOPPED: "stopped",
    NEEDS_PERMISSION: "needs_permission",
    HELPER_OUTDATED: "helper_outdated",
    STARTING: "starting",
    UNKNOWN: "unknown",
  });

  /** Hosts older than this answer `version` with unknown_cmd or no protocol. */
  const MIN_HOST_PROTOCOL = 2;

  /** Stop is off until Security signs off on it. */
  const FEATURES = Object.freeze({ stop: false });

  /**
   * Every library-picker, status and connection-error string. Placeholder
   * copy until Design supplies final strings. `{port}` is filled in at use.
   */
  const STRINGS = Object.freeze({
    pickerAriaLabel: "Library",
    option: "{label} · {port}",
    status: Object.freeze({
      [STATUS.RUNNING]: "Running",
      [STATUS.STOPPED]: "Stopped",
      [STATUS.NEEDS_PERMISSION]: "Needs permission",
      [STATUS.HELPER_OUTDATED]: "Helper out of date",
      [STATUS.STARTING]: "Starting…",
      [STATUS.UNKNOWN]: "Checking…",
    }),
    start: "Start",
    starting: "Starting…",
    errors: Object.freeze({
      unknown_cmd: {
        [APP]: "Transcriber's browser connection is out of date. In the Transcriber menu, choose Reinstall Browser Connection.",
        [DEV]: "The dev server's browser helper is out of date. Run the setup command in your Transcriber folder, then try again.",
      },
      no_token: {
        [APP]: "Transcriber didn't give this browser an access key. Quit and reopen Transcriber, then try again.",
        [DEV]: "The dev server's browser helper has no access key for this browser. Run the setup command in your Transcriber folder, then try again.",
      },
      host_not_found: {
        [APP]: "Transcriber can't talk to this browser yet. In the Transcriber menu, choose Reinstall Browser Connection.",
        [DEV]: "The dev server's browser helper isn't installed. Run the setup command in your Transcriber folder, then try again.",
      },
      host_forbidden: {
        [APP]: "This browser isn't allowed to use Transcriber yet. In the Transcriber menu, choose Reinstall Browser Connection.",
        [DEV]: "The dev server's browser helper doesn't allow this extension. Run the setup command in your Transcriber folder, then try again.",
      },
      extension_not_allowed: {
        [APP]: "Transcriber needs your permission to connect. Click Allow in the Transcriber dialog on your Mac.",
        [DEV]: "This extension isn't paired with the dev server. Run the setup command in your Transcriber folder, then try again.",
      },
      unauthorized_caller: {
        [APP]: "Transcriber needs your permission to connect. Click Allow in the Transcriber dialog on your Mac.",
        [DEV]: "This extension isn't paired with the dev server. Run the setup command in your Transcriber folder, then try again.",
      },
      bad_project_root: {
        [DEV]: "Transcriber's browser connection isn't linked to your Transcriber folder. Run npm run install-native-host -- --project-root <path-to-your-Transcriber-folder>, then try again.",
      },
      unauthorized: {
        [APP]: "Transcriber didn't accept this browser's access key. Quit and reopen Transcriber, then try again.",
        [DEV]: "The dev server didn't accept this browser. Open http://127.0.0.1:{port} once in this browser, then try again.",
      },
      unreachable: {
        [APP]: "Transcriber app isn't running.",
        [DEV]: "Can't reach your dev server. Start it, then try again.",
      },
      app_not_found: {
        [APP]: "Transcriber isn't in your Applications folder. Move it there, then try again.",
      },
      port_conflict: "Port {port} is in use by another app. Quit that app, then try again.",
      start_timeout: {
        [APP]: "Transcriber didn't start. Open it from your Applications folder.",
        [DEV]: "The dev server didn't start. Run npm run dev in your Transcriber folder, then try again.",
      },
      host_timeout: "Transcriber's browser connection didn't respond. Try again.",
      host_exited: "Transcriber's browser connection closed unexpectedly. Try again.",
      stop_disabled: "Stop isn't available in this beta.",
      other: "Transcription failed. Try again.",
    }),
  });

  function fill(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, (m, key) =>
      vars[key] === undefined ? m : String(vars[key])
    );
  }

  function normalize(value) {
    return value === DEV ? DEV : APP;
  }

  function optionLabel(id) {
    const t = TARGETS[normalize(id)];
    return fill(STRINGS.option, { label: t.label, port: t.port });
  }

  function statusLabel(status) {
    return STRINGS.status[status] || STRINGS.status[STATUS.UNKNOWN];
  }

  /**
   * Human message for a host, auth or connection reason. Unknown reasons
   * fall back to the generic failure; host and auth reasons never do.
   */
  function errorMessage(reason, id) {
    const t = TARGETS[normalize(id)];
    const entry = STRINGS.errors[reason] || STRINGS.errors.other;
    const text =
      typeof entry === "string"
        ? entry
        : entry[t.id] || entry[APP] || entry[DEV] || STRINGS.errors.other;
    return fill(text, { port: t.port });
  }

  function getTarget(id) {
    return TARGETS[normalize(id)];
  }

  function unreachableMessage(id) {
    return errorMessage("unreachable", id);
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
    STATUS,
    MIN_HOST_PROTOCOL,
    FEATURES,
    STRINGS,
    normalize,
    getTarget,
    optionLabel,
    statusLabel,
    errorMessage,
    unreachableMessage,
    shouldShowRetry,
    shouldReuseStartTranscriber,
    nextTargetWhenUnreachable,
  };
});
