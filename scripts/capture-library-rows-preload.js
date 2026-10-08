"use strict";

/**
 * Preload for capture-library-rows.js: a stub chrome.* API so the real
 * popup.js renders one Settings › Library state. The state comes from the
 * `s` query parameter. Nothing here talks to a real app or native host.
 */

const scenario = JSON.parse(new URLSearchParams(location.search).get("s"));

const stores = { local: { connectTarget: scenario.target }, sync: {}, session: {} };

function pick(store, keys) {
  if (keys == null) return { ...store };
  if (typeof keys === "string") keys = [keys];
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]));
  }
  return Object.fromEntries(Object.keys(keys).map((k) => [k, k in store ? store[k] : keys[k]]));
}

function done(cb, value) {
  if (typeof cb === "function") cb(value);
  return Promise.resolve(value);
}

function area(name) {
  return {
    get: (keys, cb) => done(cb, pick(stores[name], keys)),
    set: (items, cb) => done(cb, void Object.assign(stores[name], items)),
    remove: (keys, cb) => done(cb, void [].concat(keys).forEach((k) => delete stores[name][k])),
  };
}

const listener = { addListener() {}, removeListener() {} };

function respond(msg) {
  const selected = scenario[scenario.target];
  switch (msg && msg.type) {
    case "TARGET_STATUS":
      return {
        success: true,
        data: { app: { id: "app", ...scenario.app }, dev: { id: "dev", ...scenario.dev } },
      };
    case "CHECK_SERVICE":
      return {
        success: true,
        data: { online: selected.status === "running", mode: "local", reason: selected.reason || null },
      };
    case "GET_SETTINGS":
      return { success: true, data: { mode: "local" } };
    case "START_TARGET":
      return new Promise(() => {});
    default:
      return { success: false, error: "capture stub" };
  }
}

window.chrome = {
  runtime: {
    id: "kjbmhgfdlpoiacenbhgfmnmbcalkdefg",
    lastError: undefined,
    connect: () => ({ onMessage: listener, onDisconnect: listener, postMessage() {}, disconnect() {} }),
    connectNative: () => {
      throw new Error("native_host_unavailable");
    },
    sendMessage: (msg, cb) => {
      Promise.resolve(respond(msg)).then((res) => typeof cb === "function" && cb(res));
    },
    onMessage: listener,
    getURL: (p) => p,
  },
  storage: {
    local: area("local"),
    sync: area("sync"),
    session: area("session"),
    onChanged: listener,
  },
  tabs: {
    query: (_q, cb) => done(cb, []),
    create: (_o, cb) => done(cb, {}),
    onUpdated: listener,
    onActivated: listener,
  },
  windows: { getCurrent: (_o, cb) => done(typeof _o === "function" ? _o : cb, { id: 1 }) },
  permissions: {
    contains: (_p, cb) => done(cb, false),
    request: (_p, cb) => done(cb, false),
  },
};

window.fetch = () => Promise.reject(new Error("capture: no network"));
