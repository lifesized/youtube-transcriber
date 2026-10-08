"use strict";

/**
 * Talks to one LOCAL target (packaged app or dev server): native host
 * handshake, loopback token, authed fetches, status, and Start.
 *
 * Tokens live in memory only, per target. Requests only ever go to the
 * target's own 127.0.0.1 origin and never carry cookies. The dev target may
 * fall back to a request without Authorization when its host is stale
 * (unknown_cmd) or has no token (no_token); that only works against a dev
 * server running without auth. The app target always needs the token.
 */

(function (root, factory) {
  const exported = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exported;
  }
  root.TargetClient = exported;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const HOST_TOKEN_ERRORS = new Set([
    "unknown_cmd",
    "no_token",
    "extension_not_allowed",
    "unauthorized_caller",
  ]);
  const TOKENLESS_REASONS = new Set(["unknown_cmd", "no_token"]);
  const PERMISSION_REASONS = new Set([
    "unauthorized",
    "extension_not_allowed",
    "unauthorized_caller",
    "host_forbidden",
  ]);
  const PAIRABLE_REASONS = new Set(["host_not_found", "host_forbidden"]);

  function classifyHostError(err) {
    const msg = String((err && err.message) || err || "");
    if (msg === "native_host_unavailable" || /not found/i.test(msg)) return "host_not_found";
    if (/forbidden/i.test(msg)) return "host_forbidden";
    if (/timeout/i.test(msg)) return "host_timeout";
    return "host_exited";
  }

  function isHealthy(res) {
    return !!res && (res.ok || res.status === 503);
  }

  /**
   * @param {object} deps
   * @param {object} deps.ConnectTarget
   * @param {(hostName: string, cmd: string, payload: object, timeoutMs: number) => Promise<object>} deps.callHost
   * @param {(url: string, init: object) => Promise<Response>} deps.fetch
   * @param {(target: object) => Promise<boolean>} [deps.pair] app pairing request; true if it may help
   * @param {(ms: number) => Promise<void>} [deps.sleep]
   * @param {() => number} [deps.now]
   */
  function create(deps) {
    const T = deps.ConnectTarget;
    const callHost = deps.callHost;
    const fetchImpl = deps.fetch;
    const pair = deps.pair || (async () => false);
    const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const now = deps.now || (() => Date.now());
    const tokens = new Map();

    function clearTokens(id) {
      if (id) tokens.delete(id);
      else tokens.clear();
    }

    async function host(target, cmd, timeoutMs) {
      try {
        return { ok: true, reply: (await callHost(target.nativeHostName, cmd, {}, timeoutMs)) || {} };
      } catch (err) {
        return { ok: false, reason: classifyHostError(err) };
      }
    }

    async function requestToken(target) {
      const r = await host(target, "getLocalToken", 5000);
      if (!r.ok) return r;
      const reply = r.reply;
      if (reply.ok && typeof reply.token === "string" && reply.token.length > 0) {
        return { ok: true, token: reply.token };
      }
      if (reply.ok === false && HOST_TOKEN_ERRORS.has(reply.error)) {
        return { ok: false, reason: reply.error };
      }
      return { ok: false, reason: "no_token" };
    }

    async function getToken(target) {
      if (tokens.has(target.id)) return { ok: true, token: tokens.get(target.id) };
      let r = await requestToken(target);
      if (!r.ok && PAIRABLE_REASONS.has(r.reason) && (await pair(target))) {
        r = await requestToken(target);
      }
      if (r.ok) tokens.set(target.id, r.token);
      return r;
    }

    function allowsTokenless(target, reason) {
      return target.id === T.DEV && TOKENLESS_REASONS.has(reason);
    }

    /** { ok, token } or, dev only, { ok, token: null, tokenless: true }. */
    async function authFor(target) {
      const tok = await getToken(target);
      if (tok.ok) return { ok: true, token: tok.token, tokenless: false };
      if (allowsTokenless(target, tok.reason)) {
        return { ok: true, token: null, tokenless: true, hostReason: tok.reason };
      }
      return { ok: false, reason: tok.reason };
    }

    function targetUrl(target, pathOrUrl) {
      const url = new URL(pathOrUrl, target.apiBase);
      if (url.origin !== target.apiBase || !T.LOOPBACK_ORIGINS.includes(url.origin)) {
        throw new Error("refusing a request outside the selected target");
      }
      return url.href;
    }

    async function send(target, pathOrUrl, init, auth) {
      const url = targetUrl(target, pathOrUrl);
      const headers = { ...((init && init.headers) || {}) };
      delete headers.Authorization;
      if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
      let res;
      try {
        // Never send cookies: tokenless only reaches a dev server without auth.
        res = await fetchImpl(url, { ...init, headers, credentials: "omit" });
      } catch {
        return { ok: false, reason: "unreachable" };
      }
      if (res.status === 401) {
        clearTokens(target.id);
        return { ok: false, reason: "unauthorized", tokenless: !!auth.tokenless };
      }
      return { ok: true, res, tokenless: !!auth.tokenless };
    }

    async function apiFetch(target, path, init = {}) {
      const auth = await authFor(target);
      if (!auth.ok) return auth;
      return send(target, path, init, auth);
    }

    async function handshake(target) {
      const r = await host(target, "version", 2500);
      if (!r.ok) return { ok: false, reason: r.reason };
      const protocol = Number(r.reply.protocol);
      if (r.reply.ok && Number.isFinite(protocol) && protocol >= T.MIN_HOST_PROTOCOL) {
        return { ok: true, protocol, commands: r.reply.commands || [] };
      }
      return { ok: false, reason: "unknown_cmd", outdated: true };
    }

    async function isListening(target) {
      try {
        await fetchImpl(targetUrl(target, "/api/health"), { method: "GET", credentials: "omit" });
        return true;
      } catch {
        return false;
      }
    }

    /**
     * Status precedence: running > needs_permission > helper_outdated > stopped.
     * `reason` is the code to show a message for (null when running).
     */
    async function probe(target) {
      const hs = await handshake(target);
      const health = await apiFetch(target, "/api/health", { method: "GET" });
      const base = {
        id: target.id,
        protocol: hs.ok ? hs.protocol : null,
        helperOutdated: !!hs.outdated,
      };
      if (health.ok && isHealthy(health.res)) {
        return { ...base, status: T.STATUS.RUNNING, reason: null, tokenless: health.tokenless };
      }
      const reason = health.ok ? "unreachable" : health.reason;
      if (PERMISSION_REASONS.has(reason)) {
        return { ...base, status: T.STATUS.NEEDS_PERMISSION, reason };
      }
      if ((reason === "host_not_found" || reason === "no_token") && (await isListening(target))) {
        return { ...base, status: T.STATUS.NEEDS_PERMISSION, reason };
      }
      if (hs.outdated) {
        return { ...base, status: T.STATUS.HELPER_OUTDATED, reason: "unknown_cmd" };
      }
      return { ...base, status: T.STATUS.STOPPED, reason };
    }

    /** Ask the host to start, then poll health for up to `timeoutMs`. */
    async function start(target, { timeoutMs = 20000, intervalMs = 1000 } = {}) {
      const r = await host(target, "start", 25000);
      if (!r.ok) return { ok: false, reason: r.reason };
      const reply = r.reply;
      if (reply.ok === false && reply.error === "unknown_cmd") {
        return { ok: false, reason: "unknown_cmd" };
      }
      if (!reply.started && reply.reason !== "already_running") {
        return {
          ok: false,
          reason: reply.reason || "start_timeout",
          detail: reply.detail,
          port: reply.port,
        };
      }
      const deadline = now() + timeoutMs;
      for (;;) {
        const h = await apiFetch(target, "/api/health", { method: "GET" });
        if (h.ok && isHealthy(h.res)) return { ok: true };
        if (!h.ok && h.reason !== "unreachable") return { ok: false, reason: h.reason };
        if (now() >= deadline) return { ok: false, reason: "start_timeout" };
        await sleep(intervalMs);
      }
    }

    async function stop(target) {
      if (!T.FEATURES.stop) return { ok: false, reason: "stop_disabled" };
      const r = await host(target, "stop", 10000);
      if (!r.ok) return { ok: false, reason: r.reason };
      return r.reply.stopped ? { ok: true } : { ok: false, reason: r.reply.reason || "other" };
    }

    return {
      clearTokens,
      getToken,
      allowsTokenless,
      authFor,
      send,
      apiFetch,
      handshake,
      probe,
      start,
      stop,
    };
  }

  return { create, classifyHostError };
});
