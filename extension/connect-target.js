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
      shortLabel: "App",
      apiBase: "http://127.0.0.1:19721",
      port: "19721",
      nativeHostName: "com.transcribed.app.host",
      pairUrl: "http://127.0.0.1:19721/api/native-host/pair",
      nativeHostLogHint: "~/Library/Logs/Transcriber App/native-host.log",
    },
    [DEV]: {
      id: DEV,
      label: "Dev server",
      shortLabel: "Dev",
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
   * Every library-picker, status and connection-error string (Design's
   * final copy). `{port}` and `{extId}` are filled in at use.
   */
  const STRINGS = Object.freeze({
    pickerAriaLabel: "Library",
    option: "{label} · {port}",
    indicator: "{short} · {port}",
    indicatorTitle: "Library: {label} · {port}, {status}. Click to change in Settings.",
    action: Object.freeze({
      allowAccess: "Allow access",
      updateHelper: "Update helper",
      copy: "Copy",
      copied: "Copied",
    }),
    devSetupCommand: "npm run install-native-host -- --ext-id={extId}",
    projectRootCommand:
      "npm run install-native-host -- --project-root <path-to-your-Transcriber-folder>",
    reinstallHint: "In the Transcriber menu, choose Reinstall Browser Connection.",
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
        [DEV]: "The dev server's browser helper needs an update. Copy the setup command from Settings › Library, run it in your Transcriber folder, then try again.",
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

  function indicatorText(id) {
    const t = getTarget(id);
    return fill(STRINGS.indicator, { short: t.shortLabel, port: t.port });
  }

  function indicatorTitle(id, status) {
    const t = getTarget(id);
    return fill(STRINGS.indicatorTitle, {
      label: t.label,
      port: t.port,
      status: statusLabel(status),
    });
  }

  function devSetupCommand(extId) {
    return fill(STRINGS.devSetupCommand, { extId });
  }

  // App reasons that pairing (the Allow dialog) can fix.
  const ALLOW_ACCESS_REASONS = new Set([
    "extension_not_allowed",
    "unauthorized_caller",
    "host_forbidden",
  ]);

  /**
   * What the selected Settings › Library row shows for one probe result.
   * `action.kind` is start | retry | allowAccess | command | note.
   * `tone` colours the line under the rows: muted, warn (setup) or error.
   * `startFailure` is the reason from this panel's last failed Start, if any.
   */
  function rowView(id, probe, { extId = "", startFailure = null } = {}) {
    const t = getTarget(id);
    const status = (probe && probe.status) || STATUS.UNKNOWN;
    const reason = (probe && probe.reason) || null;
    const none = { action: null, message: null, tone: null };

    if (status === STATUS.STARTING) {
      return { ...none, action: { kind: "start", label: STRINGS.starting, busy: true } };
    }
    if (status === STATUS.RUNNING || status === STATUS.UNKNOWN) return none;

    if (status === STATUS.HELPER_OUTDATED) {
      const heading = STRINGS.action.updateHelper;
      return t.id === APP
        ? { ...none, action: { kind: "note", heading, text: STRINGS.reinstallHint } }
        : { ...none, action: { kind: "command", heading, command: devSetupCommand(extId) } };
    }

    if (status === STATUS.NEEDS_PERMISSION) {
      if (t.id === APP) {
        if (ALLOW_ACCESS_REASONS.has(reason)) {
          return {
            action: { kind: "allowAccess", label: STRINGS.action.allowAccess },
            message: errorMessage("extension_not_allowed", APP),
            tone: "warn",
          };
        }
        return { action: null, message: errorMessage(reason || "unauthorized", APP), tone: "warn" };
      }
      // Tokens only (no cookie fallback): a dev 401 is fixed by updating the helper.
      if (reason === "unauthorized") {
        return {
          action: {
            kind: "command",
            heading: STRINGS.action.updateHelper,
            command: devSetupCommand(extId),
          },
          message: errorMessage("unauthorized", DEV),
          tone: "warn",
        };
      }
      return {
        action: { kind: "command", command: devSetupCommand(extId) },
        message: errorMessage(reason || "extension_not_allowed", DEV),
        tone: "warn",
      };
    }

    const why = startFailure || reason;
    if (t.id === DEV && why === "bad_project_root") {
      return {
        action: { kind: "command", command: STRINGS.projectRootCommand },
        message: errorMessage("bad_project_root", DEV),
        tone: "warn",
      };
    }
    const action =
      t.id === APP
        ? { kind: "start", label: STRINGS.start }
        : { kind: "retry", label: RETRY_LABEL };
    if (startFailure) {
      return { action, message: errorMessage(startFailure, t.id), tone: "error" };
    }
    return { action, message: unreachableMessage(t.id), tone: "muted" };
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
    indicatorText,
    indicatorTitle,
    devSetupCommand,
    rowView,
  };
});
