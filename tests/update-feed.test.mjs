import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  UPDATE_CHANNEL,
  UPDATE_CHANNEL_FILE,
  FALLBACK_CHANNEL_FILE,
  MINIMUM_MACOS_VERSION,
  channelFileName,
  isOsNewEnough,
  isUpdateSupported,
  renderUpdateYml,
} = require(path.join(root, "electron", "update-feed.js"));
const { getChannelFilename } = require("electron-updater/out/util.js");

test("generated yml name matches electron-updater 6.8.9 channel=beta on darwin", () => {
  assert.equal(UPDATE_CHANNEL, "beta");
  // GitHubProvider.channel → getCustomChannelName("beta") → "beta-mac"
  // getChannelFilename("beta-mac") → "beta-mac.yml"
  assert.equal(getChannelFilename("beta-mac"), "beta-mac.yml");
  assert.equal(channelFileName(UPDATE_CHANNEL, "darwin"), getChannelFilename("beta-mac"));
  assert.equal(UPDATE_CHANNEL_FILE, "beta-mac.yml");
  assert.equal(FALLBACK_CHANNEL_FILE, getChannelFilename("latest-mac"));
  assert.equal(FALLBACK_CHANNEL_FILE, "latest-mac.yml");
});

test("update artifacts script publishes the channel file the app requests", () => {
  const script = fs.readFileSync(
    path.join(root, "scripts", "macos-update-artifacts.sh"),
    "utf8"
  );
  assert.match(script, /electron\/update-feed\.js/);
  assert.match(script, /UPDATE_CHANNEL_FILE/);
  assert.match(script, /FALLBACK_CHANNEL_FILE/);
  const { configureAutoUpdater } = require(path.join(root, "electron", "updater.js"));
  const fake = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    allowPrerelease: false,
    forceDevUpdateConfig: true,
    on() {},
    setFeedURL() {},
  };
  configureAutoUpdater(fake);
  assert.equal(fake.channel, UPDATE_CHANNEL);
  assert.equal(typeof fake.isUpdateSupported, "function");
  assert.equal(
    fake.isUpdateSupported({
      version: "0.2.0-beta.2",
      minimumSystemVersion: "13.0.0",
    }),
    isUpdateSupported(
      { version: "0.2.0-beta.2", minimumSystemVersion: "13.0.0" },
      require("os").release()
    )
  );
  const body = renderUpdateYml({
    version: "0.2.0-beta.1",
    zipName: "Transcriber-0.2.0-beta.1-arm64-mac.zip",
    sha512: "abc",
    size: 1,
    releaseDate: "2026-10-09T00:00:00.000Z",
  });
  assert.match(body, /^version: 0\.2\.0-beta\.1/m);
  assert.match(body, /^minimumSystemVersion: 13\.0\.0$/m);
  assert.equal(MINIMUM_MACOS_VERSION, "13.0.0");
});

test("isUpdateSupported restores electron-updater's minimumSystemVersion check", () => {
  // Stock AppUpdater.checkIfUpdateSupported (electron-updater 6.8.9):
  //   if (minimumSystemVersion && semver.lt(os.release(), minimumSystemVersion)) return false
  //   compare errors fail open. Our override also requires a beta prerelease.
  assert.equal(
    isUpdateSupported({ version: "1.0.0", minimumSystemVersion: "13.0.0" }, "22.0.0"),
    false
  );
  assert.equal(
    isUpdateSupported({ version: "0.2.0-beta.2" }, "12.0.0"),
    true,
    "no minimumSystemVersion → stock check returns true"
  );
  assert.equal(
    isUpdateSupported(
      { version: "0.2.0-beta.2", minimumSystemVersion: "13.0.0" },
      "12.0.0"
    ),
    false
  );
  assert.equal(
    isUpdateSupported(
      { version: "0.2.0-beta.2", minimumSystemVersion: "13.0.0" },
      "13.0.0"
    ),
    true
  );
  assert.equal(
    isUpdateSupported(
      { version: "0.2.0-beta.2", minimumSystemVersion: "13.0.0" },
      "22.1.0"
    ),
    true
  );
  assert.equal(isOsNewEnough("12.0.0", "13.0.0"), false);
  assert.equal(isOsNewEnough("13.0.0", "13.0.0"), true);
  assert.equal(isOsNewEnough("22.0.0", undefined), true);
  assert.equal(isOsNewEnough("not-semver", "13.0.0"), true, "compare error fail-open");
});

test("electron-builder pins LSMinimumSystemVersion to Electron 44's floor", () => {
  const builder = JSON.parse(
    fs.readFileSync(path.join(root, "electron-builder.json"), "utf8")
  );
  assert.equal(builder.mac.minimumSystemVersion, MINIMUM_MACOS_VERSION);
  assert.equal(builder.mac.minimumSystemVersion, "13.0.0");
});
