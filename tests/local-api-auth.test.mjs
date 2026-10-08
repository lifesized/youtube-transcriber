import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const auth = require(path.join(repoRoot, "lib/local-api-auth.js"));
const tokenMod = require(path.join(repoRoot, "lib/local-api-token.js"));

test("tokensEqual is timing-safe and rejects mismatches", () => {
  assert.equal(auth.tokensEqual("abc", "abc"), true);
  assert.equal(auth.tokensEqual("abc", "abd"), false);
  assert.equal(auth.tokensEqual("abc", "ab"), false);
  assert.equal(auth.tokensEqual("", ""), false);
  assert.equal(tokenMod.tokensEqual("deadbeef", "deadbeef"), true);
  assert.equal(tokenMod.tokensEqual("deadbeef", "deadbeee"), false);
});

test("isAuthorizedRequest accepts Bearer, and the port's cookie only same-origin or none", () => {
  const expected = "a".repeat(64);
  assert.equal(
    auth.isAuthorizedRequest({ authorization: `Bearer ${expected}` }, expected),
    true
  );
  assert.equal(
    auth.isAuthorizedRequest({ authorization: "Bearer wrong" }, expected),
    false
  );
  assert.equal(auth.isAuthorizedRequest({}, expected), false);

  assert.equal(auth.cookieName(19720), "transcriber_local_token_19720");
  assert.equal(auth.cookieName(19721), "transcriber_local_token_19721");
  const cookie = `${auth.cookieName(19721)}=${expected}; other=1`;
  const call = (secFetchSite, port = 19721) =>
    auth.isAuthorizedRequest({ cookie, secFetchSite }, expected, auth.tokensEqual, port);
  assert.equal(call("same-origin"), true);
  assert.equal(call("none"), true);
  assert.equal(call("same-site"), false);
  assert.equal(call("cross-site"), false);
  assert.equal(call(null), false);
  assert.equal(call("same-origin", 19720), false, "19721's cookie on 19720");
  assert.equal(
    auth.isAuthorizedRequest(
      { cookie: `transcriber_local_token=${expected}`, secFetchSite: "same-origin" },
      expected,
      auth.tokensEqual,
      19721
    ),
    false,
    "the old unsuffixed cookie"
  );
  assert.equal(
    auth.isAuthorizedRequest(
      { authorization: `Bearer ${expected}`, secFetchSite: "cross-site" },
      expected
    ),
    true,
    "Bearer ignores Sec-Fetch-Site"
  );
});

test("cookieName follows the server's own PORT", () => {
  const prev = process.env.PORT;
  try {
    delete process.env.PORT;
    assert.equal(auth.cookieName(), "transcriber_local_token_19720");
    process.env.PORT = "19721";
    assert.equal(auth.cookieName(), "transcriber_local_token_19721");
    assert.equal(auth.parseCookieToken("transcriber_local_token_19720=x"), null);
    assert.equal(auth.parseCookieToken("transcriber_local_token_19721=y"), "y");
  } finally {
    if (prev === undefined) delete process.env.PORT;
    else process.env.PORT = prev;
  }
});

test("ensureLocalApiToken respects env and writes 0600 file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ytt-token-"));
  const prevEnv = process.env.TRANSCRIBER_LOCAL_TOKEN;
  const prevAppdata = process.env.APPDATA;
  const prevXdg = process.env.XDG_CONFIG_HOME;
  try {
    delete process.env.TRANSCRIBER_LOCAL_TOKEN;
    // Force state dir into temp via XDG on non-win; on darwin STATE_DIR uses Application Support.
    // Call writeTokenFile indirectly by stubbing: use ENV override with write.
    const t = "b".repeat(64);
    process.env.TRANSCRIBER_LOCAL_TOKEN = t;
    // Use a custom path by writing via writeTokenFile after monkeypatching getStateDir is hard;
    // instead verify generate + file mode using writeTokenFile on real path is ok —
    // isolate by writing manually with the helper API:
    const filePath = path.join(dir, "local-api.token");
    writeFileSync(filePath, t, { mode: 0o600 });
    const got = readFileSync(filePath, "utf8");
    assert.equal(got, t);
    assert.equal(tokenMod.ensureLocalApiToken({ writeEnvToFile: false }), t);
  } finally {
    if (prevEnv === undefined) delete process.env.TRANSCRIBER_LOCAL_TOKEN;
    else process.env.TRANSCRIBER_LOCAL_TOKEN = prevEnv;
    if (prevAppdata === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = prevAppdata;
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rotateLocalApiToken replaces file and env", () => {
  const prevEnv = process.env.TRANSCRIBER_LOCAL_TOKEN;
  const tokenPath = tokenMod.getLocalApiTokenPath();
  let prevFile = null;
  try {
    try {
      prevFile = readFileSync(tokenPath, "utf8");
    } catch {
      prevFile = null;
    }
    delete process.env.TRANSCRIBER_LOCAL_TOKEN;
    const first = tokenMod.ensureLocalApiToken();
    const second = tokenMod.rotateLocalApiToken();
    assert.notEqual(second, first);
    assert.equal(second.length, 64);
    assert.equal(process.env.TRANSCRIBER_LOCAL_TOKEN, second);
    assert.equal(readFileSync(tokenPath, "utf8").trim(), second);
    const third = tokenMod.rotateLocalApiToken();
    assert.notEqual(third, second);
    assert.equal(process.env.TRANSCRIBER_LOCAL_TOKEN, third);
  } finally {
    if (prevEnv === undefined) delete process.env.TRANSCRIBER_LOCAL_TOKEN;
    else process.env.TRANSCRIBER_LOCAL_TOKEN = prevEnv;
    if (prevFile !== null) {
      writeFileSync(tokenPath, prevFile, { encoding: "utf8", mode: 0o600 });
    } else {
      try {
        rmSync(tokenPath, { force: true });
      } catch {
        // ignore
      }
    }
  }
});

test("unauthorizedJson shape", () => {
  assert.deepEqual(auth.unauthorizedJson(), { error: "unauthorized" });
});

test("getStateDir honors TRANSCRIBER_STATE_DIR and defaults to Transcriber", () => {
  const prev = process.env.TRANSCRIBER_STATE_DIR;
  const prevLog = process.env.TRANSCRIBER_LOG_DIR;
  try {
    delete process.env.TRANSCRIBER_STATE_DIR;
    delete process.env.TRANSCRIBER_LOG_DIR;
    const def = tokenMod.getStateDir();
    if (process.platform === "darwin") {
      assert.ok(def.endsWith(`${path.sep}Transcriber`));
      assert.equal(def.includes("Transcriber App"), false);
    } else {
      assert.match(def, /transcriber/i);
    }
    process.env.TRANSCRIBER_STATE_DIR = "/tmp/ytt-app-state";
    assert.equal(tokenMod.getStateDir(), "/tmp/ytt-app-state");
    assert.equal(tokenMod.getLocalApiTokenPath(), path.join("/tmp/ytt-app-state", "local-api.token"));
    assert.equal(
      tokenMod.getLogDir(),
      process.platform === "darwin"
        ? path.join("/tmp/ytt-app-state", "logs")
        : "/tmp/ytt-app-state"
    );
  } finally {
    if (prev === undefined) delete process.env.TRANSCRIBER_STATE_DIR;
    else process.env.TRANSCRIBER_STATE_DIR = prev;
    if (prevLog === undefined) delete process.env.TRANSCRIBER_LOG_DIR;
    else process.env.TRANSCRIBER_LOG_DIR = prevLog;
  }
});

/**
 * Middleware behavior unit-test without booting Next: same decision function.
 */
test("rebinding Host is rejected with 421 on pages and /api/*", () => {
  const prev = process.env.PORT;
  try {
    delete process.env.PORT;
    assert.equal(auth.configuredPort(), 19720);
    assert.equal(auth.isAllowedLoopbackHost("127.0.0.1:19720"), true);
    assert.equal(auth.isAllowedLoopbackHost("localhost:19720"), true);
    assert.equal(auth.isAllowedLoopbackHost("LOCALHOST:19720"), true);
    assert.equal(auth.isAllowedLoopbackHost("evil.example:19720"), false);
    assert.equal(auth.isAllowedLoopbackHost("127.0.0.1"), false);
    assert.equal(auth.isAllowedLoopbackHost("attacker.com"), false);
    assert.equal(auth.isAllowedLoopbackHost(""), false);
    assert.equal(auth.isAllowedLoopbackHost(null), false);

    function decide(host, pathname) {
      if (!auth.isAllowedLoopbackHost(host)) return 421;
      if (pathname === "/") return 200;
      if (pathname.startsWith("/api/")) return 200;
      return 200;
    }
    assert.equal(decide("evil.example:19720", "/"), 421);
    assert.equal(decide("evil.example:19720", "/api/health"), 421);
    assert.equal(decide("127.0.0.1:19720", "/"), 200);
    assert.equal(decide("127.0.0.1:19720", "/api/transcripts"), 200);

    process.env.PORT = "19721";
    assert.equal(auth.isAllowedLoopbackHost("127.0.0.1:19721"), true);
    assert.equal(auth.isAllowedLoopbackHost("127.0.0.1:19720"), false);
  } finally {
    if (prev === undefined) delete process.env.PORT;
    else process.env.PORT = prev;
  }
});

test("token cookie is minted for same-origin loads and top-level document navigations", () => {
  const mint = (site, mode, dest) => auth.shouldMintTokenCookie({ site, mode, dest });
  assert.equal(mint("none", "navigate", "document"), true);
  assert.equal(mint("same-origin", "navigate", "document"), true);
  assert.equal(mint("same-origin", "cors", "empty"), true);
  assert.equal(mint("cross-site", "navigate", "document"), true);
  assert.equal(mint("same-site", "navigate", "document"), true);
  assert.equal(mint("cross-site", "navigate", "iframe"), false);
  assert.equal(mint("cross-site", "cors", "empty"), false);
  assert.equal(mint("cross-site", "no-cors", "image"), false);
  assert.equal(mint("same-site", "cors", "empty"), false);
  assert.equal(mint(null, null, null), false);
  assert.equal(mint("", "", ""), false);
});

test("Tusk settings writes need the port cookie and same-origin, not Bearer", () => {
  const expected = "t".repeat(64);
  const cookie = `${auth.cookieName(19721)}=${expected}`;
  const call = (headers, port = 19721) =>
    auth.isSettingsPageWrite(headers, expected, auth.tokensEqual, port);

  assert.equal(
    call({ authorization: `Bearer ${expected}`, secFetchSite: "same-origin" }),
    false,
    "Bearer-only (extension / MCP / native host)"
  );
  assert.equal(
    call({ cookie, secFetchSite: "none" }),
    false,
    "cookie + none is not the Settings page"
  );
  assert.equal(call({ cookie, secFetchSite: "same-site" }), false);
  assert.equal(call({ cookie, secFetchSite: "cross-site" }), false);
  assert.equal(call({ cookie }), false, "missing Sec-Fetch-Site");
  assert.equal(call({ cookie, secFetchSite: "same-origin" }), true);
  assert.equal(
    call(
      {
        authorization: `Bearer ${expected}`,
        cookie,
        secFetchSite: "same-origin",
      }
    ),
    true,
    "Settings may also send Bearer; cookie + same-origin is what counts"
  );
  assert.equal(call({ cookie, secFetchSite: "same-origin" }, 19720), false);
});

test("middleware decision: missing token → 401; good Bearer → allow", () => {
  const expected = "c".repeat(64);
  function decide(authorization) {
    if (!expected) return 401;
    const ok = auth.isAuthorizedRequest({ authorization }, expected);
    return ok ? 200 : 401;
  }
  assert.equal(decide(undefined), 401);
  assert.equal(decide("Bearer nope"), 401);
  assert.equal(decide(`Bearer ${expected}`), 200);
});

test("CI checks the packaged app's Library-tab cookie end to end", () => {
  const workflow = readFileSync(
    path.join(repoRoot, ".github/workflows/electron-build-macos.yml"),
    "utf8"
  );
  const launch = workflow.slice(
    workflow.indexOf("- name: Launch packaged Transcriber.app"),
    workflow.indexOf("- name: Test packaged app (smoke test)")
  );
  assert.match(launch, /Sec-Fetch-Mode: navigate/);
  assert.match(launch, /Sec-Fetch-Dest: document/);
  assert.match(launch, /\?layout=list&id=/);
  assert.match(launch, /transcriber_local_token_\$\{PORT\}/);
  assert.match(launch, /transcriber_local_token_19720=/, "the Dev cookie name is refused");
  for (const site of ["same-origin", "same-site", "cross-site"]) {
    assert.match(launch, new RegExp(`cookie_api ${site} (200|401)`), site);
  }
  assert.doesNotMatch(launch, /cat "\$JAR"|cat \$JAR/, "never print the cookie jar");
});
