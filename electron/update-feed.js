"use strict";

/**
 * Channel and macOS floor for GitHub Releases + electron-updater 6.8.9.
 *
 * GitHubProvider.channel uses getCustomChannelName(updater.channel):
 *   channel + (darwin ? "-mac" : windows "" : linux "-linux")
 * getChannelFilename then appends ".yml"
 *   node_modules/electron-updater/out/providers/Provider.js getCustomChannelName
 *   node_modules/electron-updater/out/util.js getChannelFilename
 *
 * So channel "beta" on macOS requests beta-mac.yml. allowPrerelease falls
 * back to latest-mac.yml if that 404s (GitHubProvider.getLatestVersion).
 */

const UPDATE_CHANNEL = "beta";
const FALLBACK_CHANNEL = "latest";

function channelFileName(channel, platform = "darwin") {
  const prefix =
    platform === "linux" ? "-linux" : platform === "darwin" ? "-mac" : "";
  return `${channel}${prefix}.yml`;
}

const UPDATE_CHANNEL_FILE = channelFileName(UPDATE_CHANNEL, "darwin");
const FALLBACK_CHANNEL_FILE = channelFileName(FALLBACK_CHANNEL, "darwin");

function isBetaPrereleaseVersion(version) {
  const pre = String(version || "").split("-")[1] || "";
  return pre === "beta" || pre.startsWith("beta.");
}

function renderUpdateYml({ version, zipName, sha512, size, releaseDate }) {
  return [
    `version: ${version}`,
    "files:",
    `  - url: ${zipName}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${zipName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    "",
  ].join("\n");
}

module.exports = {
  UPDATE_CHANNEL,
  FALLBACK_CHANNEL,
  UPDATE_CHANNEL_FILE,
  FALLBACK_CHANNEL_FILE,
  channelFileName,
  isBetaPrereleaseVersion,
  renderUpdateYml,
};
