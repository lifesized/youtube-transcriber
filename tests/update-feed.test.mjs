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
  channelFileName,
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
  const body = renderUpdateYml({
    version: "0.2.0-beta.1",
    zipName: "Transcriber-0.2.0-beta.1-arm64-mac.zip",
    sha512: "abc",
    size: 1,
    releaseDate: "2026-10-09T00:00:00.000Z",
  });
  assert.match(body, /^version: 0\.2\.0-beta\.1/m);
});
