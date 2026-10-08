"use strict";

const { createDedupe, createRateLimiter, gateEvent, gateSlashCommand } = require("./gates.js");
const { extractSupportedSlackUrls } = require("./detect.js");
const { parseSlashText, slashReply } = require("./commands.js");
const { isMentionTriggered } = require("./prompt.js");
const slackApi = require("./slack-api.js");

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const AUTH_FATAL_ERRORS = new Set([
  "invalid_auth",
  "token_revoked",
  "account_inactive",
  "link_disabled",
]);
const JITTER_MS = 250;

function defaultWebSocket() {
  if (typeof WebSocket === "undefined") {
    throw new Error("WebSocket is not available");
  }
  return WebSocket;
}

function slackErrorCode(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value.slackError) return String(value.slackError);
  if (value.error) return String(value.error);
  if (value.message) return String(value.message);
  return "";
}

function isFatalAuthError(value) {
  return AUTH_FATAL_ERRORS.has(slackErrorCode(value));
}

function isSlackSocketUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "wss:" && host.endsWith(".slack.com");
  } catch {
    return false;
  }
}

function createTuskRuntime(options = {}) {
  const api = options.slackApi || slackApi;
  const SocketImpl = options.WebSocket || defaultWebSocket();
  const timers = options.timers || {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  const random = typeof options.random === "function" ? options.random : Math.random;
  const dedupe = options.dedupe || createDedupe();
  const rateLimit = options.rateLimit || createRateLimiter();

  let ws = null;
  let wsGeneration = 0;
  let stopped = true;
  let fatal = false;
  let generation = 0;
  let connecting = false;
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

  function reconnectDelay(retryAfterMs) {
    if (retryAfterMs != null && Number.isFinite(Number(retryAfterMs)) && Number(retryAfterMs) >= 0) {
      return Number(retryAfterMs);
    }
    const base = BACKOFF_MS[Math.min(reconnectAttempt, BACKOFF_MS.length - 1)];
    return base + Math.floor(random() * JITTER_MS);
  }

  function scheduleReconnect(retryAfterMs) {
    if (stopped || fatal) return;
    clearReconnect();
    const delay = reconnectDelay(retryAfterMs);
    reconnectAttempt += 1;
    emitStatus({ state: "error", workspace: status.workspace || "" });
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null;
      connectSocket().catch((error) => {
        if (isFatalAuthError(error)) {
          stopPermanently(slackErrorCode(error));
          return;
        }
        scheduleReconnect(error && error.retryAfterMs);
      });
    }, delay);
  }

  function stopPermanently(reason) {
    fatal = true;
    stopped = true;
    generation += 1;
    connecting = false;
    clearReconnect();
    closeSocket();
    emitStatus({
      state: "error",
      workspace: status.workspace || "",
      fatal: true,
      error: reason || "auth_revoked",
    });
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
      if (ws && typeof ws.close === "function") {
        try {
          ws.close();
        } catch {
          // already closed; onClose reschedules if this is still the current socket
        }
      }
      return;
    }
    if (envelope.type === "slash_commands") {
      const gated = gateSlashCommand(envelope, options, helpers);
      if (!gated.ok) {
        ack(envelope, { text: gated.hint || "Tusk ignored that command." });
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
    const threadTs = gated.event.thread_ts || gated.ts;
    const mentioned =
      gated.event.type === "app_mention" || isMentionTriggered(gated.text, options.botUserId);
    if (urls.length) {
      if (typeof options.onSupportedLink === "function") {
        await options.onSupportedLink({
          channel: gated.channel,
          ts: gated.ts,
          threadTs,
          text: gated.text,
          urls,
          teamId: gated.teamId,
        });
      }
      return;
    }
    if (
      mentioned &&
      gated.event.thread_ts &&
      typeof options.onThreadQuestion === "function"
    ) {
      await options.onThreadQuestion({
        channel: gated.channel,
        ts: gated.ts,
        threadTs: gated.event.thread_ts,
        text: gated.text,
        teamId: gated.teamId,
        botUserId: options.botUserId,
      });
    }
  }

  function attachSocket(socket, socketGeneration) {
    const mySeq = (wsGeneration += 1);
    ws = socket;
    const onMessage = (raw) => {
      if (socketGeneration !== generation || mySeq !== wsGeneration) return;
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
      if (socketGeneration !== generation || mySeq !== wsGeneration) return;
      if (ws === socket) ws = null;
      if (!stopped && !fatal) scheduleReconnect();
    };
    const onError = () => {
      if (socketGeneration !== generation || mySeq !== wsGeneration) return;
      if (!stopped && !fatal) emitStatus({ state: "error", workspace: status.workspace || "" });
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

  function discardSocket(socket) {
    if (!socket || typeof socket.close !== "function") return;
    try {
      socket.close();
    } catch {
      // already closed
    }
  }

  async function connectSocketOnce(connectGeneration, appToken) {
    if (stopped || fatal || connectGeneration !== generation) return;
    const opened = await api.openSocketConnection(appToken);
    if (stopped || fatal || connectGeneration !== generation) {
      return;
    }
    if (options.appToken !== appToken) {
      return;
    }
    if (!opened || !opened.ok || !opened.url) {
      const code = (opened && opened.error) || "connections_open_failed";
      const error = new Error(code);
      error.slackError = code;
      error.retryAfterMs = opened && opened.retryAfterMs;
      if (AUTH_FATAL_ERRORS.has(code)) {
        stopPermanently(code);
        return;
      }
      throw error;
    }
    if (!isSlackSocketUrl(opened.url)) {
      throw new Error("invalid_socket_url");
    }
    if (stopped || fatal || connectGeneration !== generation || options.appToken !== appToken) {
      return;
    }
    const socket = new SocketImpl(opened.url);
    if (stopped || fatal || connectGeneration !== generation || options.appToken !== appToken) {
      discardSocket(socket);
      return;
    }
    const previous = ws;
    attachSocket(socket, connectGeneration);
    if (previous && previous !== socket) discardSocket(previous);
  }

  async function connectSocket() {
    if (stopped || fatal) return;
    if (connecting) return;
    connecting = true;
    const connectGeneration = generation;
    const appToken = options.appToken;
    try {
      await connectSocketOnce(connectGeneration, appToken);
    } finally {
      connecting = false;
    }
  }

  async function start() {
    fatal = false;
    stopped = false;
    generation += 1;
    connecting = false;
    clearReconnect();
    closeSocket();
    const auth = await api.authTest(options.botToken);
    if (stopped || fatal) return;
    if (!auth || !auth.ok) {
      const code = (auth && auth.error) || "auth_test_failed";
      if (AUTH_FATAL_ERRORS.has(code)) {
        stopPermanently(code);
        throw new Error(code);
      }
      emitStatus({ state: "error", workspace: "" });
      throw new Error(code);
    }
    const teamId = auth.team_id || "";
    if (!teamId) {
      emitStatus({ state: "error", workspace: "" });
      throw new Error("auth_test_missing_team");
    }
    if (options.teamId && options.teamId !== teamId) {
      emitStatus({ state: "error", workspace: auth.team || "" });
      throw new Error("workspace_mismatch");
    }
    options.teamId = teamId;
    options.teamName = auth.team || options.teamName;
    options.botUserId = auth.user_id || options.botUserId;
    options.botName = auth.user || options.botName;
    const workspace = auth.team || "";
    emitStatus({
      state: "starting",
      workspace,
      teamId,
      botUserId: auth.user_id || "",
      botName: auth.user || "",
    });
    if (typeof options.onAuth === "function") {
      options.onAuth({
        teamId,
        teamName: workspace,
        botUserId: auth.user_id || "",
        botName: auth.user || "",
      });
    }
    try {
      await connectSocket();
    } catch (error) {
      if (isFatalAuthError(error)) {
        stopPermanently(slackErrorCode(error));
        throw error;
      }
      emitStatus({ state: "error", workspace });
      scheduleReconnect(error && error.retryAfterMs);
      throw error;
    }
  }

  function closeSocket() {
    const current = ws;
    wsGeneration += 1;
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
    fatal = false;
    generation += 1;
    connecting = false;
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
    isFatal: () => fatal,
  };
}

module.exports = {
  createTuskRuntime,
  BACKOFF_MS,
  AUTH_FATAL_ERRORS,
  isSlackSocketUrl,
  isFatalAuthError,
};
