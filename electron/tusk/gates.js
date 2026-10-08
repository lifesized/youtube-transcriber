"use strict";

const CHANNEL_RE = /^C[A-Z0-9]{8,}$/;

function normalizeChannelId(id) {
  const s = String(id || "").trim().toUpperCase();
  return CHANNEL_RE.test(s) ? s : "";
}

function parseChannelAllowlist(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeChannelId).filter(Boolean);
  }
  if (typeof value !== "string" || !value.trim()) return [];
  return value.split(/[\s,]+/).map(normalizeChannelId).filter(Boolean);
}

function createDedupe(options = {}) {
  const max = options.max ?? 400;
  const seen = new Map();
  return {
    seen,
    check(id) {
      if (!id) return false;
      const key = String(id);
      if (seen.has(key)) return true;
      seen.set(key, Date.now());
      while (seen.size > max) {
        const oldest = seen.keys().next().value;
        seen.delete(oldest);
      }
      return false;
    },
  };
}

function createRateLimiter(options = {}) {
  const windowMs = options.windowMs ?? 10_000;
  const max = options.maxPerWindow ?? 3;
  const hits = new Map();
  return {
    allow(channel) {
      const key = String(channel || "");
      const now = Date.now();
      const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (list.length >= max) {
        hits.set(key, list);
        return false;
      }
      list.push(now);
      hits.set(key, list);
      return true;
    },
  };
}

function isPlainUserMessage(event) {
  if (!event || typeof event !== "object") return false;
  if (event.bot_id) return false;
  if (event.subtype) return false;
  if (event.type !== "message" && event.type !== "app_mention") return false;
  return true;
}

function teamAllowed(eventTeamId, storedTeamId) {
  if (!storedTeamId) return true;
  return Boolean(eventTeamId) && eventTeamId === storedTeamId;
}

function channelAllowed(channelId, allowlist) {
  const list = parseChannelAllowlist(allowlist);
  if (list.length === 0) return true;
  const id = normalizeChannelId(channelId);
  return Boolean(id) && list.includes(id);
}

function isSelfMessage(event, botUserId) {
  return Boolean(botUserId && event && event.user && event.user === botUserId);
}

/**
 * Gate a Slack events_api envelope. Returns { ok, reason } without logging secrets.
 */
function gateEvent(envelope, state, helpers) {
  const payload = envelope && envelope.payload ? envelope.payload : envelope;
  const event = payload && payload.event;
  const teamId = payload && payload.team_id;
  const eventId = payload && payload.event_id;
  const clientMsgId = event && event.client_msg_id;

  if (!event) return { ok: false, reason: "no_event" };
  if (!teamAllowed(teamId, state.teamId)) return { ok: false, reason: "wrong_team" };
  if (!isPlainUserMessage(event)) return { ok: false, reason: "ignored_message" };
  if (isSelfMessage(event, state.botUserId)) return { ok: false, reason: "self" };
  if (!channelAllowed(event.channel, state.channelAllowlist)) {
    return { ok: false, reason: "channel" };
  }
  if (helpers.dedupe.check(eventId) || helpers.dedupe.check(clientMsgId)) {
    return { ok: false, reason: "deduped" };
  }
  if (!helpers.rateLimit.allow(event.channel)) return { ok: false, reason: "rate_limited" };
  return {
    ok: true,
    event,
    teamId,
    channel: event.channel,
    ts: event.ts,
    text: typeof event.text === "string" ? event.text : "",
  };
}

function gateSlashCommand(envelope, state) {
  const payload = envelope && envelope.payload ? envelope.payload : envelope;
  const teamId = payload && payload.team_id;
  const channel = payload && payload.channel_id;
  if (!teamAllowed(teamId, state.teamId)) return { ok: false, reason: "wrong_team" };
  if (!channelAllowed(channel, state.channelAllowlist)) {
    return { ok: false, reason: "channel" };
  }
  return {
    ok: true,
    teamId,
    channel,
    text: typeof payload.text === "string" ? payload.text : "",
    userId: payload.user_id,
  };
}

module.exports = {
  normalizeChannelId,
  parseChannelAllowlist,
  createDedupe,
  createRateLimiter,
  isPlainUserMessage,
  teamAllowed,
  channelAllowed,
  isSelfMessage,
  gateEvent,
  gateSlashCommand,
};
