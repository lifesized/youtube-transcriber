"use strict";

/**
 * Slack Web API helpers for the Electron main process.
 * Never log the bot token or Authorization header.
 */

class SlackApiError extends Error {
  constructor(args) {
    super(
      args.message ??
        `Slack API HTTP ${args.status}${args.slackError ? ` (${args.slackError})` : ""}`
    );
    this.name = "SlackApiError";
    this.status = args.status;
    this.slackError = args.slackError;
  }
}

function isSlackFileUploadUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    return parsed.protocol === "https:" && parsed.hostname === "files.slack.com";
  } catch {
    return false;
  }
}

async function parseSlackResponse(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const slackError = body && body.error;
  if (!res.ok) {
    throw new SlackApiError({ status: res.status, slackError });
  }
  if (!body || body.ok === false) {
    throw new SlackApiError({
      status: res.status,
      slackError: slackError || "unknown_error",
      message: `Slack API error (${slackError || "unknown_error"})`,
    });
  }
  return body;
}

async function slackJson(url, botToken, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return parseSlackResponse(res);
}

async function slackForm(url, botToken, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: new URLSearchParams(body || {}),
  });
  return parseSlackResponse(res);
}

async function authTest(botToken) {
  return slackForm("https://slack.com/api/auth.test", botToken, {});
}

async function addReaction(args) {
  return slackJson("https://slack.com/api/reactions.add", args.botToken, {
    channel: args.channel,
    timestamp: args.timestamp,
    name: args.name,
  });
}

async function postMessage(args) {
  return slackJson("https://slack.com/api/chat.postMessage", args.botToken, {
    channel: args.channel,
    text: args.text,
    thread_ts: args.threadTs,
    blocks: args.blocks,
    unfurl_links: false,
    unfurl_media: false,
  });
}

async function updateMessage(args) {
  return slackJson("https://slack.com/api/chat.update", args.botToken, {
    channel: args.channel,
    ts: args.ts,
    text: args.text,
    blocks: args.blocks,
    unfurl_links: false,
    unfurl_media: false,
  });
}

async function uploadThreadFile(args) {
  const bytes = new TextEncoder().encode(args.content);
  const uploadUrl = await slackForm(
    "https://slack.com/api/files.getUploadURLExternal",
    args.botToken,
    {
      filename: args.filename,
      length: String(bytes.byteLength),
    }
  );
  if (!uploadUrl.ok || !uploadUrl.upload_url || !uploadUrl.file_id) {
    throw new SlackApiError({
      status: 200,
      slackError: uploadUrl.error || "slack_upload_url_failed",
      message: `Slack API error (${uploadUrl.error || "slack_upload_url_failed"})`,
    });
  }
  if (!isSlackFileUploadUrl(uploadUrl.upload_url)) {
    throw new SlackApiError({
      status: 200,
      slackError: "invalid_upload_url",
      message: "Slack API error (invalid_upload_url)",
    });
  }
  const upload = await fetch(uploadUrl.upload_url, {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: bytes,
  });
  if (!upload.ok) {
    throw new SlackApiError({
      status: upload.status,
      message: `Slack file upload HTTP ${upload.status}`,
    });
  }
  return slackForm("https://slack.com/api/files.completeUploadExternal", args.botToken, {
    files: JSON.stringify([{ id: uploadUrl.file_id, title: args.title }]),
    channel_id: args.channel,
    thread_ts: args.threadTs,
    ...(args.initialComment ? { initial_comment: args.initialComment } : {}),
  });
}

function parseRetryAfterMs(res) {
  const raw = res && res.headers && typeof res.headers.get === "function" ? res.headers.get("retry-after") : null;
  if (raw == null || raw === "") return undefined;
  const seconds = Number.parseFloat(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const when = Date.parse(raw);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return undefined;
}

async function openSocketConnection(appToken) {
  const res = await fetch("https://slack.com/api/apps.connections.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appToken}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: "",
  });
  const retryAfterMs = parseRetryAfterMs(res);
  let body;
  try {
    body = await res.json();
  } catch {
    body = { ok: false, error: res.ok ? "connections_open_failed" : `http_${res.status}` };
  }
  if (!body || typeof body !== "object") {
    body = { ok: false, error: "connections_open_failed" };
  }
  if (retryAfterMs != null) body.retryAfterMs = retryAfterMs;
  if (typeof body.ok !== "boolean") body.ok = Boolean(res.ok && body.url);
  if (!body.ok && !body.error) {
    body.error = res.ok ? "connections_open_failed" : `http_${res.status}`;
  }
  return body;
}

module.exports = {
  SlackApiError,
  authTest,
  addReaction,
  postMessage,
  updateMessage,
  uploadThreadFile,
  openSocketConnection,
  parseRetryAfterMs,
  isSlackFileUploadUrl,
};
