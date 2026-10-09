"use strict";

const { validateBotToken, validateAppToken, looksMasked } = require("./tokens.js");
const { parseChannelAllowlist, normalizeChannelId } = require("./gates.js");
const { createTuskRuntime } = require("./runtime.js");
const { createPipeline } = require("./pipeline.js");
const { createJobGate } = require("./jobs.js");
const { createLocalClient } = require("./local-client.js");
const { cancelledError, busyError, allowlistIdsAdded, watchFeedsChanged, feedUrls } = require("./confirm.js");
const { parseWatchlistText } = require("./watch-feeds.js");
const { createWatchSeen } = require("./watch-seen.js");
const { createWatchDigest } = require("./watch-digest.js");
const slackApi = require("./slack-api.js");

function createTuskManager(options = {}) {
  const store = options.store;
  const api = options.slackApi || slackApi;
  const createRuntime = options.createRuntime || createTuskRuntime;
  const rawClient = options.localClient || createLocalClient();
  const jobs =
    options.jobGate ||
    createJobGate({
      cancelServerJob: (jobId) =>
        rawClient.cancelInFlight
          ? rawClient.cancelInFlight(jobId ? { jobId, tag: "tusk" } : { tag: "tusk" })
          : Promise.resolve(),
    });
  const localClient = {
    ...rawClient,
    createSummary(transcriptId, extra) {
      jobs.takeLlm();
      return rawClient.createSummary(transcriptId, extra);
    },
  };
  let runtime = null;
  let watch = null;
  let status = { state: "off", workspace: "" };
  let starting = null;
  let confirmOpen = false;
  const pendingRequests = new Map();
  const watchSeen = options.watchSeen || createWatchSeen();

  function digestIsPaused() {
    if (status.digest && status.digest.paused) return true;
    return Boolean(watchSeen.isDigestPaused && watchSeen.isDigestPaused());
  }

  function attachWatch() {
    if (watch) return watch;
    const live = store.getSlackPlain();
    if (!live.watchFeeds || !live.watchFeeds.length) return null;
    watch = createWatchDigest({
      getConfig: () => {
        const cfg = store.getSlackPlain();
        return {
          enabled: cfg.enabled,
          botToken: cfg.botToken,
          watchFeeds: cfg.watchFeeds,
          digestChannel: cfg.digestChannel,
          channelAllowlist: cfg.channelAllowlist,
        };
      },
      seen: watchSeen,
      slackApi: api,
      localClient,
      runJob: (key, fn) => jobs.run(key, fn),
      WebSocket: options.WebSocket,
      timers: options.timers,
      fetchImpl: options.fetchImpl,
      onPause: ({ reason, message }) => {
        emitStatus({
          digest: { paused: true, reason, message },
        });
      },
      onStatus: (next) => {
        if (next && next.digest) emitStatus({ digest: { ...status.digest, ...next.digest } });
      },
    });
    return watch;
  }

  function ensureWatchRunning() {
    const live = store.getSlackPlain();
    if (!live.enabled || digestIsPaused()) return;
    const runner = attachWatch();
    if (!runner) return;
    if (runner.isStopped()) runner.start();
  }

  function emitStatus(next) {
    status = { ...status, ...next };
    if (typeof options.onStatus === "function") options.onStatus({ ...status });
  }

  function publicView() {
    return {
      ...store.getSlackPublic(),
      connection: { ...status },
    };
  }

  async function stopRuntime() {
    if (watch && typeof watch.stop === "function") {
      watch.stop();
    }
    watch = null;
    if (runtime && typeof runtime.stop === "function") {
      await runtime.stop();
    }
    runtime = null;
  }

  async function startRuntime() {
    const cfg = store.getSlackPlain();
    if (!cfg.enabled || !cfg.botToken || !cfg.appToken) {
      await stopRuntime();
      emitStatus({ state: "off", workspace: cfg.teamName || "" });
      return publicView();
    }
    await stopRuntime();
    const pipeline = createPipeline({
      slackApi: api,
      localClient,
      botToken: cfg.botToken,
      botUserId: cfg.botUserId,
    });
    runtime = createRuntime({
      botToken: cfg.botToken,
      appToken: cfg.appToken,
      teamId: cfg.teamId,
      teamName: cfg.teamName,
      botUserId: cfg.botUserId,
      botName: cfg.botName,
      channelAllowlist: cfg.channelAllowlist,
      slackApi: api,
      WebSocket: options.WebSocket,
      timers: options.timers,
      onStatus: (next) => {
        emitStatus({
          state: next.state,
          workspace: next.workspace || cfg.teamName || "",
          fatal: Boolean(next.fatal),
          error: next.error,
        });
        const mismatch = Boolean(
          next.workspace && cfg.teamName && next.workspace !== cfg.teamName
        );
        if (watch && (next.fatal || next.state === "off" || mismatch)) {
          watch.stop();
          return;
        }
        if (next.state === "connected") ensureWatchRunning();
      },
      onAuth: (auth) => {
        store.setSlack({
          teamId: auth.teamId,
          teamName: auth.teamName,
          botUserId: auth.botUserId,
          botName: auth.botName,
        });
      },
      onSupportedLink: async (evt) => {
        if (!evt.ts || !evt.channel) return;
        await jobs.run(`${evt.channel}:${evt.ts}`, (signal, jobId) =>
          pipeline.handleSupportedLink(evt, signal, jobId)
        );
      },
      onThreadQuestion: async (evt) => {
        if (!evt.ts || !evt.channel || !evt.threadTs) return;
        await jobs.run(`qa:${evt.channel}:${evt.threadTs}:${evt.ts}`, (signal, jobId) =>
          pipeline.handleThreadQuestion(evt, signal, jobId)
        );
      },
    });
    try {
      await runtime.start();
      ensureWatchRunning();
    } catch {
      emitStatus({ state: "error", workspace: store.getSlackPublic().teamName || "" });
    }
    return publicView();
  }

  async function sync() {
    if (starting) return starting;
    starting = startRuntime().finally(() => {
      starting = null;
    });
    return starting;
  }

  function buildNext(current, patch) {
    const next = {
      enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
      channelAllowlist:
        patch.channelAllowlist !== undefined
          ? parseChannelAllowlist(patch.channelAllowlist)
          : current.channelAllowlist,
      botToken: current.botToken,
      appToken: current.appToken,
      watchFeeds:
        patch.watchlist !== undefined
          ? parseWatchlistText(patch.watchlist).slice(0, 10)
          : patch.watchFeeds !== undefined
            ? parseWatchlistText(
                (Array.isArray(patch.watchFeeds) ? patch.watchFeeds : [])
                  .map((feed) => (feed && feed.url) || "")
                  .join("\n")
              ).slice(0, 10)
            : current.watchFeeds,
      digestChannel:
        patch.digestChannel !== undefined
          ? normalizeChannelId(patch.digestChannel)
          : current.digestChannel,
    };

    if (patch.botToken !== undefined && !looksMasked(patch.botToken)) {
      if (patch.botToken === "") {
        next.botToken = "";
      } else {
        const check = validateBotToken(patch.botToken);
        if (!check.ok) throw new Error(check.error);
        next.botToken = check.value;
      }
    }
    if (patch.appToken !== undefined && !looksMasked(patch.appToken)) {
      if (patch.appToken === "") {
        next.appToken = "";
      } else {
        const check = validateAppToken(patch.appToken);
        if (!check.ok) throw new Error(check.error);
        next.appToken = check.value;
      }
    }
    return next;
  }

  async function resolveAuth(current, next, resetWorkspace) {
    const tokensChanged =
      next.botToken !== current.botToken || next.appToken !== current.appToken;
    if (!tokensChanged || !next.botToken) return null;
    const auth = await api.authTest(next.botToken);
    if (!auth || !auth.ok) {
      throw new Error((auth && auth.error) || "Slack auth.test failed");
    }
    const newTeam = auth.team_id || "";
    if (!newTeam) {
      throw new Error("auth.test did not return a team_id");
    }
    if (current.teamId && newTeam !== current.teamId && !resetWorkspace) {
      throw new Error(
        "This token belongs to a different Slack workspace. Click Reset workspace in Settings to pin the new team."
      );
    }
    return auth;
  }

  function writeSlack(current, next, auth) {
    const tokensChanged =
      next.botToken !== current.botToken || next.appToken !== current.appToken;
    if (tokensChanged && next.botToken) {
      store.setSlack({
        botToken: next.botToken,
        appToken: next.appToken,
        enabled: next.enabled,
        channelAllowlist: next.channelAllowlist,
        watchFeeds: next.watchFeeds,
        digestChannel: next.digestChannel,
        teamId: auth.team_id || "",
        teamName: auth.team || "",
        botUserId: auth.user_id || "",
        botName: auth.user || "",
      });
      return;
    }
    if (tokensChanged && !next.botToken) {
      store.setSlack({
        botToken: "",
        appToken: next.appToken,
        enabled: next.enabled,
        channelAllowlist: next.channelAllowlist,
        watchFeeds: next.watchFeeds,
        digestChannel: next.digestChannel,
        teamId: "",
        teamName: "",
        botUserId: "",
        botName: "",
      });
      return;
    }
    store.setSlack({
      botToken: next.botToken,
      appToken: next.appToken,
      enabled: next.enabled,
      channelAllowlist: next.channelAllowlist,
      watchFeeds: next.watchFeeds,
      digestChannel: next.digestChannel,
    });
  }

  async function applyPatch(patch, meta = {}) {
    const requestId = meta.requestId;
    if (requestId && !pendingRequests.has(requestId)) {
      pendingRequests.set(requestId, { cancelled: false });
    }
    const isCancelled = () =>
      Boolean(
        (typeof meta.isCancelled === "function" && meta.isCancelled()) ||
          (requestId && pendingRequests.get(requestId)?.cancelled)
      );

    let needsConfirm = false;
    let tookLock = false;
    try {
      let current = store.getSlackPlain();
      let next = buildNext(current, patch);
      const tokensChanged =
        next.botToken !== current.botToken || next.appToken !== current.appToken;
      const resetWorkspace = Boolean(patch.resetWorkspace);
      const allowlistAdded = allowlistIdsAdded(current.channelAllowlist, next.channelAllowlist);
      const enabledOn = Boolean(next.enabled && !current.enabled);
      const watchlistChanged = watchFeedsChanged(current.watchFeeds, next.watchFeeds);
      const digestChannelChanged = (current.digestChannel || "") !== (next.digestChannel || "");
      needsConfirm =
        tokensChanged ||
        resetWorkspace ||
        allowlistAdded ||
        enabledOn ||
        watchlistChanged ||
        digestChannelChanged;

      if (needsConfirm && confirmOpen) {
        throw busyError();
      }

      let auth = null;
      if (needsConfirm) {
        confirmOpen = true;
        tookLock = true;
      }
      auth = await resolveAuth(current, next, resetWorkspace);
      if (isCancelled()) throw cancelledError();

      if (needsConfirm) {
        const confirm = options.confirmSensitiveChange;
        if (typeof confirm !== "function") {
          throw cancelledError("Tusk settings changes need confirmation in the menu-bar app.");
        }
        const ok = await confirm({
          workspace: (auth && auth.team) || current.teamName || "",
          resetWorkspace,
          tokensChanged,
          allowlistAdded,
          enabledOn,
          watchlistChanged,
          digestChannelChanged,
          teamId: (auth && auth.team_id) || "",
          authUrl: (auth && auth.url) || "",
          currentPin: current.teamId || "",
          newPin: (auth && auth.team_id) || "",
          oldDigestChannel: current.digestChannel || "",
          newDigestChannel: next.digestChannel || "",
          oldWatchlist: feedUrls(current.watchFeeds),
          newWatchlist: feedUrls(next.watchFeeds),
        });
        if (!ok) throw cancelledError();
        if (isCancelled()) throw cancelledError();

        current = store.getSlackPlain();
        next = buildNext(current, patch);
        auth = await resolveAuth(current, next, resetWorkspace);
      }

      if (isCancelled()) throw cancelledError();
      writeSlack(current, next, auth);
    } finally {
      if (tookLock) confirmOpen = false;
      if (requestId) pendingRequests.delete(requestId);
    }
    return sync();
  }

  function attachIpc(child) {
    if (!child || typeof child.on !== "function") return;
    child.on("message", (msg) => {
      if (!msg || !msg.requestId) return;
      if (msg.type === "tusk-get") {
        child.send({
          type: "tusk-get-result",
          requestId: msg.requestId,
          payload: publicView(),
        });
        return;
      }
      if (msg.type === "tusk-set-cancel" && msg.requestId) {
        const pending = pendingRequests.get(msg.requestId);
        if (pending) pending.cancelled = true;
        return;
      }
      if (msg.type === "tusk-set") {
        pendingRequests.set(msg.requestId, { cancelled: false });
        applyPatch(msg.payload || {}, { requestId: msg.requestId })
          .then((payload) => {
            child.send({
              type: "tusk-set-result",
              requestId: msg.requestId,
              payload,
            });
          })
          .catch((error) => {
            child.send({
              type: "tusk-set-result",
              requestId: msg.requestId,
              error: error.message,
              status: error.status,
            });
          });
      }
    });
  }

  return {
    sync,
    applyPatch,
    stop: async () => {
      jobs.cancelAll();
      await stopRuntime();
      emitStatus({ state: "off", workspace: status.workspace || "" });
    },
    getPublic: publicView,
    getStatus: () => ({ ...status }),
    attachIpc,
  };
}

module.exports = { createTuskManager };
