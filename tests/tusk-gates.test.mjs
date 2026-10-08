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

function helpers() {
  return { dedupe: gates.createDedupe(), rateLimit: gates.createRateLimiter({ maxPerWindow: 2, windowMs: 60_000 }) };
}

const userMessage = {
  type: "message",
  user: "Ujames",
  channel: "C01234567",
  ts: "1710000000.000100",
  text: "https://youtu.be/dQw4w9WgXcQ",
  client_msg_id: "client-1",
};

test("team gate records first team and ignores others", () => {
  const h = helpers();
  assert.equal(gates.gateEvent(envelope(userMessage), { teamId: "" }, h).ok, true);
  const other = envelope(userMessage, { team_id: "TOTHER", event_id: "Ev2" });
  assert.equal(gates.gateEvent(other, { teamId: "THOME" }, h).reason, "wrong_team");
});

test("channel allowlist empty means invited channels; set list is exclusive", () => {
  const h = helpers();
  assert.equal(gates.channelAllowed("C01234567", []), true);
  assert.equal(gates.channelAllowed("C01234567", ["C01234567"]), true);
  assert.equal(gates.channelAllowed("C99999999", ["C01234567"]), false);
  assert.equal(
    gates.gateEvent(envelope(userMessage), { teamId: "THOME", channelAllowlist: ["C99999999"] }, h).reason,
    "channel"
  );
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
