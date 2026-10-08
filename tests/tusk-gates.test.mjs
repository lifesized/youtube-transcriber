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

test("empty team pin denies every event until auth.test sets it", () => {
  const h = helpers();
  assert.equal(gates.teamAllowed("THOME", ""), false);
  assert.equal(gates.gateEvent(envelope(userMessage), { teamId: "" }, h).reason, "wrong_team");
  assert.equal(gates.gateEvent(envelope(userMessage), { teamId: "THOME" }, h).ok, true);
  const other = envelope(userMessage, { team_id: "TOTHER", event_id: "Ev2" });
  assert.equal(gates.gateEvent(other, { teamId: "THOME" }, helpers()).reason, "wrong_team");
});

test("Slack Connect external members are ignored even in the pinned workspace", () => {
  const h = helpers();
  const external = envelope({ ...userMessage, user_team: "TEXT", team: "TEXT" });
  assert.equal(gates.gateEvent(external, { teamId: "THOME" }, h).reason, "slack_connect");
});

test("empty allowlist is public channels only; DMs MPIMs and private channels are denied", () => {
  assert.equal(gates.channelAllowed("C01234567", []), true);
  assert.equal(gates.channelAllowed("C01234567", [], "channel"), true);
  assert.equal(gates.channelAllowed("D01234567", []), false);
  assert.equal(gates.channelAllowed("C01234567", [], "im"), false);
  assert.equal(gates.channelAllowed("C01234567", [], "mpim"), false);
  assert.equal(gates.channelAllowed("G01234567", []), false);
  assert.equal(gates.channelAllowed("C01234567", [], "group"), false);
  assert.equal(gates.channelAllowed("C01234567", ["C01234567"]), true);
  assert.equal(gates.channelAllowed("C99999999", ["C01234567"]), false);
  assert.equal(
    gates.gateEvent(envelope(userMessage), { teamId: "THOME", channelAllowlist: ["C99999999"] }, helpers())
      .reason,
    "channel"
  );
  const dm = envelope({ ...userMessage, channel: "D01234567", channel_type: "im" });
  assert.equal(gates.gateEvent(dm, { teamId: "THOME" }, helpers()).reason, "channel");
});

test("slash commands outside allowed conversations get an ephemeral hint", () => {
  const slash = {
    type: "slash_commands",
    payload: { team_id: "THOME", channel_id: "D01234567", text: "help", user_id: "Ujames" },
  };
  const denied = gates.gateSlashCommand(slash, { teamId: "THOME" }, helpers());
  assert.equal(denied.ok, false);
  assert.match(denied.hint, /public channels/);
  const allowed = gates.gateSlashCommand(
    {
      type: "slash_commands",
      payload: { team_id: "THOME", channel_id: "C01234567", text: "help", user_id: "Ujames" },
    },
    { teamId: "THOME" },
    helpers()
  );
  assert.equal(allowed.ok, true);
});

test("ignores bots, self, and message subtypes", () => {
  const h = helpers();
  const state = { teamId: "THOME", botUserId: "Ubot" };
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
  const state = { teamId: "THOME" };
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
  const state = { teamId: "THOME" };
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

test("rate-limits per user and globally, including slash commands", () => {
  const perUser = helpers({ maxPerChannel: 20, maxPerUser: 1, maxGlobal: 20 });
  const state = { teamId: "THOME" };
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
