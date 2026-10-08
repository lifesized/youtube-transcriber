"use strict";

const { validateBotToken, validateAppToken, looksMasked } = require("./tokens.js");
const { parseChannelAllowlist } = require("./gates.js");
const { createTuskRuntime } = require("./runtime.js");
const { createPipeline } = require("./pipeline.js");
const { createJobGate } = require("./jobs.js");
const { createLocalClient } = require("./local-client.js");
const slackApi = require("./slack-api.js");

function createTuskManager(options = {}) {
  const store = options.store;
  const api = options.slackApi || slackApi;
  const createRuntime = options.createRuntime || createTuskRuntime;
  const jobs = options.jobGate || createJobGate();
  const localClient = options.localClient || createLocalClient();
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
        });
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
        await jobs.run(`${evt.channel}:${evt.ts}`, (signal) =>
          pipeline.handleSupportedLink(evt, signal)
        );
      },
      onThreadQuestion: async (evt) => {
        if (!evt.ts || !evt.channel || !evt.threadTs) return;
        await jobs.run(`qa:${evt.channel}:${evt.threadTs}:${evt.ts}`, (signal) =>
          pipeline.handleThreadQuestion(evt, signal)
        );
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
      const newTeam = auth.team_id || "";
      if (!newTeam) {
        throw new Error("auth.test did not return a team_id");
      }
      if (current.teamId && newTeam !== current.teamId && !patch.resetWorkspace) {
        throw new Error(
          "This token belongs to a different Slack workspace. Click Reset workspace in Settings to pin the new team."
        );
      }
      store.setSlack({
        botToken: next.botToken,
        appToken: next.appToken,
        enabled: next.enabled,
        channelAllowlist: next.channelAllowlist,
        teamId: newTeam,
        teamName: auth.team || "",
        botUserId: auth.user_id || "",
        botName: auth.user || "",
      });
    } else if (tokensChanged && !next.botToken) {
      store.setSlack({
        botToken: "",
        appToken: next.appToken,
        enabled: next.enabled,
        channelAllowlist: next.channelAllowlist,
        teamId: "",
        teamName: "",
        botUserId: "",
        botName: "",
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
