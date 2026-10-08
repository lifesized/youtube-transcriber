/**
 * The real middleware, request by request, behind a minimal browser cookie jar.
 *
 * Cookies are scoped to the host, not the port: 127.0.0.1:19720 (Dev) and
 * 127.0.0.1:19721 (App) share one jar and are same-site to each other. The
 * jar here sends every cookie it holds on every request, which is the worst
 * case (a real browser would hold back SameSite=Strict cookies cross-site).
 */

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";

const { middleware } = await import("../middleware.ts");

const DEV = 19720;
const APP = 19721;
const TOKENS = { [DEV]: "d".repeat(64), [APP]: "a".repeat(64) };
const NAVIGATE = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
const FETCH = { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" };
const LIBRARY = "/?layout=list&id=x";

const saved = { PORT: process.env.PORT, TOKEN: process.env.TRANSCRIBER_LOCAL_TOKEN };
afterEach(() => {
  for (const [key, name] of [["PORT", "PORT"], ["TOKEN", "TRANSCRIBER_LOCAL_TOKEN"]]) {
    if (saved[key] === undefined) delete process.env[name];
    else process.env[name] = saved[key];
  }
});

function parseSetCookie(line) {
  const [pair, ...attrs] = line.split(";").map((s) => s.trim());
  const i = pair.indexOf("=");
  return {
    name: pair.slice(0, i),
    value: pair.slice(i + 1),
    attrs: attrs.map((a) => a.toLowerCase()),
  };
}

/** One browser profile talking to whichever server listens on `port`. */
function browser(tokens = TOKENS) {
  const jar = new Map();
  function send(port, url, headers = {}) {
    process.env.PORT = String(port);
    process.env.TRANSCRIBER_LOCAL_TOKEN = tokens[port];
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = middleware(
      new NextRequest(`http://127.0.0.1:${port}${url}`, {
        headers: { host: `127.0.0.1:${port}`, ...(cookie ? { cookie } : {}), ...headers },
      })
    );
    const set = res.headers.getSetCookie().map(parseSetCookie);
    for (const c of set) jar.set(c.name, c.value);
    return { res, set, passed: res.headers.get("x-middleware-next") === "1" };
  }
  return { jar, send };
}

test("an extension- or tray-opened Library tab gets the port's cookie and its fetches pass", () => {
  for (const port of [APP, DEV]) {
    for (const site of ["none", "cross-site"]) {
      const b = browser();
      const nav = b.send(port, LIBRARY, { "sec-fetch-site": site, ...NAVIGATE });
      assert.equal(nav.passed, true, `${port}/${site}`);
      assert.equal(nav.set.length, 1, `${port}/${site} mints one cookie`);
      const [cookie] = nav.set;
      assert.equal(cookie.name, `transcriber_local_token_${port}`);
      assert.equal(cookie.value, TOKENS[port]);
      assert.ok(cookie.attrs.includes("httponly"), "HttpOnly");
      assert.ok(cookie.attrs.includes("samesite=strict"), "SameSite=Strict");
      assert.ok(cookie.attrs.includes("path=/"), "Path=/");
      assert.equal(cookie.attrs.some((a) => a.startsWith("domain=")), false, "host-only");

      const api = b.send(port, "/api/transcripts", { "sec-fetch-site": "same-origin", ...FETCH });
      assert.equal(api.passed, true, `${port}/${site}: the page's GET /api/transcripts`);
      assert.equal(api.set.length, 0, "never minted on /api/*");
    }
  }
});

test("a cross-site subresource, iframe or fetch never mints the cookie", () => {
  const contexts = [
    { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" },
    { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script" },
    { "sec-fetch-site": "cross-site", ...FETCH },
    { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" },
    { "sec-fetch-site": "same-site", ...FETCH },
    { "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" },
    {},
  ];
  for (const port of [APP, DEV]) {
    for (const headers of contexts) {
      const b = browser();
      const page = b.send(port, LIBRARY, headers);
      assert.equal(page.set.length, 0, `${port} ${JSON.stringify(headers)}`);
      const api = b.send(port, "/api/transcripts", headers);
      assert.equal(api.res.status, 401, `${port} ${JSON.stringify(headers)}`);
    }
  }
});

test("/api/* never mints the cookie, even on a top-level navigation", () => {
  for (const port of [APP, DEV]) {
    for (const route of ["/api/transcripts", "/api/health", "/api/native-host/pair"]) {
      const b = browser();
      const r = b.send(port, route, { "sec-fetch-site": "none", ...NAVIGATE });
      assert.equal(r.set.length, 0, `${port}${route}`);
    }
  }
});

test("cookie auth on /api needs Sec-Fetch-Site same-origin or none", () => {
  for (const port of [APP, DEV]) {
    const b = browser();
    b.send(port, "/", { "sec-fetch-site": "none", ...NAVIGATE });
    assert.equal(b.jar.size, 1);
    const call = (site) =>
      b.send(port, "/api/transcripts", { ...(site ? { "sec-fetch-site": site } : {}), ...FETCH });
    assert.equal(call("same-origin").passed, true, "same-origin");
    assert.equal(call("none").passed, true, "none");
    assert.equal(call("same-site").res.status, 401, "same-site");
    assert.equal(call("cross-site").res.status, 401, "cross-site");
    assert.equal(call(null).res.status, 401, "no Sec-Fetch-Site");
  }
});

test("the 19720 cookie is not accepted by 19721, and the reverse", () => {
  // One token for both ports, so only the cookie name can tell them apart.
  const same = { [DEV]: TOKENS[APP], [APP]: TOKENS[APP] };
  for (const [from, to] of [[DEV, APP], [APP, DEV]]) {
    const b = browser(same);
    b.send(from, "/", { "sec-fetch-site": "none", ...NAVIGATE });
    assert.deepEqual([...b.jar.keys()], [`transcriber_local_token_${from}`]);
    const r = b.send(to, "/api/transcripts", { "sec-fetch-site": "same-origin", ...FETCH });
    assert.equal(r.res.status, 401, `${from} cookie on ${to}`);
  }
});

test("the Dev and App cookies sit side by side; opening one never logs the other out", () => {
  const b = browser();
  b.send(DEV, "/", { "sec-fetch-site": "none", ...NAVIGATE });
  b.send(APP, LIBRARY, { "sec-fetch-site": "none", ...NAVIGATE });
  assert.equal(b.jar.size, 2);
  for (const port of [DEV, APP]) {
    const r = b.send(port, "/api/transcripts", { "sec-fetch-site": "same-origin", ...FETCH });
    assert.equal(r.passed, true, String(port));
  }
});

test("the old unsuffixed cookie is ignored", () => {
  for (const port of [APP, DEV]) {
    const b = browser();
    b.jar.set("transcriber_local_token", TOKENS[port]);
    const r = b.send(port, "/api/transcripts", { "sec-fetch-site": "same-origin", ...FETCH });
    assert.equal(r.res.status, 401, String(port));
  }
});

test("Bearer still works from any context; a wrong Bearer does not", () => {
  for (const port of [APP, DEV]) {
    for (const site of ["same-origin", "none", "same-site", "cross-site", null]) {
      const b = browser();
      const headers = { ...(site ? { "sec-fetch-site": site } : {}), ...FETCH };
      const ok = b.send(port, "/api/transcripts", {
        ...headers,
        authorization: `Bearer ${TOKENS[port]}`,
      });
      assert.equal(ok.passed, true, `${port}/${site}`);
      const bad = b.send(port, "/api/transcripts", { ...headers, authorization: "Bearer nope" });
      assert.equal(bad.res.status, 401, `${port}/${site}`);
    }
    const other = browser().send(port, "/api/transcripts", {
      authorization: `Bearer ${TOKENS[port === APP ? DEV : APP]}`,
    });
    assert.equal(other.res.status, 401, "the other server's token");
  }
});

test("the web UI's own same-origin navigations and fetches still work", () => {
  for (const port of [APP, DEV]) {
    const b = browser();
    const first = b.send(port, "/", { "sec-fetch-site": "none", ...NAVIGATE });
    assert.equal(first.set.length, 1);
    const link = b.send(port, "/?layout=list", { "sec-fetch-site": "same-origin", ...NAVIGATE });
    assert.equal(link.passed, true);
    assert.equal(link.set.length, 0, "a valid cookie is not re-minted");
    const rsc = b.send(port, "/?_rsc=1", { "sec-fetch-site": "same-origin", ...FETCH });
    assert.equal(rsc.passed, true);
    for (const route of ["/api/transcripts", "/api/settings", "/api/usage", "/api/health"]) {
      const r = b.send(port, route, { "sec-fetch-site": "same-origin", ...FETCH });
      assert.equal(r.passed, true, `${port}${route}`);
    }
    const download = b.send(port, "/api/transcripts/x", { "sec-fetch-site": "same-origin", ...NAVIGATE });
    assert.equal(download.passed, true, "a same-origin link to /api");
  }
});

test("a rebinding Host is still refused before any cookie logic", () => {
  process.env.PORT = String(APP);
  process.env.TRANSCRIBER_LOCAL_TOKEN = TOKENS[APP];
  const res = middleware(
    new NextRequest(`http://127.0.0.1:${APP}/`, {
      headers: { host: `evil.example:${APP}`, "sec-fetch-site": "none", ...NAVIGATE },
    })
  );
  assert.equal(res.status, 421);
  assert.equal(res.headers.getSetCookie().length, 0);
});
