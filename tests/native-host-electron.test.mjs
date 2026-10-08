import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const host = require("../tools/native-host/transcriber-host.js");
const hostScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../tools/native-host/transcriber-host.js"
);

function frameMessage(obj) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  return Buffer.concat([len, json]);
}

function decodeFrame(buf) {
  if (!buf || buf.length < 4) return null;
  const n = buf.readUInt32LE(0);
  if (buf.length < 4 + n) return null;
  return JSON.parse(buf.subarray(4, 4 + n).toString("utf8"));
}

function stateDirForHome(home) {
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Transcriber");
  }
  if (process.platform === "win32") {
    return path.join(home, "Transcriber");
  }
  return path.join(home, ".config", "transcriber");
}

async function spawnHost(args, env, msg) {
  const child = spawn(process.execPath, [hostScript, ...args], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (c) => stdout.push(c));
  child.stderr.on("data", (c) => stderr.push(c));
  child.stdin.write(frameMessage(msg));
  child.stdin.end();
  const status = await new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("native host timed out"));
    }, 8000);
    child.on("close", (code) => {
      clearTimeout(t);
      resolve(code);
    });
  });
  return {
    status,
    msg: decodeFrame(Buffer.concat(stdout)),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

test("native host port follows PORT env and defaults to 19720", () => {
  const prev = process.env.PORT;
  try {
    delete process.env.PORT;
    assert.equal(host.getPort(), 19720);
    process.env.PORT = "19721";
    assert.equal(host.getPort(), 19721);
    assert.equal(host.healthUrl(), "http://127.0.0.1:19721/api/health");
  } finally {
    if (prev === undefined) delete process.env.PORT;
    else process.env.PORT = prev;
  }
});

test("Electron mode start opens the given bundle with open -a", () => {
  const launch = host.getStartLaunch(
    { ELECTRON_RUN_AS_NODE: "1" },
    "/App/Contents/MacOS/Transcriber",
    "/Applications/Transcriber.app"
  );
  assert.equal(launch.command, "/usr/bin/open");
  assert.deepEqual(launch.args, [
    "-a",
    "/Applications/Transcriber.app",
    "--args",
    "--launched-by=native-host",
  ]);
  assert.equal(host.ELECTRON_BUNDLE_ID, "com.transcribed.app");
  assert.equal(
    launch.path,
    [
      path.join("/App/Contents/MacOS", "..", "Resources", "bin"),
      "/usr/bin",
      "/bin",
    ].join(path.delimiter)
  );
});

test("native host messages are capped at 1 MiB", () => {
  assert.equal(host.MAX_NATIVE_HOST_MESSAGE, 1024 * 1024);
});

test("non-Electron start still uses npm run dev next to execPath", () => {
  const launch = host.getStartLaunch({}, "/usr/local/bin/node", "/Users/james/transcriber-local");
  assert.equal(launch.command, path.join("/usr/local/bin", "npm"));
  assert.deepEqual(launch.args, ["run", "dev"]);
  assert.equal(launch.cwd, "/Users/james/transcriber-local");
  assert.ok(launch.extraBins.includes("/opt/homebrew/bin"));
});

test("getLocalToken requires a paired caller origin in argv.slice(2)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-nmh-ids-"));
  const idsPath = path.join(dir, "extension-ids.json");
  const paired = "abcdefghijklmnopabcdefghijklmnop";
  fs.writeFileSync(idsPath, JSON.stringify([paired]));
  const electronArgv = [
    "/App/Contents/MacOS/Transcriber",
    "/App/Contents/Resources/app.asar.unpacked/tools/native-host/transcriber-host.js",
    `chrome-extension://${paired}/`,
  ];
  try {
    assert.equal(
      host.parseCallerExtensionId(`chrome-extension://${paired}/`),
      paired
    );
    assert.equal(host.parseCallerExtensionId(`chrome-extension://${paired}`), null);
    assert.equal(host.parseCallerExtensionId("/tmp/transcriber-host.js"), null);
    assert.equal(
      host.findCallerOriginArg(electronArgv),
      `chrome-extension://${paired}/`
    );
    assert.equal(
      host.findCallerOriginArg(["node", `chrome-extension://${paired}/`]),
      null
    );

    const allowed = host.authorizeNativeHostCaller(electronArgv, { idsPath });
    assert.equal(allowed.ok, true);

    const originOnArgv1 = host.authorizeNativeHostCaller(
      ["node", `chrome-extension://${paired}/`],
      { idsPath }
    );
    assert.equal(originOnArgv1.ok, false);
    assert.equal(originOnArgv1.error, "unauthorized_caller");

    const denied = host.replyGetLocalToken(
      "tok",
      [
        "node",
        hostScript,
        "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
      ],
      { idsPath }
    );
    assert.equal(denied.ok, false);
    assert.equal(denied.error, "extension_not_allowed");
    assert.equal(denied._exit, true);

    const missing = host.replyGetLocalToken("tok", ["node", hostScript], {
      idsPath,
    });
    assert.equal(missing.ok, false);
    assert.equal(missing._exit, true);

    const known = host.authorizeNativeHostCaller(
      [
        "node",
        hostScript,
        "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/",
      ],
      { idsPath, knownIds: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"] }
    );
    assert.equal(known.ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("spawned host getLocalToken authorizes the origin argument", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-nmh-spawn-"));
  const stateDir = stateDirForHome(home);
  const paired = "abcdefghijklmnopabcdefghijklmnop";
  const unpaired = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const token = "c".repeat(64);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "extension-ids.json"), JSON.stringify([paired]));
  fs.writeFileSync(path.join(stateDir, "local-api.token"), token, { mode: 0o600 });
  const env = { ...process.env, HOME: home };
  delete env.XDG_CONFIG_HOME;
  delete env.TRANSCRIBER_LOCAL_TOKEN;
  delete env.TRANSCRIBER_STATE_DIR;
  try {
    const allowed = await spawnHost(
      [`chrome-extension://${paired}/`],
      env,
      { id: "tok", cmd: "getLocalToken" }
    );
    assert.equal(allowed.msg?.ok, true, allowed.stderr);
    assert.equal(allowed.msg?.token, token);
    assert.equal(allowed.msg?.id, "tok");

    const denied = await spawnHost(
      [`chrome-extension://${unpaired}/`],
      env,
      { id: "tok", cmd: "getLocalToken" }
    );
    assert.equal(denied.msg?.ok, false, denied.stderr);
    assert.equal(denied.msg?.error, "extension_not_allowed");
    assert.notEqual(denied.status, 0);

    const missing = await spawnHost([], env, { id: "tok", cmd: "getLocalToken" });
    assert.equal(missing.msg?.ok, false, missing.stderr);
    assert.equal(missing.msg?.error, "unauthorized_caller");
    assert.notEqual(missing.status, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("getLocalToken reads token from TRANSCRIBER_STATE_DIR not the checkout dir", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-nmh-home-"));
  const appState = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-nmh-app-"));
  const checkoutState = stateDirForHome(home);
  const paired = "abcdefghijklmnopabcdefghijklmnop";
  const token = "d".repeat(64);
  fs.mkdirSync(checkoutState, { recursive: true });
  fs.writeFileSync(path.join(checkoutState, "extension-ids.json"), JSON.stringify([]));
  fs.writeFileSync(path.join(checkoutState, "local-api.token"), "e".repeat(64), { mode: 0o600 });
  fs.writeFileSync(path.join(appState, "extension-ids.json"), JSON.stringify([paired]));
  fs.writeFileSync(path.join(appState, "local-api.token"), token, { mode: 0o600 });
  const env = { ...process.env, HOME: home, TRANSCRIBER_STATE_DIR: appState };
  delete env.XDG_CONFIG_HOME;
  delete env.TRANSCRIBER_LOCAL_TOKEN;
  try {
    const allowed = await spawnHost(
      [`chrome-extension://${paired}/`],
      env,
      { id: "tok", cmd: "getLocalToken" }
    );
    assert.equal(allowed.msg?.ok, true, allowed.stderr);
    assert.equal(allowed.msg?.token, token);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(appState, { recursive: true, force: true });
  }
});

test("spawnDetached error handler keeps the process alive", async () => {
  const child = host.spawnDetached("definitely-not-a-binary-zzzz", [], {
    stdio: "ignore",
  });
  assert.ok(child.listenerCount("error") >= 1);
  const err = await new Promise((resolve) => {
    child.on("error", resolve);
  });
  assert.equal(err.code, "ENOENT");
});

function withHostLogDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-nmh-log-"));
  const prevState = process.env.TRANSCRIBER_STATE_DIR;
  const prevLog = process.env.TRANSCRIBER_LOG_DIR;
  process.env.TRANSCRIBER_STATE_DIR = path.join(dir, "state");
  process.env.TRANSCRIBER_LOG_DIR = path.join(dir, "logs");
  try {
    return fn(host, process.env.TRANSCRIBER_LOG_DIR);
  } finally {
    if (prevState === undefined) delete process.env.TRANSCRIBER_STATE_DIR;
    else process.env.TRANSCRIBER_STATE_DIR = prevState;
    if (prevLog === undefined) delete process.env.TRANSCRIBER_LOG_DIR;
    else process.env.TRANSCRIBER_LOG_DIR = prevLog;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const logMode = (file) => fs.statSync(file).mode & 0o777;

test("native-host.log is created 0600 and an existing 0644 is chmodded", () => {
  assert.equal(host.LOG_FILE_MODE, 0o600);
  assert.equal(typeof host.log, "function");
  withHostLogDir((_, logDir) => {
    host.log("first line");
    const file = host.logFile();
    assert.equal(file, path.join(logDir, "native-host.log"));
    assert.equal(logMode(file), 0o600, "a new native-host.log");
    assert.match(fs.readFileSync(file, "utf8"), /first line/);
  });
  withHostLogDir((_, logDir) => {
    fs.mkdirSync(logDir, { recursive: true });
    const file = path.join(logDir, "native-host.log");
    fs.writeFileSync(file, "old line\n");
    fs.chmodSync(file, 0o644);
    host.log("after tighten");
    assert.equal(logMode(file), 0o600, "an existing native-host.log");
    assert.match(fs.readFileSync(file, "utf8"), /^old line\n/);
    assert.match(fs.readFileSync(file, "utf8"), /after tighten/);
  });
});

test("native host never calls the local API without a Bearer token", () => {
  const src = fs.readFileSync(hostScript, "utf8");
  const fn = src.slice(src.indexOf("function authHeaders"), src.indexOf("function probeOnce"));
  assert.match(fn, /Authorization/);
  assert.doesNotMatch(fn, /return \{\}/);
  assert.equal(typeof host.authHeaders, "function");
  withHostLogDir(() => {
    const headers = host.authHeaders();
    assert.match(headers.Authorization, /^Bearer \S+$/);
  });
});

test("native-host.log rotates at about 5MB and keeps one .1", () => {
  assert.equal(host.LOG_MAX_BYTES, 5 * 1024 * 1024);
  withHostLogDir((_, logDir) => {
    const file = host.logFile();
    const rotated = `${file}.1`;
    host.log("open");

    fs.writeFileSync(file, "a".repeat(host.LOG_MAX_BYTES - 10));
    host.log("still under the cap");
    assert.equal(fs.existsSync(rotated), false, "no rotation under 5MB");

    fs.writeFileSync(file, "b".repeat(host.LOG_MAX_BYTES));
    host.log("first after rotation");
    assert.equal(fs.statSync(rotated).size, host.LOG_MAX_BYTES);
    assert.match(fs.readFileSync(file, "utf8"), /first after rotation/);
    assert.equal(logMode(file), 0o600);
    assert.equal(logMode(rotated), 0o600);

    fs.writeFileSync(file, "c".repeat(host.LOG_MAX_BYTES + 1));
    host.log("second rotation");
    assert.equal(fs.readFileSync(rotated, "utf8")[0], "c", ".1 is replaced, not kept beside");
    assert.deepEqual(
      fs.readdirSync(logDir).filter((f) => f.startsWith("native-host.log")).sort(),
      ["native-host.log", "native-host.log.1"]
    );
  });
});
