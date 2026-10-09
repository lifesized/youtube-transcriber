import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gates = require(path.join(root, "electron/tusk/gates.js"));

function envelope(event, extra = {}) {
  return {
    type: "events_api",
    envelope_id: "env-1",
    payload: {
      team_id: extra.team_id || "THOME",
      event_id: extra.event_id || "Ev1",
      event,
    },
  };
}

function helpers(overrides = {}) {
  return {
    dedupe: gates.createDedupe(),
    rateLimit: gates.createRateLimiter({
      maxPerWindow: 2,
      maxPerChannel: 2,
      maxPerUser: 8,
      maxGlobal: 20,
      windowMs: 60_000,
      ...overrides,
    }),
  };
}

const userMessage = {
  type: "message",
  user: "Ujames",
  channel: "C01234567",
  channel_type: "channel",
  ts: "1710000000.000100",
  text: "https://youtu.be/dQw4w9WgXcQ",
  client_msg_id: "client-1",
};

const HOME = { teamId: "THOME", channelAllowlist: ["C01234567"] };

function slashPayload(extra = {}) {
  return {
    type: "slash_commands",
    payload: {
      team_id: "THOME",
      channel_id: "C01234567",
      text: "help",
      user_id: "Ujames",
      ...extra,
    },
  };
}

test("empty team pin denies every event until auth.test sets it", () => {
  const h = helpers();
  assert.equal(gates.teamAllowed("THOME", ""), false);
  assert.equal(gates.gateEvent(envelope(userMessage), { teamId: "", channelAllowlist: HOME.channelAllowlist }, h).reason, "wrong_team");
  assert.equal(gates.gateEvent(envelope(userMessage), HOME, h).ok, true);
  const other = envelope(userMessage, { team_id: "TOTHER", event_id: "Ev2" });
  assert.equal(gates.gateEvent(other, HOME, helpers()).reason, "wrong_team");
});

test("is_ext_shared_channel is rejected unless the channel is allowlisted", () => {
  const shared = { ...userMessage, is_ext_shared_channel: true };
  assert.equal(
    gates.gateEvent(envelope(shared), { teamId: "THOME", channelAllowlist: [] }, helpers()).reason,
    "ext_shared"
  );
  assert.equal(
    gates.gateEvent(envelope(shared), { teamId: "THOME", channelAllowlist: ["C99999999"] }, helpers())
      .reason,
    "ext_shared"
  );
  assert.equal(gates.gateEvent(envelope(shared), HOME, helpers()).ok, true);
  assert.equal(
    gates.gateSlashCommand(slashPayload({ is_ext_shared_channel: true }), { teamId: "THOME" }, helpers())
      .reason,
    "ext_shared"
  );
  assert.equal(
    gates.gateSlashCommand(slashPayload({ is_ext_shared_channel: true }), HOME, helpers()).ok,
    true
  );
});

test("Slack Connect external members are ignored even in the pinned workspace", () => {
  const h = helpers();
  const external = envelope({ ...userMessage, user_team: "TEXT", team: "TEXT" });
  assert.equal(gates.gateEvent(external, HOME, h).reason, "slack_connect");
});

test("empty allowlist denies every conversation, including public C… ids", () => {
  assert.equal(gates.channelAllowed("C01234567", []), false);
  assert.equal(gates.channelAllowed("C01234567", [], "channel"), false);
  assert.equal(gates.channelAllowed("C01234567", [], undefined), false);
  assert.equal(gates.channelAllowed("D01234567", []), false);
  assert.equal(gates.channelAllowed("C01234567", [], "im"), false);
  assert.equal(gates.channelAllowed("C01234567", [], "mpim"), false);
  assert.equal(gates.channelAllowed("G01234567", []), false);
  assert.equal(gates.channelAllowed("C01234567", [], "group"), false);
  assert.equal(gates.gateEvent(envelope(userMessage), { teamId: "THOME" }, helpers()).reason, "channel");
  assert.equal(gates.gateEvent(envelope(userMessage), { teamId: "THOME", channelAllowlist: [] }, helpers()).reason, "channel");
  const mention = envelope({
    ...userMessage,
    type: "app_mention",
    channel_type: undefined,
    text: "<@Ubot> https://youtu.be/dQw4w9WgXcQ",
  });
  delete mention.payload.event.channel_type;
  assert.equal(gates.gateEvent(mention, { teamId: "THOME" }, helpers()).reason, "channel");
  assert.equal(gates.gateSlashCommand(slashPayload(), { teamId: "THOME" }, helpers()).reason, "channel");
});

test("missing channel_type is unknown and denied unless the channel is allowlisted", () => {
  assert.equal(gates.conversationKind("C01234567"), "unknown");
  assert.equal(gates.conversationKind("C01234567", ""), "unknown");
  assert.equal(gates.conversationKind("C01234567", "channel"), "channel");
  assert.equal(gates.channelAllowed("C01234567", ["C01234567"]), true);
  assert.equal(gates.channelAllowed("C01234567", ["C01234567"], undefined), true);
  assert.equal(gates.channelAllowed("C01234567", ["C01234567"], "channel"), true);
  assert.equal(gates.channelAllowed("C99999999", ["C01234567"]), false);
  const mention = envelope({
    ...userMessage,
    type: "app_mention",
    text: "<@Ubot> https://youtu.be/dQw4w9WgXcQ",
  });
  delete mention.payload.event.channel_type;
  assert.equal(gates.gateEvent(mention, HOME, helpers()).ok, true);
  assert.equal(
    gates.gateEvent(envelope(userMessage), { teamId: "THOME", channelAllowlist: ["C99999999"] }, helpers())
      .reason,
    "channel"
  );
});

test("slash channel_name denies private, DM, and MPDM unless allowlisted", () => {
  assert.equal(gates.conversationKind("C01234567", undefined, "privategroup"), "group");
  assert.equal(gates.conversationKind("C01234567", undefined, "directmessage"), "im");
  assert.equal(gates.conversationKind("C01234567", undefined, "mpdm-Ujames--Ubot"), "mpim");
  assert.equal(gates.channelAllowed("C01234567", [], undefined, "privategroup"), false);
  assert.equal(gates.channelAllowed("C01234567", ["C01234567"], undefined, "privategroup"), true);
  assert.equal(gates.channelAllowed("C01234567", ["C01234567"], undefined, "directmessage"), false);
  assert.equal(gates.channelAllowed("C01234567", ["C01234567"], undefined, "mpdm-Ujames--Ubot"), false);

  const privateSlash = gates.gateSlashCommand(
    slashPayload({ channel_name: "privategroup" }),
    { teamId: "THOME" },
    helpers()
  );
  assert.equal(privateSlash.ok, false);
  assert.equal(privateSlash.reason, "channel");
  assert.match(privateSlash.hint, /allowlist/);

  assert.equal(
    gates.gateSlashCommand(slashPayload({ channel_name: "privategroup" }), HOME, helpers()).ok,
    true
  );
  assert.equal(
    gates.gateSlashCommand(slashPayload({ channel_name: "directmessage" }), HOME, helpers()).reason,
    "channel"
  );
  assert.equal(
    gates.gateSlashCommand(slashPayload({ channel_name: "mpdm-Ujames--Ubot" }), HOME, helpers()).reason,
    "channel"
  );
});

test("slash commands outside allowed conversations get an ephemeral hint", () => {
  const slash = slashPayload({ channel_id: "D01234567", channel_name: "directmessage" });
  const denied = gates.gateSlashCommand(slash, HOME, helpers());
  assert.equal(denied.ok, false);
  assert.match(denied.hint, /allowlist/);
  const allowed = gates.gateSlashCommand(slashPayload({ channel_type: "channel" }), HOME, helpers());
  assert.equal(allowed.ok, true);
});

test("ignores bots, self, and message subtypes", () => {
  const h = helpers();
  const state = { ...HOME, botUserId: "Ubot" };
  assert.equal(
    gates.gateEvent(envelope({ ...userMessage, bot_id: "B1" }), state, h).reason,
    "ignored_message"
  );
  assert.equal(
    gates.gateEvent(envelope({ ...userMessage, subtype: "message_changed" }), state, h).reason,
    "ignored_message"
  );
  assert.equal(
    gates.gateEvent(envelope({ ...userMessage, user: "Ubot" }), state, helpers()).reason,
    "self"
  );
  assert.equal(gates.gateEvent(envelope(userMessage), state, helpers()).ok, true);
});

test("dedupes by event_id and client_msg_id", () => {
  const h = helpers();
  const state = HOME;
  assert.equal(gates.gateEvent(envelope(userMessage, { event_id: "EvA" }), state, h).ok, true);
  assert.equal(gates.gateEvent(envelope(userMessage, { event_id: "EvA" }), state, h).reason, "deduped");
  assert.equal(
    gates.gateEvent(
      envelope({ ...userMessage, client_msg_id: "client-1" }, { event_id: "EvB" }),
      state,
      h
    ).reason,
    "deduped"
  );
});

test("rate-limits a channel after the window fills", () => {
  const h = helpers();
  const state = HOME;
  assert.equal(gates.gateEvent(envelope(userMessage, { event_id: "R1" }), state, h).ok, true);
  assert.equal(
    gates.gateEvent(
      envelope({ ...userMessage, client_msg_id: "c2" }, { event_id: "R2" }),
      state,
      h
    ).ok,
    true
  );
  assert.equal(
    gates.gateEvent(
      envelope({ ...userMessage, client_msg_id: "c3" }, { event_id: "R3" }),
      state,
      h
    ).reason,
    "rate_limited"
  );
});

test("a rate-limited user does not drain the global budget", () => {
  const limiter = gates.createRateLimiter({
    maxPerChannel: 20,
    maxPerUser: 1,
    maxGlobal: 2,
    windowMs: 60_000,
  });
  assert.equal(limiter.allowAll({ channel: "C01234567", userId: "Ujames" }), true);
  assert.equal(limiter.allowAll({ channel: "C01234567", userId: "Ujames" }), false);
  assert.equal(limiter.allowAll({ channel: "C99999999", userId: "Uother" }), true);
});

test("rate-limits per user and globally, including slash commands", () => {
  const perUser = helpers({ maxPerChannel: 20, maxPerUser: 1, maxGlobal: 20 });
  const state = { teamId: "THOME", channelAllowlist: ["C01234567", "C99999999"] };
  assert.equal(gates.gateEvent(envelope(userMessage, { event_id: "U1" }), state, perUser).ok, true);
  assert.equal(
    gates.gateEvent(
      envelope({ ...userMessage, client_msg_id: "u2", channel: "C99999999" }, { event_id: "U2" }),
      state,
      perUser
    ).reason,
    "rate_limited"
  );

  const global = helpers({ maxPerChannel: 20, maxPerUser: 20, maxGlobal: 1 });
  assert.equal(gates.gateEvent(envelope(userMessage, { event_id: "G1" }), state, global).ok, true);
  assert.equal(
    gates.gateSlashCommand(
      {
        type: "slash_commands",
        payload: {
          team_id: "THOME",
          channel_id: "C01234567",
          text: "help",
          user_id: "Uother",
        },
      },
      state,
      global
    ).reason,
    "rate_limited"
  );
});
