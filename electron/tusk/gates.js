"use strict";

const CHANNEL_RE = /^C[A-Z0-9]{8,}$/;
const DENIED_CONVERSATION_HINT =
  "Tusk only runs in public channels it has been invited to, or channels on the allowlist in Settings.";

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

function allowBucket(hits, key, now, windowMs, max) {
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  return true;
}

function createRateLimiter(options = {}) {
  const windowMs = options.windowMs ?? 10_000;
  const maxPerChannel = options.maxPerChannel ?? options.maxPerWindow ?? 3;
  const maxPerUser = options.maxPerUser ?? 8;
  const maxGlobal = options.maxGlobal ?? 20;
  const hits = new Map();
  return {
    allow(channel) {
      return allowBucket(hits, `c:${channel || ""}`, Date.now(), windowMs, maxPerChannel);
    },
    allowUser(userId) {
      return allowBucket(hits, `u:${userId || "unknown"}`, Date.now(), windowMs, maxPerUser);
    },
    allowGlobal() {
      return allowBucket(hits, "g:*", Date.now(), windowMs, maxGlobal);
    },
    allowAll({ channel, userId } = {}) {
      const now = Date.now();
      if (!allowBucket(hits, "g:*", now, windowMs, maxGlobal)) return false;
      if (!allowBucket(hits, `u:${userId || "unknown"}`, now, windowMs, maxPerUser)) return false;
      if (!allowBucket(hits, `c:${channel || ""}`, now, windowMs, maxPerChannel)) return false;
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
  if (!storedTeamId) return false;
  return Boolean(eventTeamId) && eventTeamId === storedTeamId;
}

function conversationKind(channelId, channelType) {
  const type = String(channelType || "").toLowerCase();
  const id = String(channelId || "");
  if (type === "im" || id.startsWith("D")) return "im";
  if (type === "mpim") return "mpim";
  if (type === "group" || id.startsWith("G")) return "group";
  if (type === "channel") return "channel";
  if (CHANNEL_RE.test(id.toUpperCase())) return "channel";
  return "unknown";
}

function channelAllowed(channelId, allowlist, channelType) {
  const kind = conversationKind(channelId, channelType);
  if (kind === "im" || kind === "mpim" || kind === "group" || kind === "unknown") {
    return false;
  }
  const list = parseChannelAllowlist(allowlist);
  if (list.length === 0) return kind === "channel";
  const id = normalizeChannelId(channelId);
  return Boolean(id) && list.includes(id);
}

function isSelfMessage(event, botUserId) {
  return Boolean(botUserId && event && event.user && event.user === botUserId);
}

function eventAuthorTeam(event, payloadTeamId) {
  if (!event || typeof event !== "object") return payloadTeamId;
  return event.user_team || event.source_team || event.team || payloadTeamId;
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
  const authorTeam = eventAuthorTeam(event, teamId);

  if (!event) return { ok: false, reason: "no_event" };
  if (!teamAllowed(teamId, state.teamId)) return { ok: false, reason: "wrong_team" };
  if (!teamAllowed(authorTeam, state.teamId)) return { ok: false, reason: "slack_connect" };
  if (!isPlainUserMessage(event)) return { ok: false, reason: "ignored_message" };
  if (isSelfMessage(event, state.botUserId)) return { ok: false, reason: "self" };
  if (!channelAllowed(event.channel, state.channelAllowlist, event.channel_type)) {
    return { ok: false, reason: "channel" };
  }
  if (helpers.dedupe.check(eventId) || helpers.dedupe.check(clientMsgId)) {
    return { ok: false, reason: "deduped" };
  }
  if (!helpers.rateLimit.allowAll({ channel: event.channel, userId: event.user })) {
    return { ok: false, reason: "rate_limited" };
  }
  return {
    ok: true,
    event,
    teamId,
    channel: event.channel,
    ts: event.ts,
    text: typeof event.text === "string" ? event.text : "",
  };
}

function gateSlashCommand(envelope, state, helpers) {
  const payload = envelope && envelope.payload ? envelope.payload : envelope;
  const teamId = payload && payload.team_id;
  const channel = payload && payload.channel_id;
  const userId = payload && payload.user_id;
  if (!teamAllowed(teamId, state.teamId)) {
    return { ok: false, reason: "wrong_team", hint: DENIED_CONVERSATION_HINT };
  }
  if (!channelAllowed(channel, state.channelAllowlist, payload.channel_type)) {
    return { ok: false, reason: "channel", hint: DENIED_CONVERSATION_HINT };
  }
  if (helpers && helpers.rateLimit && !helpers.rateLimit.allowAll({ channel, userId })) {
    return { ok: false, reason: "rate_limited", hint: "Tusk is rate-limited. Try again in a few seconds." };
  }
  return {
    ok: true,
    teamId,
    channel,
    text: typeof payload.text === "string" ? payload.text : "",
    userId,
  };
}

module.exports = {
  normalizeChannelId,
  parseChannelAllowlist,
  createDedupe,
  createRateLimiter,
  isPlainUserMessage,
  teamAllowed,
  conversationKind,
  channelAllowed,
  isSelfMessage,
  eventAuthorTeam,
  gateEvent,
  gateSlashCommand,
  DENIED_CONVERSATION_HINT,
};
