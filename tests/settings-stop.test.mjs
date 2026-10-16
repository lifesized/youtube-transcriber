import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const auth = require(path.join(root, "lib/local-api-auth.js"));
const ipc = require(path.join(root, "lib/electron-ipc.js"));
const { GET, POST } = await import("../app/api/settings/stop/route.ts");

const TOKEN = "s".repeat(64);
const COOKIE = `${auth.cookieName(19721)}=${TOKEN}`;

function fakeRequest(headers) {
  return {
    headers: {
      get(name) {
        const key = String(name || "").toLowerCase();
        if (key === "authorization") return headers.authorization ?? null;
        if (key === "cookie") return headers.cookie || null;
        if (key === "sec-fetch-site") return headers.secFetchSite || null;
        return null;
      },
    },
  };
}

async function withAppToken(fn) {
  const prevPort = process.env.PORT;
  const prevToken = process.env.TRANSCRIBER_LOCAL_TOKEN;
  const prevElectron = process.env.ELECTRON_RUN_AS_NODE;
  process.env.PORT = "19721";
  process.env.TRANSCRIBER_LOCAL_TOKEN = TOKEN;
  delete process.env.ELECTRON_RUN_AS_NODE;
  try {
    await fn();
  } finally {
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
    if (prevToken === undefined) delete process.env.TRANSCRIBER_LOCAL_TOKEN;
    else process.env.TRANSCRIBER_LOCAL_TOKEN = prevToken;
    if (prevElectron === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = prevElectron;
  }
}

test("canStopViaElectronIpc is only the packaged Electron child", () => {
  assert.equal(ipc.canStopViaElectronIpc({ ELECTRON_RUN_AS_NODE: "1" }, { send() {} }), true);
  assert.equal(ipc.canStopViaElectronIpc({}, { send() {} }), false);
  assert.equal(ipc.canStopViaElectronIpc({ ELECTRON_RUN_AS_NODE: "1" }, {}), false);
});

test("GET/POST /api/settings/stop is Settings-cookie only; Bearer cannot stop", async () => {
  await withAppToken(async () => {
    const settingsHeaders = { cookie: COOKIE, secFetchSite: "same-origin" };

    const bearerGet = await GET(
      fakeRequest({ authorization: `Bearer ${TOKEN}`, secFetchSite: "cross-site" })
    );
    assert.equal(bearerGet.status, 401);

    const plusAuth = await POST(
      fakeRequest({
        authorization: `Bearer ${TOKEN}`,
        cookie: COOKIE,
        secFetchSite: "same-origin",
      })
    );
    assert.equal(plusAuth.status, 401);

    const none = await POST(fakeRequest({ cookie: COOKIE, secFetchSite: "none" }));
    assert.equal(none.status, 401);

    const getOk = await GET(fakeRequest(settingsHeaders));
    assert.equal(getOk.status, 200);
    assert.deepEqual(await getOk.json(), { canStop: false });

    const postDev = await POST(fakeRequest(settingsHeaders));
    assert.equal(postDev.status, 503);
    const payload = await postDev.json();
    assert.match(payload.error, /menu bar/i);
    assert.doesNotMatch(JSON.stringify(payload), /sk-|xoxb|xapp|Bearer/i);
  });
});

test("Settings Stop button posts /api/settings/stop without Authorization", () => {
  const panel = readFileSync(path.join(root, "components/settings-panel.tsx"), "utf8");
  assert.match(panel, /Stop server/);
  assert.match(panel, /\/api\/settings\/stop/);
  const idx = panel.indexOf("/api/settings/stop");
  const chunk = panel.slice(idx - 240, idx + 280);
  assert.doesNotMatch(chunk, /Authorization/);
  assert.match(panel, /canStop/);

  const popup = readFileSync(path.join(root, "extension/popup.js"), "utf8");
  const connect = readFileSync(path.join(root, "extension/connect-target.js"), "utf8");
  assert.match(connect, /stop:\s*false/);
  assert.match(popup, /FEATURES\.stop/);
});
