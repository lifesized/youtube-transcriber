import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const auth = require(path.join(root, "lib/local-api-auth.js"));
const { POST } = await import("../app/api/settings/open-external/route.ts");

const TOKEN = "s".repeat(64);
const COOKIE = `${auth.cookieName(19721)}=${TOKEN}`;
const ANTHROPIC = "https://console.anthropic.com/settings/keys";

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

test("POST /api/settings/open-external is Settings-cookie only and allowlists the three URLs", async () => {
  const prevPort = process.env.PORT;
  const prevToken = process.env.TRANSCRIBER_LOCAL_TOKEN;
  process.env.PORT = "19721";
  process.env.TRANSCRIBER_LOCAL_TOKEN = TOKEN;
  try {
    const bearer = await POST(
      fakeRequest({ authorization: `Bearer ${TOKEN}`, secFetchSite: "cross-site" }, { url: ANTHROPIC })
    );
    assert.equal(bearer.status, 401);

    const plusAuth = await POST(
      fakeRequest(
        {
          authorization: `Bearer ${TOKEN}`,
          cookie: COOKIE,
          secFetchSite: "same-origin",
        },
        { url: ANTHROPIC }
      )
    );
    assert.equal(plusAuth.status, 401);

    const badUrl = await POST(
      fakeRequest({ cookie: COOKIE, secFetchSite: "same-origin" }, { url: "https://evil.example/keys" })
    );
    assert.equal(badUrl.status, 400);

    const settings = await POST(
      fakeRequest({ cookie: COOKIE, secFetchSite: "same-origin" }, { url: ANTHROPIC })
    );
    assert.equal(settings.status, 503);
    const payload = await settings.json();
    assert.match(payload.error, /menu bar/i);
    assert.doesNotMatch(JSON.stringify(payload), /sk-|xoxb|xapp|Bearer/i);
  } finally {
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
    if (prevToken === undefined) delete process.env.TRANSCRIBER_LOCAL_TOKEN;
    else process.env.TRANSCRIBER_LOCAL_TOKEN = prevToken;
  }
});

test("Settings AI key missing buttons post the three links without Authorization", () => {
  const panel = readFileSync(path.join(root, "components/settings-panel.tsx"), "utf8");
  assert.match(panel, /AI key missing/);
  assert.match(panel, /\/api\/settings\/open-external/);
  assert.match(panel, /https:\/\/console\.anthropic\.com\/settings\/keys/);
  assert.match(panel, /https:\/\/platform\.openai\.com\/api-keys/);
  assert.match(panel, /https:\/\/openrouter\.ai\/keys/);
  const idx = panel.indexOf("/api/settings/open-external");
  const chunk = panel.slice(idx - 200, idx + 280);
  assert.doesNotMatch(chunk, /Authorization/);
});
