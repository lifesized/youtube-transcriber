/**
 * Native host protocol v2: version handshake, the app host's Start
 * allowlist, the dev-only Stop, and the no_token reason.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hostScript = path.join(repoRoot, "tools/native-host/transcriber-host.js");
const host = require(hostScript);

const PAIRED = "abcdefghijklmnopabcdefghijklmnop";
const APPLICATIONS_HAS_APP = host.isTranscriberBundle(host.DEFAULT_APP_BUNDLE);

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeBundle(bundleId = "com.transcribed.app", name = "Transcriber.app") {
  const bundle = path.join(fs.realpathSync(tmp("ytt-bundle-")), name);
  fs.mkdirSync(path.join(bundle, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(
    path.join(bundle, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
</dict></plist>
`
  );
  return bundle;
}

function exe(bundle) {
  return path.join(bundle, "Contents", "MacOS", "Transcriber");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function withEnv(vars, fn) {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function wire(msg, env) {
  const child = spawn(process.execPath, [hostScript], { env, stdio: ["pipe", "pipe", "pipe"] });
  const json = Buffer.from(JSON.stringify(msg));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  child.stdin.write(Buffer.concat([len, json]));
  child.stdin.end();
  const chunks = [];
  child.stdout.on("data", (c) => chunks.push(c));
  await new Promise((resolve) => child.on("close", resolve));
  const buf = Buffer.concat(chunks);
  return JSON.parse(buf.subarray(4, 4 + buf.readUInt32LE(0)).toString("utf8"));
}

function hostEnv(extra = {}) {
  const stateDir = tmp("ytt-hs-state-");
  const env = {
    ...process.env,
    TRANSCRIBER_STATE_DIR: stateDir,
    TRANSCRIBER_LOG_DIR: path.join(stateDir, "logs"),
    ...extra,
  };
  delete env.TRANSCRIBER_LOCAL_TOKEN;
  if (!("ELECTRON_RUN_AS_NODE" in extra)) delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

test("version and ping report protocol 2, every command, and the target", async () => {
  for (const cmd of ["version", "ping"]) {
    const dev = await wire({ id: cmd, cmd }, hostEnv());
    assert.equal(dev.id, cmd);
    assert.equal(dev.ok, true);
    assert.equal(dev.pong, true, "CI's packaged ping still expects pong");
    assert.equal(dev.protocol, 2);
    assert.equal(dev.target, "dev");
    assert.deepEqual(dev.commands, [
      "ping",
      "version",
      "probe",
      "start",
      "stop",
      "status",
      "getLocalToken",
    ]);
  }
  const app = await wire({ id: "v", cmd: "version" }, hostEnv({ ELECTRON_RUN_AS_NODE: "1" }));
  assert.equal(app.target, "app");
  assert.equal(app.protocol, host.PROTOCOL_VERSION);
});

test("an unknown command still answers unknown_cmd", async () => {
  const r = await wire({ id: "x", cmd: "launch" }, hostEnv());
  assert.deepEqual(r, { id: "x", ok: false, error: "unknown_cmd", cmd: "launch" });
});

test("app Start opens the install the wrapper runs from with /usr/bin/open -a", () => {
  const bundle = makeBundle();
  const r = host.resolveStartLaunch({ ELECTRON_RUN_AS_NODE: "1" }, exe(bundle));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.bundle, bundle);
  assert.equal(r.launch.command, "/usr/bin/open");
  assert.deepEqual(r.launch.args, ["-a", bundle]);
  assert.equal(r.launch.cwd, undefined);
});

test("the app Start allowlist is the recorded install plus /Applications only", () => {
  const bundle = makeBundle();
  assert.deepEqual(host.appBundleCandidates(exe(bundle)), [bundle, "/Applications/Transcriber.app"]);
  assert.deepEqual(host.appBundleCandidates("/Applications/Transcriber.app/Contents/MacOS/Transcriber"), [
    "/Applications/Transcriber.app",
  ]);
  assert.deepEqual(host.appBundleCandidates("/usr/local/bin/node"), ["/Applications/Transcriber.app"]);
  assert.deepEqual(
    host.appBundleCandidates("/Volumes/Transcriber/Transcriber.app/Contents/MacOS/Transcriber"),
    ["/Applications/Transcriber.app"],
    "never launch from a mounted DMG"
  );
  assert.deepEqual(
    host.appBundleCandidates(
      "/private/var/folders/x/AppTranslocation/ABC/d/Transcriber.app/Contents/MacOS/Transcriber"
    ),
    ["/Applications/Transcriber.app"],
    "never launch a translocated copy"
  );
  assert.equal(host.bundleFromExecPath("relative/Transcriber.app/Contents/MacOS/Transcriber"), null);
  assert.equal(host.bundleFromExecPath("/opt/Transcriber/Contents/MacOS/Transcriber"), null);
});

test("a bundle with another CFBundleIdentifier is never launched", { skip: APPLICATIONS_HAS_APP }, () => {
  for (const id of ["com.evil.app", "com.transcribed.app.helper"]) {
    const bundle = makeBundle(id);
    assert.equal(host.isTranscriberBundle(bundle), false, id);
    const r = host.resolveStartLaunch({ ELECTRON_RUN_AS_NODE: "1" }, exe(bundle));
    assert.equal(r.ok, false);
    assert.equal(r.reason, "app_not_found");
    assert.equal(r.launch, undefined);
  }
});

test("the wire start ignores any path in the payload", { skip: APPLICATIONS_HAS_APP }, async () => {
  const evil = makeBundle("com.transcribed.app", "Evil.app");
  const r = await wire(
    { id: "s", cmd: "start", bundle: evil, path: evil, args: ["-a", evil] },
    hostEnv({ ELECTRON_RUN_AS_NODE: "1", PORT: String(await freePort()) })
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "app_not_found");
  assert.doesNotMatch(r.detail, /Evil\.app/);
});

test("the dev wire start returns as soon as npm is spawned, without waiting for health", async () => {
  const root = path.join(fs.realpathSync(tmp("ytt-hs-root-")), "transcriber-local");
  fs.mkdirSync(path.join(root, "node_modules", "@prisma", "client"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules", ".prisma", "client"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "@prisma", "client", "package.json"), "{}");
  fs.writeFileSync(path.join(root, "node_modules", ".prisma", "client", "schema.prisma"), "");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "youtube-transcriber", scripts: { dev: "node -e \"setTimeout(()=>{},30000)\"" } })
  );
  const env = hostEnv({ PORT: String(await freePort()) });
  fs.writeFileSync(path.join(env.TRANSCRIBER_STATE_DIR, "native-host.json"), JSON.stringify({ projectRoot: root }));
  const started = Date.now();
  const r = await wire({ id: "s", cmd: "start" }, env);
  try {
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.started, true);
    assert.equal(r.probe, undefined);
    assert.ok(Date.now() - started < 5000, "start must not block on health polling");
  } finally {
    if (r.pid) {
      try {
        process.kill(-r.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
});

test("Stop is unsupported on the app host", async () => {
  await withEnv({ ELECTRON_RUN_AS_NODE: "1" }, () => {
    assert.deepEqual(host.stopServer(), { stopped: false, reason: "stop_unsupported" });
  });
});

test("dev Stop only signals the process group the host recorded", async () => {
  const stateDir = tmp("ytt-hs-stop-");
  await withEnv(
    {
      ELECTRON_RUN_AS_NODE: undefined,
      TRANSCRIBER_STATE_DIR: stateDir,
      TRANSCRIBER_LOG_DIR: path.join(stateDir, "logs"),
    },
    async () => {
      assert.deepEqual(host.stopServer(), { stopped: false, reason: "not_running" });

      fs.writeFileSync(host.stateFile(), JSON.stringify({ pid: 1 }));
      assert.deepEqual(host.stopServer(), { stopped: false, reason: "not_running" }, "never pid 1");

      const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},30000)"], {
        detached: true,
        stdio: "ignore",
      });
      const exited = new Promise((resolve) => child.on("exit", resolve));
      fs.writeFileSync(host.stateFile(), JSON.stringify({ pid: child.pid, startedAt: Date.now() }));
      const r = host.stopServer();
      assert.deepEqual(r, { stopped: true, pid: child.pid });
      await exited;
      assert.deepEqual(JSON.parse(fs.readFileSync(host.stateFile(), "utf8")), {});
    }
  );
});

test("getLocalToken answers no_token when the token cannot be read or created", async () => {
  const blocker = path.join(tmp("ytt-hs-tok-"), "not-a-dir");
  fs.writeFileSync(blocker, "");
  const idsDir = tmp("ytt-hs-ids-");
  const idsPath = path.join(idsDir, "extension-ids.json");
  fs.writeFileSync(idsPath, JSON.stringify([PAIRED]));
  await withEnv(
    {
      TRANSCRIBER_STATE_DIR: path.join(blocker, "state"),
      TRANSCRIBER_LOG_DIR: path.join(idsDir, "logs"),
      TRANSCRIBER_LOCAL_TOKEN: undefined,
    },
    () => {
      const r = host.replyGetLocalToken("t", ["node", hostScript, `chrome-extension://${PAIRED}/`], {
        idsPath,
      });
      assert.deepEqual(r, { id: "t", ok: false, error: "no_token" });
    }
  );
});
