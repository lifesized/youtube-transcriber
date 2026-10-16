import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { attachServerStopIpc } = require(path.join(root, "electron/server-stop-ipc.js"));

test("main attaches server-stop IPC on the Next child", () => {
  const main = readFileSync(path.join(root, "electron/main.js"), "utf8");
  assert.match(main, /attachServerStopIpc\(child,\s*serverManager\)/);
  assert.doesNotMatch(main, /app\/api\/settings\/stop/);
});

test("server-stop IPC replies first, then stops; other messages are ignored", async () => {
  const sent = [];
  let handler;
  const child = {
    on(_ev, fn) {
      handler = fn;
    },
    send(msg) {
      sent.push(msg);
    },
  };
  let stopped = 0;
  attachServerStopIpc(child, { stop: async () => { stopped += 1; } }, 0);

  handler({ type: "open-external", requestId: "nope" });
  handler({ type: "server-stop" });
  assert.equal(sent.length, 0);
  assert.equal(stopped, 0);

  handler({ type: "server-stop", requestId: "abc" });
  assert.deepEqual(sent, [
    { type: "server-stop-result", requestId: "abc", payload: { ok: true } },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(stopped, 1);
});
