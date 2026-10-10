import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  evaluateUpdaterGate,
  readExpectedTeamId,
  pinnedFeed,
  feedFromEnvOrSettings,
  UPDATE_FEED,
} = require(path.join(root, "electron", "updater-gate.js"));
const { parseCodesignVerbose, appBundleFromExecPath } = require(
  path.join(root, "electron", "code-signature.js")
);
const {
  createUpdater,
  evaluateFromDisk,
  readDarwinSignature,
  readDarwinSignatureAsync,
  CODESIGN_BIN,
  configureAutoUpdater,
  isBetaPrereleaseVersion,
  stopServerThenInstall,
  INITIAL_DELAY_MS,
  INTERVAL_MS,
  BEFORE_QUIT_HOOK_TIMEOUT_MS,
} = require(path.join(root, "electron", "updater.js"));
const { buildTrayMenuTemplate } = require(
  path.join(root, "electron", "tray-menu.js")
);

const TEAM = "ABCD123456";
const developerId = {
  identifier: "com.transcribed.app",
  teamId: TEAM,
  authorities: [`Developer ID Application: LifeSized (${TEAM})`],
  adhoc: false,
  developerId: true,
  notSigned: false,
};

function enabledInput(extra = {}) {
  return {
    isPackaged: true,
    isDev: false,
    signature: developerId,
    expectedTeamId: TEAM,
    ...extra,
  };
}

test("gate is off for dev, unpackaged, unsigned, ad-hoc, and team mismatch", () => {
  assert.equal(evaluateUpdaterGate({ isDev: true, isPackaged: true }).enabled, false);
  assert.equal(evaluateUpdaterGate({ isPackaged: false }).enabled, false);
  assert.equal(
    evaluateUpdaterGate({
      isPackaged: true,
      signature: { ...developerId, notSigned: true },
      expectedTeamId: TEAM,
    }).reason,
    "unsigned"
  );
  assert.equal(
    evaluateUpdaterGate({
      isPackaged: true,
      signature: { ...developerId, adhoc: true, developerId: false, teamId: "" },
      expectedTeamId: TEAM,
    }).reason,
    "adhoc"
  );
  assert.equal(
    evaluateUpdaterGate({
      isPackaged: true,
      signature: { ...developerId, teamId: "ZZZZZZZZZZ" },
      expectedTeamId: TEAM,
    }).reason,
    "team-mismatch"
  );
  assert.equal(
    evaluateUpdaterGate({
      isPackaged: true,
      signature: { ...developerId, developerId: false },
      expectedTeamId: TEAM,
    }).reason,
    "not-developer-id"
  );
  assert.equal(evaluateUpdaterGate(enabledInput()).enabled, true);
});

test("feed is pinned to lifesized/youtube-transcriber and ignores env or settings", () => {
  assert.deepEqual(UPDATE_FEED, {
    provider: "github",
    owner: "lifesized",
    repo: "youtube-transcriber",
  });
  assert.deepEqual(pinnedFeed(), {
    provider: "github",
    owner: "lifesized",
    repo: "youtube-transcriber",
    private: false,
  });
  assert.deepEqual(
    feedFromEnvOrSettings(
      { UPDATE_URL: "https://evil.example/latest-mac.yml", GH_TOKEN: "nope" },
      { feedUrl: "https://evil.example/latest-mac.yml" }
    ),
    pinnedFeed()
  );
});

test("readExpectedTeamId accepts only a 10-character team id", () => {
  assert.equal(readExpectedTeamId({ teamId: TEAM }), TEAM);
  assert.equal(readExpectedTeamId({ teamId: "short" }), "");
  assert.equal(readExpectedTeamId(null), "");
});

test("parseCodesignVerbose distinguishes ad-hoc from Developer ID", () => {
  const adhoc = parseCodesignVerbose(
    "Identifier=com.transcribed.app\nSignature=adhoc\nTeamIdentifier=not set\n"
  );
  assert.equal(adhoc.adhoc, true);
  assert.equal(adhoc.developerId, false);
  const signed = parseCodesignVerbose(
    [
      "Identifier=com.transcribed.app",
      `Authority=Developer ID Application: LifeSized (${TEAM})`,
      "Authority=Developer ID Certification Authority",
      "Authority=Apple Root CA",
      `TeamIdentifier=${TEAM}`,
    ].join("\n")
  );
  assert.equal(signed.developerId, true);
  assert.equal(signed.teamId, TEAM);
  assert.equal(signed.adhoc, false);
});

test("appBundleFromExecPath walks up from Contents/MacOS", () => {
  assert.equal(
    appBundleFromExecPath("/Applications/Transcriber.app/Contents/MacOS/Transcriber"),
    "/Applications/Transcriber.app"
  );
  assert.equal(appBundleFromExecPath("/usr/local/bin/electron"), "");
});

test("disabled updater never requires electron-updater and never starts timers or network", () => {
  let loaded = 0;
  let timeouts = 0;
  let intervals = 0;
  const updater = createUpdater({
    isPackaged: false,
    isDev: true,
    resourcesPath: "/tmp/missing",
    execPath: "/tmp/electron",
    loadAutoUpdater() {
      loaded += 1;
      throw new Error("electron-updater must not load when disabled");
    },
    setTimeoutFn() {
      timeouts += 1;
      return 1;
    },
    setIntervalFn() {
      intervals += 1;
      return 2;
    },
  });
  assert.equal(updater.enabled, false);
  updater.startBackgroundChecks();
  updater.checkForUpdates();
  updater.downloadUpdate();
  assert.equal(loaded, 0);
  assert.equal(timeouts, 0);
  assert.equal(intervals, 0);
});

test("enabled updater pins the GitHub feed and does not honor env overrides", () => {
  const calls = [];
  const fake = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    allowPrerelease: false,
    forceDevUpdateConfig: true,
    on() {},
    setFeedURL(feed) {
      calls.push(feed);
    },
    checkForUpdates() {
      return Promise.resolve();
    },
    downloadUpdate() {
      return Promise.resolve();
    },
    quitAndInstall() {},
  };
  process.env.UPDATE_URL = "https://evil.example/latest-mac.yml";
  const dir = mkdtempSync(path.join(tmpdir(), "ytt-sign-id-"));
  try {
    writeFileSync(
      path.join(dir, "signing-identity.json"),
      JSON.stringify({ teamId: TEAM })
    );
    const updater = createUpdater({
      isPackaged: true,
      isDev: false,
      resourcesPath: dir,
      signature: developerId,
      loadAutoUpdater: () => fake,
    });
    assert.equal(updater.enabled, true);
    assert.deepEqual(calls[0], pinnedFeed());
    assert.equal(fake.autoDownload, false);
    assert.equal(fake.allowDowngrade, false);
    assert.equal(fake.allowPrerelease, true);
    assert.equal(fake.channel, "beta");
    assert.equal(fake.autoInstallOnAppQuit, false);
    assert.equal(fake.forceDevUpdateConfig, false);
    assert.equal(fake.isUpdateSupported({ version: "0.2.0-beta.2" }), true);
    assert.equal(fake.isUpdateSupported({ version: "1.0.0" }), false);
    assert.equal(updater.feed.owner, "lifesized");
    assert.equal(updater.feed.repo, "youtube-transcriber");
  } finally {
    delete process.env.UPDATE_URL;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("evaluateFromDisk stays off when signing-identity.json is missing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ytt-no-id-"));
  try {
    const gate = evaluateFromDisk({
      isPackaged: true,
      isDev: false,
      resourcesPath: dir,
      signature: developerId,
    });
    assert.equal(gate.enabled, false);
    assert.equal(gate.reason, "no-team-id");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stopServerThenInstall stops Next before quitAndInstall", async () => {
  const order = [];
  await stopServerThenInstall(
    {
      async stop() {
        order.push("stop");
      },
    },
    () => order.push("install")
  );
  assert.deepEqual(order, ["stop", "install"]);
});

function quitUpdaterFixture({
  onBeforeQuitAndInstall,
  onReadyToInstall,
  onInstallFailed,
  beforeQuitHookTimeoutMs,
  order,
  quitAndInstall,
  start,
}) {
  const dir = mkdtempSync(path.join(tmpdir(), "ytt-quit-hook-"));
  writeFileSync(
    path.join(dir, "signing-identity.json"),
    JSON.stringify({ teamId: TEAM })
  );
  const updater = createUpdater({
    isPackaged: true,
    isDev: false,
    resourcesPath: dir,
    signature: developerId,
    beforeQuitHookTimeoutMs,
    serverManager: {
      async stop() {
        order.push("stop-server");
      },
      async start() {
        order.push("start-server");
        if (typeof start === "function") await start();
      },
    },
    onBeforeQuitAndInstall,
    onReadyToInstall,
    onInstallFailed,
    loadAutoUpdater: () => ({
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowDowngrade: true,
      allowPrerelease: false,
      forceDevUpdateConfig: true,
      on() {},
      setFeedURL() {},
      quitAndInstall:
        quitAndInstall ||
        (() => {
          order.push("install");
        }),
    }),
  });
  return { updater, dir };
}

test("quitAndInstall awaits onBeforeQuitAndInstall before stopping the server", async () => {
  const order = [];
  let installing = false;
  const { updater, dir } = quitUpdaterFixture({
    order,
    onBeforeQuitAndInstall: async () => {
      await Promise.resolve();
      assert.equal(installing, false);
      order.push("hook");
    },
    onReadyToInstall: () => {
      installing = true;
      order.push("flag");
    },
  });
  try {
    await updater.quitAndInstall();
    assert.deepEqual(order, ["hook", "stop-server", "flag", "install"]);
    assert.equal(installing, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("quitAndInstall still stops the server and installs when the hook throws", async () => {
  const order = [];
  let installing = false;
  const { updater, dir } = quitUpdaterFixture({
    order,
    onBeforeQuitAndInstall: async () => {
      assert.equal(installing, false);
      order.push("hook");
      throw new Error("before-quit hook failed");
    },
    onReadyToInstall: () => {
      installing = true;
      order.push("flag");
    },
  });
  try {
    await updater.quitAndInstall();
    assert.deepEqual(order, ["hook", "stop-server", "flag", "install"]);
    assert.equal(installing, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("quitAndInstall still stops the server and installs when the hook hangs", async () => {
  assert.equal(BEFORE_QUIT_HOOK_TIMEOUT_MS, 5000);
  const order = [];
  let installing = false;
  const { updater, dir } = quitUpdaterFixture({
    order,
    beforeQuitHookTimeoutMs: 25,
    onBeforeQuitAndInstall: () =>
      new Promise(() => {
        assert.equal(installing, false);
        order.push("hook-start");
      }),
    onReadyToInstall: () => {
      installing = true;
      order.push("flag");
    },
  });
  try {
    await updater.quitAndInstall();
    assert.deepEqual(order, ["hook-start", "stop-server", "flag", "install"]);
    assert.equal(installing, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("quitAndInstall runs only once while a restart is already in flight", async () => {
  const order = [];
  const releases = [];
  const dir = mkdtempSync(path.join(tmpdir(), "ytt-quit-once-"));
  writeFileSync(
    path.join(dir, "signing-identity.json"),
    JSON.stringify({ teamId: TEAM })
  );
  const updater = createUpdater({
    isPackaged: true,
    isDev: false,
    resourcesPath: dir,
    signature: developerId,
    serverManager: {
      stop() {
        order.push("stop-server");
        return new Promise((resolve) => {
          releases.push(resolve);
        });
      },
    },
    loadAutoUpdater: () => ({
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowDowngrade: true,
      allowPrerelease: false,
      forceDevUpdateConfig: true,
      on() {},
      setFeedURL() {},
      quitAndInstall() {
        order.push("install");
      },
    }),
  });
  try {
    const first = updater.quitAndInstall();
    await new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (releases.length) return resolve();
        if (Date.now() - start > 1000) return reject(new Error("stop never started"));
        setImmediate(tick);
      };
      tick();
    });
    const second = updater.quitAndInstall();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    try {
      assert.equal(releases.length, 1);
    } finally {
      for (const release of releases) release();
      await Promise.all([first, second]);
    }
    assert.deepEqual(order, ["stop-server", "install"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("quitAndInstall catch resets the flag and restarts the server", async () => {
  const order = [];
  let installing = false;
  const { updater, dir } = quitUpdaterFixture({
    order,
    quitAndInstall() {
      order.push("install");
      throw new Error("Squirrel failed");
    },
    onReadyToInstall: () => {
      installing = true;
      order.push("flag");
    },
    onInstallFailed: () => {
      installing = false;
      order.push("flag-reset");
    },
  });
  try {
    await updater.quitAndInstall();
    assert.deepEqual(order, [
      "stop-server",
      "flag",
      "install",
      "flag-reset",
      "start-server",
    ]);
    assert.equal(installing, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("background cadence is 30s then 6h", () => {
  assert.equal(INITIAL_DELAY_MS, 30_000);
  assert.equal(INTERVAL_MS, 6 * 60 * 60 * 1000);
});

test("load or settings failure disables the updater and still builds the tray", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ytt-load-fail-"));
  try {
    writeFileSync(
      path.join(dir, "signing-identity.json"),
      JSON.stringify({ teamId: TEAM })
    );
    const requireFailed = createUpdater({
      isPackaged: true,
      isDev: false,
      resourcesPath: dir,
      signature: developerId,
      loadAutoUpdater() {
        throw new Error("electron-updater missing from asar");
      },
    });
    assert.equal(requireFailed.enabled, false);
    assert.equal(requireFailed.reason, "load-failed");
    assert.equal(requireFailed.feed, null);

    const settingsFailed = createUpdater({
      isPackaged: true,
      isDev: false,
      resourcesPath: dir,
      signature: developerId,
      loadAutoUpdater() {
        return {
          on() {},
          setFeedURL() {
            throw new Error("setFeedURL refused");
          },
        };
      },
    });
    assert.equal(settingsFailed.enabled, false);
    assert.equal(settingsFailed.reason, "load-failed");

    const template = buildTrayMenuTemplate(
      {
        status: "running",
        port: 19721,
        supportsSublabel: true,
        openAtLogin: false,
        showImport: false,
        updater: {
          enabled: requireFailed.enabled,
          status: "idle",
          percent: 0,
        },
      },
      new Proxy({}, { get: () => () => {} })
    );
    const labels = template.map((item) => item.label);
    assert.equal(labels.includes("Transcriber is running"), true);
    assert.equal(labels.includes("Quit Transcriber"), true);
    const update = template.find((item) => item.label === "Check for Updates…");
    assert.ok(update);
    assert.equal(update.enabled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real AppUpdater channel setter then allowDowngrade stays false", () => {
  const { AppUpdater } = require("electron-updater");
  const stubApp = {
    version: "0.2.0-beta.1",
    name: "Transcriber",
    isPackaged: true,
    appUpdateConfigPath: path.join(tmpdir(), "no-app-update.yml"),
    userDataPath: tmpdir(),
    baseCachePath: tmpdir(),
    whenReady: async () => {},
    quit() {},
    relaunch() {},
    onQuit() {},
  };
  const real = new AppUpdater(null, stubApp);
  real.allowDowngrade = false;
  real.channel = "beta";
  assert.equal(real.channel, "beta");
  assert.equal(real.allowDowngrade, true, "channel setter must flip allowDowngrade");
  configureAutoUpdater(real);
  assert.equal(real.channel, "beta");
  assert.equal(real.allowDowngrade, false);
  assert.equal(real.autoInstallOnAppQuit, false);
  assert.equal(real.autoDownload, false);
  assert.equal(real.isUpdateSupported({ version: "0.2.1-beta.1" }), true);
  assert.equal(real.isUpdateSupported({ version: "1.0.0" }), false);
  assert.equal(isBetaPrereleaseVersion("0.2.0-beta.1"), true);
  assert.equal(isBetaPrereleaseVersion("1.0.0"), false);
});

test("codesign verify --strict runs on /usr/bin/codesign before Team ID and fails closed", () => {
  assert.equal(CODESIGN_BIN, "/usr/bin/codesign");
  const calls = [];
  const unsigned = readDarwinSignature("/tmp/Transcriber.app", (bin, args) => {
    calls.push([bin, ...args]);
    return { status: 1, stdout: "", stderr: "code object is not signed at all" };
  });
  assert.deepEqual(calls[0], [
    "/usr/bin/codesign",
    "--verify",
    "--strict",
    "/tmp/Transcriber.app",
  ]);
  assert.equal(calls.length, 1);
  assert.equal(unsigned.notSigned, true);

  const dv = [
    "Identifier=com.transcribed.app",
    `Authority=Developer ID Application: LifeSized (${TEAM})`,
    `TeamIdentifier=${TEAM}`,
  ].join("\n");
  const signed = readDarwinSignature("/Applications/Transcriber.app", (bin, args) => {
    calls.push([bin, ...args]);
    if (args[0] === "--verify") return { status: 0, stdout: "", stderr: "" };
    return { status: 0, stdout: "", stderr: dv };
  });
  assert.equal(calls[1][0], "/usr/bin/codesign");
  assert.deepEqual(calls[1].slice(1, 3), ["--verify", "--strict"]);
  assert.deepEqual(calls[2].slice(1, 3), ["-dv", "--verbose=4"]);
  assert.equal(signed.developerId, true);
  assert.equal(signed.teamId, TEAM);
});

test("async codesign verify --strict fails closed without blocking", async () => {
  const calls = [];
  const unsigned = await readDarwinSignatureAsync("/tmp/Transcriber.app", async (bin, args) => {
    calls.push([bin, ...args]);
    return { status: 1, stdout: "", stderr: "code object is not signed at all" };
  });
  assert.deepEqual(calls[0], [
    "/usr/bin/codesign",
    "--verify",
    "--strict",
    "/tmp/Transcriber.app",
  ]);
  assert.equal(unsigned.notSigned, true);
  const dv = [
    "Identifier=com.transcribed.app",
    `Authority=Developer ID Application: LifeSized (${TEAM})`,
    `TeamIdentifier=${TEAM}`,
  ].join("\n");
  const signed = await readDarwinSignatureAsync("/Applications/Transcriber.app", async (bin, args) => {
    calls.push([bin, ...args]);
    if (args[0] === "--verify") return { status: 0, stdout: "", stderr: "" };
    return { status: 0, stdout: "", stderr: dv };
  });
  assert.equal(signed.developerId, true);
  assert.equal(signed.teamId, TEAM);
});
