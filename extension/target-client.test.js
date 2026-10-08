"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ConnectTarget = require("./connect-target.js");
const TargetClient = require("./target-client.js");

const ROOT = __dirname;
const APP = ConnectTarget.getTarget("app");
const DEV = ConnectTarget.getTarget("dev");
const WATCH = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const APP_TOKEN = "a".repeat(64);
const DEV_TOKEN = "d".repeat(64);

function response(status, body = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

/**
 * hosts: { [hostName]: { [cmd]: reply | Error | (payload) => reply } }
 * servers: { [origin]: (url, init) => response | "down" }
 */
function fakeWorld({ hosts = {}, servers = {} } = {}) {
  const hostCalls = [];
  const requests = [];
  async function callHost(hostName, cmd, payload, timeoutMs) {
    hostCalls.push({ hostName, cmd, payload, timeoutMs });
    const h = hosts[hostName];
    if (!h) throw new Error("Specified native messaging host not found.");
    const r = h[cmd];
    if (r instanceof Error) throw r;
    if (typeof r === "function") return r(payload);
    if (r === undefined) return { ok: false, error: "unknown_cmd", cmd };
    return r;
  }
  async function fetchImpl(url, init = {}) {
    requests.push({ url, init });
    const origin = new URL(url).origin;
    const handler = servers[origin];
    const r = handler ? handler(url, init) : "down";
    if (r === "down") throw new TypeError("Failed to fetch");
    return r;
  }
  return { callHost, fetch: fetchImpl, hostCalls, requests };
}

function currentHost(target, token) {
  return {
    version: { ok: true, pong: true, protocol: 2, commands: [], target: target.id },
    getLocalToken: { ok: true, token },
  };
}

function staleHost() {
  return { ping: { ok: true, pong: true }, start: { ok: true, started: true, pid: 4242 } };
}

function authedServer(token, extra = {}) {
  return (url, init) => {
    const auth = init.headers && init.headers.Authorization;
    if (auth !== `Bearer ${token}`) return response(401, { error: "unauthorized" });
    const p = new URL(url).pathname;
    if (extra[p]) return extra[p](url, init);
    if (p === "/api/health") return response(200, { ok: true });
    if (p === "/api/transcripts") return response(200, []);
    return response(404);
  };
}

function client(world, extra = {}) {
  let t = 0;
  return TargetClient.create({
    ConnectTarget,
    callHost: world.callHost,
    fetch: world.fetch,
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
    ...extra,
  });
}

// --- Library picker strings and ports -------------------------------------

test("picker options show label · port, and the ports match the servers' config", () => {
  assert.equal(ConnectTarget.optionLabel("app"), "Transcriber app · 19721");
  assert.equal(ConnectTarget.optionLabel("dev"), "Dev server · 19720");
  const electronConfig = require("../electron/config.js");
  const { DEFAULT_PORT } = require("../lib/local-api-auth.js");
  assert.equal(APP.port, String(electronConfig.port));
  assert.equal(DEV.port, String(DEFAULT_PORT));
  assert.equal(APP.apiBase, `http://127.0.0.1:${electronConfig.port}`);
  assert.equal(DEV.apiBase, `http://127.0.0.1:${DEFAULT_PORT}`);
});

test("every status has a label in the one strings table", () => {
  for (const s of Object.values(ConnectTarget.STATUS)) {
    assert.equal(typeof ConnectTarget.statusLabel(s), "string");
    assert.ok(ConnectTarget.STRINGS.status[s], s);
  }
  assert.equal(ConnectTarget.statusLabel("running"), "Running");
  assert.equal(ConnectTarget.statusLabel("stopped"), "Stopped");
  assert.equal(ConnectTarget.statusLabel("needs_permission"), "Needs permission");
  assert.equal(ConnectTarget.statusLabel("helper_outdated"), "Helper out of date");
});

// --- Error mapping ----------------------------------------------------------

const HOST_AND_AUTH_REASONS = [
  "unknown_cmd",
  "no_token",
  "host_not_found",
  "host_forbidden",
  "bad_project_root",
  "unauthorized",
  "unreachable",
  "extension_not_allowed",
  "unauthorized_caller",
  "app_not_found",
  "port_conflict",
  "start_timeout",
  "host_timeout",
  "host_exited",
];

test("host and auth reasons never map to the generic failure", () => {
  const generic = ConnectTarget.errorMessage("other", "app");
  assert.equal(generic, "Transcription failed. Please try again.");
  for (const id of ["app", "dev"]) {
    for (const reason of HOST_AND_AUTH_REASONS) {
      const msg = ConnectTarget.errorMessage(reason, id);
      assert.notEqual(msg, generic, `${id}/${reason}`);
      assert.doesNotMatch(msg, /\{port\}|undefined/, `${id}/${reason}`);
      assert.doesNotMatch(msg, /sign in|google|magic link|transcribed\.dev/i, `${id}/${reason}`);
    }
  }
});

test("each reason has its own human message per target", () => {
  assert.equal(
    ConnectTarget.errorMessage("extension_not_allowed", "dev"),
    "This extension isn't paired with the dev server. Re-run setup."
  );
  assert.match(ConnectTarget.errorMessage("unknown_cmd", "app"), /out of date/);
  assert.match(ConnectTarget.errorMessage("unknown_cmd", "dev"), /out of date/);
  assert.match(ConnectTarget.errorMessage("no_token", "app"), /access key/);
  assert.match(ConnectTarget.errorMessage("host_not_found", "app"), /Reinstall Browser Connection/);
  assert.match(ConnectTarget.errorMessage("host_not_found", "dev"), /Re-run setup/);
  assert.match(ConnectTarget.errorMessage("bad_project_root", "dev"), /checkout/);
  assert.match(ConnectTarget.errorMessage("unauthorized", "app"), /access key/);
  assert.match(ConnectTarget.errorMessage("unauthorized", "dev"), /127\.0\.0\.1:19720/);
  assert.equal(ConnectTarget.errorMessage("unreachable", "app"), "Transcriber app isn't running.");
  assert.equal(
    ConnectTarget.errorMessage("unreachable", "dev"),
    "Can't reach your dev server. Start it, then try again."
  );
  assert.match(ConnectTarget.errorMessage("port_conflict", "dev"), /Port 19720/);
  assert.equal(ConnectTarget.errorMessage("something_new", "app"), ConnectTarget.errorMessage("other", "app"));
});

test("Chrome's native host errors are classified", () => {
  const c = TargetClient.classifyHostError;
  assert.equal(c(new Error("Specified native messaging host not found.")), "host_not_found");
  assert.equal(c(new Error("native_host_unavailable")), "host_not_found");
  assert.equal(c(new Error("Access to the specified native messaging host is forbidden.")), "host_forbidden");
  assert.equal(c(new Error("native_host_timeout")), "host_timeout");
  assert.equal(c(new Error("Native host has exited.")), "host_exited");
});

// --- Tokens and switching ---------------------------------------------------

test("tokens are cached per target and cleared on switch", async () => {
  const world = fakeWorld({
    hosts: { [APP.nativeHostName]: currentHost(APP, APP_TOKEN), [DEV.nativeHostName]: currentHost(DEV, DEV_TOKEN) },
  });
  const c = client(world);
  assert.deepEqual(await c.getToken(APP), { ok: true, token: APP_TOKEN });
  assert.deepEqual(await c.getToken(APP), { ok: true, token: APP_TOKEN });
  assert.deepEqual(await c.getToken(DEV), { ok: true, token: DEV_TOKEN });
  const tokenCalls = () => world.hostCalls.filter((h) => h.cmd === "getLocalToken").length;
  assert.equal(tokenCalls(), 2, "cached after the first call per target");
  c.clearTokens();
  await c.getToken(APP);
  assert.equal(tokenCalls(), 3, "re-paired after the switch cleared the cache");
});

test("a 401 drops only that target's token", async () => {
  let accept = true;
  const world = fakeWorld({
    hosts: { [APP.nativeHostName]: currentHost(APP, APP_TOKEN) },
    servers: { [APP.apiBase]: () => (accept ? response(200) : response(401)) },
  });
  const c = client(world);
  assert.equal((await c.apiFetch(APP, "/api/health")).ok, true);
  accept = false;
  const r = await c.apiFetch(APP, "/api/health");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unauthorized");
  accept = true;
  await c.apiFetch(APP, "/api/health");
  assert.equal(world.hostCalls.filter((h) => h.cmd === "getLocalToken").length, 2);
});

test("requests never leave the selected target's loopback origin", async () => {
  const world = fakeWorld({
    hosts: { [DEV.nativeHostName]: currentHost(DEV, DEV_TOKEN) },
    servers: { [DEV.apiBase]: authedServer(DEV_TOKEN) },
  });
  const c = client(world);
  await assert.rejects(c.apiFetch(DEV, "https://transcribed.dev/api/health"), /outside the selected target/);
  await assert.rejects(c.apiFetch(DEV, "//evil.example/x"), /outside the selected target/);
  await assert.rejects(c.apiFetch(DEV, `${APP.apiBase}/api/health`), /outside the selected target/);
  assert.equal(world.requests.length, 0);
});

test("the background clears the cached token when the target changes", () => {
  const bg = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
  assert.match(
    bg,
    /storage\.onChanged\.addListener\([\s\S]*?ConnectTarget\.STORAGE_KEY[\s\S]*?clearLocalTokenMemory\(\)/
  );
  assert.match(bg, /function clearLocalTokenMemory\(\) \{\s*targetClient\.clearTokens\(\);/);
  const popup = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
  const setTarget = popup.slice(popup.indexOf("async function setConnectTarget"));
  const body = setTarget.slice(0, setTarget.indexOf("\n}\n"));
  assert.match(body, /CLEAR_LOCAL_TOKEN/);
  assert.match(body, /refreshTargetStatuses\(\)/);
  assert.match(body, /init\(\)/, "switching refreshes the list");
});

// --- Dev without a token ----------------------------------------------------

test("dev with a stale host (unknown_cmd) calls 19720 without Authorization", async () => {
  const world = fakeWorld({
    hosts: { [DEV.nativeHostName]: staleHost() },
    servers: { [DEV.apiBase]: () => response(200) },
  });
  const c = client(world);
  const r = await c.apiFetch(DEV, "/api/transcripts");
  assert.equal(r.ok, true);
  assert.equal(r.tokenless, true);
  assert.equal(world.requests.length, 1);
  assert.equal(world.requests[0].url, "http://127.0.0.1:19720/api/transcripts");
  assert.equal(world.requests[0].init.headers.Authorization, undefined);
  assert.equal(world.requests[0].init.credentials, "omit", "never rides the web UI's cookie");
});

test("every request omits cookies; a protocol-2 dev host's token is used first", async () => {
  const stale = fakeWorld({
    hosts: { [DEV.nativeHostName]: { getLocalToken: { ok: false, error: "no_token" } } },
    servers: { [DEV.apiBase]: () => response(200) },
  });
  const current = fakeWorld({
    hosts: { [DEV.nativeHostName]: currentHost(DEV, DEV_TOKEN), [APP.nativeHostName]: currentHost(APP, APP_TOKEN) },
    servers: { [DEV.apiBase]: authedServer(DEV_TOKEN), [APP.apiBase]: authedServer(APP_TOKEN) },
  });
  const a = client(stale);
  await a.apiFetch(DEV, "/api/transcripts", { credentials: "include" });
  await a.probe(DEV);
  await a.start(DEV, { timeoutMs: 0 });
  const b = client(current);
  const dev = await b.apiFetch(DEV, "/api/transcripts", { credentials: "include" });
  assert.equal(dev.ok, true);
  assert.equal(dev.tokenless, false);
  await b.probe(APP);
  for (const req of [...stale.requests, ...current.requests]) {
    assert.equal(req.init.credentials, "omit", req.url);
  }
  assert.ok(current.requests.every((q) => q.init.headers.Authorization), "token sent");
  assert.ok(stale.requests.length > 0);
});

test("dev with no_token also goes tokenless, and a 401 is an auth error", async () => {
  const world = fakeWorld({
    hosts: { [DEV.nativeHostName]: { getLocalToken: { ok: false, error: "no_token" } } },
    servers: { [DEV.apiBase]: () => response(401) },
  });
  const r = await client(world).apiFetch(DEV, "/api/transcripts");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unauthorized");
  assert.equal(r.tokenless, true);
  assert.notEqual(ConnectTarget.errorMessage(r.reason, "dev"), ConnectTarget.errorMessage("other", "dev"));
});

test("dev never goes tokenless for a missing, forbidden or unpaired host", async () => {
  for (const host of [
    undefined,
    { getLocalToken: new Error("Access to the specified native messaging host is forbidden.") },
    { getLocalToken: { ok: false, error: "extension_not_allowed" } },
  ]) {
    const world = fakeWorld({
      hosts: host ? { [DEV.nativeHostName]: host } : {},
      servers: { [DEV.apiBase]: () => response(200) },
    });
    const r = await client(world).apiFetch(DEV, "/api/transcripts");
    assert.equal(r.ok, false);
    assert.equal(world.requests.length, 0);
  }
});

test("the app target always requires the token", async () => {
  for (const reply of [{ ok: false, error: "unknown_cmd" }, { ok: false, error: "no_token" }, { ok: true }]) {
    const world = fakeWorld({
      hosts: { [APP.nativeHostName]: { getLocalToken: reply } },
      servers: { [APP.apiBase]: () => response(200) },
    });
    const c = client(world);
    assert.equal(c.allowsTokenless(APP, reply.error || "no_token"), false);
    const r = await c.apiFetch(APP, "/api/transcripts");
    assert.equal(r.ok, false);
    assert.equal(world.requests.length, 0, "never contacts the app without a token");
  }
});

test("only the app target asks the app to pair, once", async () => {
  const paired = [];
  const world = fakeWorld({ hosts: {} });
  const c = client(world, {
    pair: async (t) => {
      paired.push(t.id);
      return false;
    },
  });
  await c.getToken(APP);
  await c.getToken(DEV);
  assert.deepEqual(paired, ["app", "dev"], "the client offers; the background decides");
  const bg = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
  assert.match(bg, /if \(target\.id !== ConnectTarget\.APP \|\| _pairAttempted\) return false;/);
});

// --- Status and version handshake ------------------------------------------

test("status: running, stopped, needs permission, helper out of date", async () => {
  const cases = [
    {
      name: "running",
      hosts: { [APP.nativeHostName]: currentHost(APP, APP_TOKEN) },
      servers: { [APP.apiBase]: authedServer(APP_TOKEN) },
      want: ["running", null],
    },
    {
      name: "stopped",
      hosts: { [APP.nativeHostName]: currentHost(APP, APP_TOKEN) },
      servers: {},
      want: ["stopped", "unreachable"],
    },
    {
      name: "host missing and app down",
      hosts: {},
      servers: {},
      want: ["stopped", "host_not_found"],
    },
    {
      name: "host missing but app up",
      hosts: {},
      servers: { [APP.apiBase]: () => response(401) },
      want: ["needs_permission", "host_not_found"],
    },
    {
      name: "forbidden host",
      hosts: {
        [APP.nativeHostName]: {
          version: new Error("Access to the specified native messaging host is forbidden."),
          getLocalToken: new Error("Access to the specified native messaging host is forbidden."),
        },
      },
      servers: {},
      want: ["needs_permission", "host_forbidden"],
    },
    {
      name: "unpaired extension",
      hosts: {
        [APP.nativeHostName]: {
          ...currentHost(APP, APP_TOKEN),
          getLocalToken: { ok: false, error: "extension_not_allowed" },
        },
      },
      servers: {},
      want: ["needs_permission", "extension_not_allowed"],
    },
    {
      name: "token rejected",
      hosts: { [APP.nativeHostName]: currentHost(APP, "wrong".repeat(13)) },
      servers: { [APP.apiBase]: authedServer(APP_TOKEN) },
      want: ["needs_permission", "unauthorized"],
    },
    {
      name: "stale app host",
      hosts: { [APP.nativeHostName]: staleHost() },
      servers: {},
      want: ["helper_outdated", "unknown_cmd"],
    },
  ];
  for (const k of cases) {
    const r = await client(fakeWorld(k)).probe(APP);
    assert.deepEqual([r.status, r.reason], k.want, k.name);
  }
});

test("a stale dev host is detected up front but a running dev server still shows Running", async () => {
  const down = await client(fakeWorld({ hosts: { [DEV.nativeHostName]: staleHost() } })).probe(DEV);
  assert.equal(down.status, "helper_outdated");
  assert.equal(down.helperOutdated, true);
  const up = await client(
    fakeWorld({
      hosts: { [DEV.nativeHostName]: staleHost() },
      servers: { [DEV.apiBase]: () => response(200) },
    })
  ).probe(DEV);
  assert.equal(up.status, "running");
  assert.equal(up.tokenless, true);
  assert.equal(up.helperOutdated, true);
});

test("both targets stopped: every probe stays on loopback and reports stopped", async () => {
  const world = fakeWorld({
    hosts: { [APP.nativeHostName]: currentHost(APP, APP_TOKEN), [DEV.nativeHostName]: currentHost(DEV, DEV_TOKEN) },
  });
  const c = client(world);
  const [app, dev] = await Promise.all([c.probe(APP), c.probe(DEV)]);
  assert.equal(app.status, "stopped");
  assert.equal(dev.status, "stopped");
  for (const req of world.requests) {
    assert.ok(ConnectTarget.LOOPBACK_ORIGINS.includes(new URL(req.url).origin), req.url);
  }
});

// --- Start ------------------------------------------------------------------

test("Start polls health until the server answers", async () => {
  let calls = 0;
  const world = fakeWorld({
    hosts: {
      [APP.nativeHostName]: { ...currentHost(APP, APP_TOKEN), start: { ok: true, started: true } },
    },
    servers: {
      [APP.apiBase]: (url, init) => (++calls < 4 ? "down" : authedServer(APP_TOKEN)(url, init)),
    },
  });
  const r = await client(world).start(APP);
  assert.deepEqual(r, { ok: true });
  assert.equal(calls, 4);
  const start = world.hostCalls.find((h) => h.cmd === "start");
  assert.deepEqual(start.payload, {}, "Start never sends a path or command");
});

test("Start gives up after about 20 seconds with a human reason", async () => {
  const world = fakeWorld({
    hosts: { [APP.nativeHostName]: { ...currentHost(APP, APP_TOKEN), start: { ok: true, started: true } } },
  });
  const r = await client(world).start(APP);
  assert.deepEqual(r, { ok: false, reason: "start_timeout" });
  const polls = world.requests.filter((q) => q.url.endsWith("/api/health")).length;
  assert.ok(polls >= 20 && polls <= 22, `polled ${polls} times`);
});

test("Start passes host refusals through and treats already_running as success", async () => {
  const refuse = fakeWorld({
    hosts: {
      [DEV.nativeHostName]: {
        start: { ok: false, started: false, reason: "bad_project_root", detail: "not_set" },
      },
    },
  });
  assert.deepEqual(await client(refuse).start(DEV), {
    ok: false,
    reason: "bad_project_root",
    detail: "not_set",
    port: undefined,
  });
  const running = fakeWorld({
    hosts: {
      [DEV.nativeHostName]: {
        ...currentHost(DEV, DEV_TOKEN),
        start: { ok: false, started: false, reason: "already_running" },
      },
    },
    servers: { [DEV.apiBase]: authedServer(DEV_TOKEN) },
  });
  assert.deepEqual(await client(running).start(DEV), { ok: true });
  const missing = fakeWorld({ hosts: {} });
  assert.deepEqual(await client(missing).start(APP), { ok: false, reason: "host_not_found" });
});

test("Stop is off by default and never reaches the host", async () => {
  assert.equal(ConnectTarget.FEATURES.stop, false);
  const world = fakeWorld({ hosts: { [DEV.nativeHostName]: { stop: { ok: true, stopped: true } } } });
  assert.deepEqual(await client(world).stop(DEV), { ok: false, reason: "stop_disabled" });
  assert.equal(world.hostCalls.length, 0);
});

// --- The real background.js -------------------------------------------------

function loadBackground({ targetId, hosts = {}, servers = {} }) {
  const world = fakeWorld({ hosts, servers });
  const listeners = {};
  const store = { local: { connectTarget: targetId }, session: {}, sync: {} };
  const area = (name) => ({
    get: async (keys) => {
      const all = store[name];
      if (typeof keys === "string") return { [keys]: all[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, all[k]]));
      return { ...all };
    },
    set: async (obj) => Object.assign(store[name], obj),
    remove: async (k) => {
      delete store[name][k];
    },
  });
  const chrome = {
    runtime: {
      id: "testextensionid",
      lastError: null,
      onMessage: { addListener: (fn) => (listeners.message = fn) },
      connectNative(hostName) {
        const handlers = { message: [], disconnect: [] };
        const port = {
          onMessage: { addListener: (fn) => handlers.message.push(fn) },
          onDisconnect: { addListener: (fn) => handlers.disconnect.push(fn) },
          disconnect() {},
          postMessage(msg) {
            world
              .callHost(hostName, msg.cmd, {}, 0)
              .then((reply) => handlers.message.forEach((fn) => fn({ id: msg.id, ...reply })))
              .catch((err) => {
                chrome.runtime.lastError = { message: err.message };
                handlers.disconnect.forEach((fn) => fn());
                chrome.runtime.lastError = null;
              });
          },
        };
        return port;
      },
    },
    storage: {
      local: area("local"),
      session: area("session"),
      sync: area("sync"),
      onChanged: { addListener: (fn) => (listeners.storage = fn) },
    },
    action: {
      setBadgeText() {},
      setBadgeBackgroundColor() {},
      onClicked: { addListener() {} },
    },
    sidePanel: {
      setOptions: () => Promise.resolve(),
      setPanelBehavior: () => Promise.resolve(),
      open() {},
    },
    tabs: { query: async () => [], sendMessage() {} },
    scripting: { executeScript: async () => {} },
    windows: { update: async () => {} },
  };
  const sandbox = {
    chrome,
    fetch: world.fetch,
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn, ms) => (ms > 1000 ? 0 : setTimeout(fn, ms)),
    clearTimeout,
    URL,
    URLSearchParams,
    AbortSignal,
    crypto: globalThis.crypto,
    btoa,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  sandbox.importScripts = (...files) => {
    for (const f of files) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f });
    }
  };
  vm.runInContext(fs.readFileSync(path.join(ROOT, "background.js"), "utf8"), sandbox, {
    filename: "background.js",
  });
  function send(message, sender = { id: chrome.runtime.id }) {
    return new Promise((resolve) => {
      listeners.message(message, sender, resolve);
    });
  }
  return { send, world, listeners, store };
}

test("background: dev with a stale host still transcribes without a token", async () => {
  const posted = [];
  const bg = loadBackground({
    targetId: "dev",
    hosts: { [DEV.nativeHostName]: staleHost() },
    servers: {
      [DEV.apiBase]: (url, init) => {
        posted.push({ url, init });
        return response(200, { id: "tx_123" });
      },
    },
  });
  const r = await bg.send({ type: "TRANSCRIBE", url: WATCH, title: "Video" });
  assert.equal(r.success, true, r.error);
  assert.equal(r.data.id, "tx_123");
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, "http://127.0.0.1:19720/api/transcripts");
  assert.equal(posted[0].init.method, "POST");
  assert.equal(posted[0].init.headers.Authorization, undefined);
  assert.equal(posted[0].init.credentials, "omit");
  assert.equal(JSON.parse(posted[0].init.body).url, WATCH);
  for (const req of bg.world.requests) {
    assert.equal(new URL(req.url).origin, DEV.apiBase, "never another host");
  }
});

test("background: dev tokenless 401 shows the auth message, not the generic failure", async () => {
  const bg = loadBackground({
    targetId: "dev",
    hosts: { [DEV.nativeHostName]: staleHost() },
    servers: { [DEV.apiBase]: () => response(401) },
  });
  const r = await bg.send({ type: "TRANSCRIBE", url: WATCH, title: "Video" });
  assert.equal(r.success, false);
  assert.equal(r.error, ConnectTarget.errorMessage("unauthorized", "dev"));
});

test("background: the app with no token stays blocked and never posts", async () => {
  for (const host of [staleHost(), { getLocalToken: { ok: false, error: "no_token" } }, undefined]) {
    const bg = loadBackground({
      targetId: "app",
      hosts: host ? { [APP.nativeHostName]: host } : {},
      servers: { [APP.apiBase]: () => response(200, { id: "tx_1" }) },
    });
    const r = await bg.send({ type: "TRANSCRIBE", url: WATCH, title: "Video" });
    assert.equal(r.success, false);
    assert.notEqual(r.error, ConnectTarget.errorMessage("other", "app"));
    const posts = bg.world.requests.filter((q) => q.url.endsWith("/api/transcripts"));
    assert.equal(posts.length, 0);
  }
});

test("background: an unpaired dev extension gets the paired-with-dev message", async () => {
  const bg = loadBackground({
    targetId: "dev",
    hosts: { [DEV.nativeHostName]: { getLocalToken: { ok: false, error: "extension_not_allowed" } } },
    servers: { [DEV.apiBase]: () => response(200, { id: "tx_1" }) },
  });
  const r = await bg.send({ type: "TRANSCRIBE", url: WATCH, title: "Video" });
  assert.equal(r.error, "This extension isn't paired with the dev server. Re-run setup.");
  assert.equal(bg.world.requests.length, 0);
});

test("background: a LinkedIn capture message reaches the panel, not the generic failure", async () => {
  const bg = loadBackground({
    targetId: "app",
    hosts: { [APP.nativeHostName]: currentHost(APP, APP_TOKEN) },
    servers: { [APP.apiBase]: authedServer(APP_TOKEN) },
  });
  const event = "https://www.linkedin.com/events/7512647010907250689/";
  const r = await bg.send({ type: "TRANSCRIBE", url: event, title: "Event" });
  assert.equal(r.success, false);
  assert.equal(r.error, "Reload the LinkedIn page, then press Transcribe again.");
  assert.equal(bg.world.requests.filter((q) => q.url.endsWith("/api/transcripts")).length, 0);
});

test("background: status checks and the Recent list send the token", async () => {
  const bg = loadBackground({
    targetId: "app",
    hosts: { [APP.nativeHostName]: currentHost(APP, APP_TOKEN) },
    servers: {
      [APP.apiBase]: authedServer(APP_TOKEN, {
        "/api/transcripts": () => response(200, [{ id: "1", videoId: "dQw4w9WgXcQ" }]),
      }),
    },
  });
  const svc = await bg.send({ type: "CHECK_SERVICE" });
  assert.equal(svc.data.online, true);
  assert.equal(svc.data.mode, "local");
  const recent = await bg.send({ type: "GET_RECENT" });
  assert.equal(recent.data.length, 1);
  const existing = await bg.send({ type: "CHECK_EXISTING", videoId: "dQw4w9WgXcQ" });
  assert.equal(existing.data.id, "1");
});

test("background: switching targets clears the token and talks to the new host", async () => {
  const bg = loadBackground({
    targetId: "app",
    hosts: {
      [APP.nativeHostName]: currentHost(APP, APP_TOKEN),
      [DEV.nativeHostName]: currentHost(DEV, DEV_TOKEN),
    },
    servers: { [APP.apiBase]: authedServer(APP_TOKEN), [DEV.apiBase]: authedServer(DEV_TOKEN) },
  });
  const tokenCalls = (hostName) =>
    bg.world.hostCalls.filter((h) => h.cmd === "getLocalToken" && h.hostName === hostName).length;
  const switchTo = (id) => {
    bg.store.local.connectTarget = id;
    bg.listeners.storage({ connectTarget: { newValue: id } }, "local");
  };

  assert.equal((await bg.send({ type: "CHECK_SERVICE" })).data.online, true);
  assert.equal(tokenCalls(APP.nativeHostName), 1);

  switchTo("dev");
  const before = bg.world.requests.length;
  assert.equal((await bg.send({ type: "CHECK_SERVICE" })).data.online, true);
  const devRequests = bg.world.requests.slice(before);
  assert.ok(devRequests.length > 0);
  for (const q of devRequests) {
    assert.equal(new URL(q.url).origin, DEV.apiBase);
    assert.equal(q.init.headers.Authorization, `Bearer ${DEV_TOKEN}`, "never the app token");
  }

  switchTo("app");
  assert.equal((await bg.send({ type: "CHECK_SERVICE" })).data.online, true);
  assert.equal(tokenCalls(APP.nativeHostName), 2, "the switch dropped the cached app token");

  const statuses = await bg.send({ type: "TARGET_STATUS" });
  assert.equal(statuses.data.app.status, "running");
  assert.equal(statuses.data.dev.status, "running");
});

test("background: no message reaches the native host as a raw pass-through", async () => {
  const bg = loadBackground({
    targetId: "app",
    hosts: {
      [APP.nativeHostName]: {
        ...currentHost(APP, APP_TOKEN),
        start: { ok: true, started: true },
        stop: { ok: true, stopped: true },
      },
    },
  });
  const senders = [
    { id: "testextensionid", tab: { id: 7 }, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    { id: "testextensionid", tab: { id: 8 }, url: "https://chatgpt.com/" },
    { id: "testextensionid", url: "chrome-extension://testextensionid/popup.html" },
  ];
  for (const sender of senders) {
    for (const cmd of ["getLocalToken", "start", "stop"]) {
      const r = await bg.send({ type: "CALL_NATIVE_HOST", cmd, payload: {} }, sender);
      assert.equal(r.data && r.data.result, undefined, `${cmd} from ${sender.url}`);
      assert.equal(r.data && r.data.error, "Unknown message type", `${cmd} from ${sender.url}`);
    }
  }
  assert.deepEqual(bg.world.hostCalls, [], "the host was never called");
  for (const f of ["background.js", "popup.js", "content.js", "content-linkedin.js", "content-llm-handoff.js"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), "utf8"), /CALL_NATIVE_HOST/, f);
  }
});

test("background: START_TARGET reports a human message on failure", async () => {
  const bg = loadBackground({
    targetId: "dev",
    hosts: {
      [DEV.nativeHostName]: { start: { ok: false, started: false, reason: "bad_project_root", detail: "empty" } },
    },
  });
  const r = await bg.send({ type: "START_TARGET" });
  assert.equal(r.data.ok, false);
  assert.equal(r.data.reason, "bad_project_root");
  assert.equal(r.data.message, ConnectTarget.errorMessage("bad_project_root", "dev"));
});
