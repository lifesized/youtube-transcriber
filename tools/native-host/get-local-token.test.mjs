import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hostPath = path.join(repoRoot, "tools/native-host/transcriber-host.js");
const { ensureLocalApiToken, tokensEqual } = require(path.join(repoRoot, "lib/local-api-token.js"));

function sendNativeMessage(proc, obj) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  proc.stdin.write(Buffer.concat([len, json]));
}

function readNativeMessage(proc, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 4) return;
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) return;
      clearTimeout(timer);
      proc.stdout.off("data", onData);
      const json = buf.slice(4, 4 + len).toString("utf8");
      resolve(JSON.parse(json));
    };
    proc.stdout.on("data", onData);
  });
}

test("native host getLocalToken returns token matching file/env helper", async () => {
  const expected = ensureLocalApiToken();
  const proc = spawn(process.execPath, [hostPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  try {
    sendNativeMessage(proc, { id: "1", cmd: "getLocalToken" });
    const reply = await readNativeMessage(proc);
    assert.equal(reply.ok, true);
    assert.equal(typeof reply.token, "string");
    assert.ok(tokensEqual(reply.token, expected));
  } finally {
    proc.kill("SIGTERM");
  }
});
