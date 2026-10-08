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

async function parseSlackResponse(res) {
  if (!res.ok) {
    let slackError;
    try {
      const responseBody = await res.json();
      slackError = responseBody && responseBody.error;
    } catch {
      // Non-JSON body
    }
    throw new SlackApiError({ status: res.status, slackError });
  }
  return res.json();
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
    unfurl_links: false,
    unfurl_media: false,
  });
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
  return parseSlackResponse(res);
}

module.exports = {
  SlackApiError,
  authTest,
  addReaction,
  postMessage,
  openSocketConnection,
};
