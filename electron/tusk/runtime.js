"use strict";

const { createDedupe, createRateLimiter, gateEvent, gateSlashCommand } = require("./gates.js");
const { extractSupportedSlackUrls } = require("./detect.js");
const { parseSlashText, slashReply } = require("./commands.js");
const slackApi = require("./slack-api.js");

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

function defaultWebSocket() {
  if (typeof WebSocket === "undefined") {
    throw new Error("WebSocket is not available");
  }
  return WebSocket;
}

function createTuskRuntime(options = {}) {
  const api = options.slackApi || slackApi;
  const SocketImpl = options.WebSocket || defaultWebSocket();
  const timers = options.timers || {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  const dedupe = options.dedupe || createDedupe();
  const rateLimit = options.rateLimit || createRateLimiter();

  let ws = null;
  let stopped = true;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let status = { state: "off", workspace: "" };
  const helpers = { dedupe, rateLimit };

  function emitStatus(next) {
    status = { ...status, ...next };
    if (typeof options.onStatus === "function") options.onStatus({ ...status });
  }

  function clearReconnect() {
    if (reconnectTimer != null) {
      timers.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    if (stopped) return;
    const delay = BACKOFF_MS[Math.min(reconnectAttempt, BACKOFF_MS.length - 1)];
    reconnectAttempt += 1;
    emitStatus({ state: "error", workspace: status.workspace || "" });
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null;
      connectSocket().catch(() => scheduleReconnect());
    }, delay);
  }

  function ack(envelope, payload) {
    if (!ws || typeof ws.send !== "function" || !envelope || !envelope.envelope_id) return;
    const body = { envelope_id: envelope.envelope_id };
    if (payload !== undefined) body.payload = payload;
    try {
      ws.send(JSON.stringify(body));
    } catch {
      // socket already closing
    }
  }

  async function handleEnvelope(envelope) {
    if (!envelope || typeof envelope !== "object") return;
    if (envelope.type === "hello") {
      reconnectAttempt = 0;
      emitStatus({ state: "connected", workspace: status.workspace || "" });
      return;
    }
    if (envelope.type === "disconnect") {
      closeSocket();
      scheduleReconnect();
      return;
    }
    if (envelope.type === "slash_commands") {
      const gated = gateSlashCommand(envelope, options);
      if (!gated.ok) {
        ack(envelope, { text: "Tusk ignored that command." });
        return;
      }
      const command = parseSlashText(gated.text);
      ack(envelope, {
        text: slashReply(command, {
          state: status.state,
          workspace: status.workspace || options.teamName,
          botName: options.botName,
          channelAllowlist: options.channelAllowlist,
        }),
      });
      return;
    }
    if (envelope.type !== "events_api") {
      ack(envelope);
      return;
    }
    ack(envelope);
    const gated = gateEvent(envelope, options, helpers);
    if (!gated.ok) return;
    const urls = extractSupportedSlackUrls(gated.text);
    if (!urls.length) return;
    if (typeof options.onSupportedLink === "function") {
      await options.onSupportedLink({
        channel: gated.channel,
        ts: gated.ts,
        text: gated.text,
        urls,
        teamId: gated.teamId,
      });
    }
  }

  function attachSocket(socket) {
    ws = socket;
    const onMessage = (raw) => {
      const data = raw && raw.data !== undefined ? raw.data : raw;
      let parsed;
      try {
        parsed = typeof data === "string" ? JSON.parse(data) : data;
      } catch {
        return;
      }
      handleEnvelope(parsed).catch(() => {});
    };
    const onClose = () => {
      if (ws === socket) ws = null;
      if (!stopped) scheduleReconnect();
    };
    const onError = () => {
      if (!stopped) emitStatus({ state: "error", workspace: status.workspace || "" });
    };
    if (typeof socket.addEventListener === "function") {
      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", onClose);
      socket.addEventListener("error", onError);
    } else {
      socket.onmessage = onMessage;
      socket.onclose = onClose;
      socket.onerror = onError;
    }
  }

  async function connectSocket() {
    if (stopped) return;
    const opened = await api.openSocketConnection(options.appToken);
    if (!opened || !opened.ok || !opened.url) {
      throw new Error((opened && opened.error) || "connections_open_failed");
    }
    const socket = new SocketImpl(opened.url);
    attachSocket(socket);
  }

  async function start() {
    stopped = false;
    clearReconnect();
    const auth = await api.authTest(options.botToken);
    if (!auth || !auth.ok) {
      emitStatus({ state: "error", workspace: "" });
      throw new Error((auth && auth.error) || "auth_test_failed");
    }
    const workspace = auth.team || "";
    emitStatus({
      state: "starting",
      workspace,
      teamId: auth.team_id || "",
      botUserId: auth.user_id || "",
      botName: auth.user || "",
    });
    if (typeof options.onAuth === "function") {
      options.onAuth({
        teamId: auth.team_id || "",
        teamName: workspace,
        botUserId: auth.user_id || "",
        botName: auth.user || "",
      });
    }
    try {
      await connectSocket();
    } catch (error) {
      emitStatus({ state: "error", workspace });
      scheduleReconnect();
      throw error;
    }
  }

  function closeSocket() {
    const current = ws;
    ws = null;
    if (current && typeof current.close === "function") {
      try {
        current.close();
      } catch {
        // already closed
      }
    }
  }

  async function stop() {
    stopped = true;
    clearReconnect();
    closeSocket();
    emitStatus({ state: "off", workspace: status.workspace || "" });
  }

  return {
    start,
    stop,
    handleEnvelope,
    getStatus: () => ({ ...status }),
    isStopped: () => stopped,
  };
}

module.exports = {
  createTuskRuntime,
  BACKOFF_MS,
};
