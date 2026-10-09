import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const auth = require(path.join(root, "lib/local-api-auth.js"));
const { PUT } = await import("../app/api/settings/tusk/route.ts");

const TOKEN = "s".repeat(64);
const COOKIE = `${auth.cookieName(19721)}=${TOKEN}`;

function fakeRequest(headers, body = {}) {
  return {
    headers: {
      get(name) {
        const key = String(name || "").toLowerCase();
        if (key === "authorization") return headers.authorization || null;
        if (key === "cookie") return headers.cookie || null;
        if (key === "sec-fetch-site") return headers.secFetchSite || null;
        return null;
      },
    },
    json: async () => body,
  };
}

test("PUT /api/settings/tusk rejects bearer-only and accepts Settings same-origin cookie", async () => {
  const prevPort = process.env.PORT;
  const prevToken = process.env.TRANSCRIBER_LOCAL_TOKEN;
  process.env.PORT = "19721";
  process.env.TRANSCRIBER_LOCAL_TOKEN = TOKEN;
  try {
    const bearer = await PUT(
      fakeRequest({ authorization: `Bearer ${TOKEN}`, secFetchSite: "cross-site" })
    );
    assert.equal(bearer.status, 401);

    const cookieNone = await PUT(fakeRequest({ cookie: COOKIE, secFetchSite: "none" }));
    assert.equal(cookieNone.status, 401);

    const cookiePlusAuth = await PUT(
      fakeRequest(
        {
          authorization: `Bearer ${TOKEN}`,
          cookie: COOKIE,
          secFetchSite: "same-origin",
        },
        { enabled: false }
      )
    );
    assert.equal(cookiePlusAuth.status, 401);

    const settings = await PUT(
      fakeRequest({ cookie: COOKIE, secFetchSite: "same-origin" }, { enabled: false })
    );
    // Settings page is authorized; Electron IPC is missing in this unit test.
    assert.equal(settings.status, 503);
    const payload = await settings.json();
    assert.match(payload.error, /menu-bar app|Keychain/i);

    const resumeBearer = await PUT(
      fakeRequest({ authorization: `Bearer ${TOKEN}`, secFetchSite: "cross-site" }, { resumeDigest: true })
    );
    assert.equal(resumeBearer.status, 401);

    const resumeAuthPlusCookie = await PUT(
      fakeRequest(
        {
          authorization: `Bearer ${TOKEN}`,
          cookie: COOKIE,
          secFetchSite: "same-origin",
        },
        { resumeDigest: true }
      )
    );
    assert.equal(resumeAuthPlusCookie.status, 401);

    const resumeSettings = await PUT(
      fakeRequest({ cookie: COOKIE, secFetchSite: "same-origin" }, { resumeDigest: true })
    );
    assert.equal(resumeSettings.status, 503);
  } finally {
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
    if (prevToken === undefined) delete process.env.TRANSCRIBER_LOCAL_TOKEN;
    else process.env.TRANSCRIBER_LOCAL_TOKEN = prevToken;
  }
});

test("Settings Slack (Tusk) Resume digest uses the cookie write gate, not Authorization", () => {
  const panel = readFileSync(path.join(root, "components/settings-panel.tsx"), "utf8");
  assert.match(panel, /Resume digest/);
  assert.match(panel, /resumeDigest:\s*true/);
  const resumeIdx = panel.indexOf("resumeDigest: true");
  assert.ok(resumeIdx > 0);
  const resumeChunk = panel.slice(resumeIdx - 400, resumeIdx + 80);
  assert.match(resumeChunk, /\/api\/settings\/tusk/);
  assert.doesNotMatch(resumeChunk, /Authorization/);
});
