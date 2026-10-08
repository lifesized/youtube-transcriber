"use strict";

const { validateBotToken, validateAppToken, looksMasked } = require("./tokens.js");
const { parseChannelAllowlist } = require("./gates.js");
const { createTuskRuntime } = require("./runtime.js");
const slackApi = require("./slack-api.js");

function createTuskManager(options = {}) {
  const store = options.store;
  const api = options.slackApi || slackApi;
  const createRuntime = options.createRuntime || createTuskRuntime;
  let runtime = null;
  let status = { state: "off", workspace: "" };
  let starting = null;

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
        });
      },
      onAuth: (auth) => {
        store.setSlack({
          teamId: cfg.teamId || auth.teamId,
          teamName: auth.teamName,
          botUserId: auth.botUserId,
          botName: auth.botName,
        });
      },
      onSupportedLink: async (evt) => {
        if (!evt.ts || !evt.channel) return;
        try {
          await api.addReaction({
            botToken: cfg.botToken,
            channel: evt.channel,
            timestamp: evt.ts,
            name: "eyes",
          });
        } catch {
          emitStatus({ state: status.state === "connected" ? "connected" : "error", workspace: status.workspace });
        }
      },
    });
    try {
      await runtime.start();
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

  async function applyPatch(patch) {
    const current = store.getSlackPlain();
    const next = {
      enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
      channelAllowlist:
        patch.channelAllowlist !== undefined
          ? parseChannelAllowlist(patch.channelAllowlist)
          : current.channelAllowlist,
      botToken: current.botToken,
      appToken: current.appToken,
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

    const tokensChanged =
      next.botToken !== current.botToken || next.appToken !== current.appToken;
    if (tokensChanged && next.botToken) {
      const auth = await api.authTest(next.botToken);
      if (!auth || !auth.ok) {
        throw new Error((auth && auth.error) || "Slack auth.test failed");
      }
      store.setSlack({
        botToken: next.botToken,
        appToken: next.appToken,
        enabled: next.enabled,
        channelAllowlist: next.channelAllowlist,
        teamId: current.teamId || auth.team_id || "",
        teamName: auth.team || "",
        botUserId: auth.user_id || "",
        botName: auth.user || "",
      });
    } else {
      store.setSlack({
        botToken: next.botToken,
        appToken: next.appToken,
        enabled: next.enabled,
        channelAllowlist: next.channelAllowlist,
      });
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
      if (msg.type === "tusk-set") {
        applyPatch(msg.payload || {})
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
            });
          });
      }
    });
  }

  return {
    sync,
    applyPatch,
    stop: async () => {
      await stopRuntime();
      emitStatus({ state: "off", workspace: status.workspace || "" });
    },
    getPublic: publicView,
    getStatus: () => ({ ...status }),
    attachIpc,
  };
}

module.exports = { createTuskManager };
