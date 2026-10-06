import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

function frame(obj) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  return Buffer.concat([len, json]);
}

function readFrames(buf) {
  const messages = [];
  let rest = buf;
  while (rest.length >= 4) {
    const len = rest.readUInt32LE(0);
    if (rest.length < 4 + len) break;
    messages.push(JSON.parse(rest.slice(4, 4 + len).toString("utf8")));
    rest = rest.slice(4 + len);
  }
  return messages;
}

test("native host getLocalToken returns the token and does not log it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-host-"));
  const token = "ytt-test-token-do-not-log";
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const host = path.join(root, "tools", "native-host", "transcriber-host.js");
  const child = spawn(process.execPath, [host], {
    env: {
      ...process.env,
      TRANSCRIBER_STATE_DIR: dir,
      TRANSCRIBER_LOCAL_TOKEN: token,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("native host timed out: " + Buffer.concat(stderr).toString("utf8")));
    }, 5000);
    child.stdout.on("data", () => {
      const messages = readFrames(Buffer.concat(stdout));
      if (messages.length) {
        clearTimeout(timer);
        resolve(messages[0]);
      }
    });
    child.on("exit", (code) => {
      if (readFrames(Buffer.concat(stdout)).length) return;
      clearTimeout(timer);
      reject(new Error("native host exited " + code + " " + Buffer.concat(stderr).toString("utf8")));
    });
  });

  child.stdin.write(frame({ id: "1", cmd: "getLocalToken" }));
  const reply = await done;
  child.kill();

  assert.equal(reply.ok, true);
  assert.equal(reply.token, token);
  assert.equal(reply.id, "1");

  const log = fs.readFileSync(path.join(dir, "native-host.log"), "utf8");
  assert.equal(log.includes(token), false);
  assert.match(log, /getLocalToken/);
  const tokenFile = path.join(dir, "local-api.token");
  assert.equal(fs.readFileSync(tokenFile, "utf8").trim(), token);
  assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600);
});
