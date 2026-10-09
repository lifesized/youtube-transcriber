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

// Electron 44 dropped macOS 12: "macOS 13 (Ventura) or later will be required
// to run Electron v44.0.0 and higher."
// https://github.com/electron/electron/releases/tag/v44.0.0 (#51967)
const MINIMUM_MACOS_VERSION = "13.0.0";

function isBetaPrereleaseVersion(version) {
  const pre = String(version || "").split("-")[1] || "";
  return pre === "beta" || pre.startsWith("beta.");
}

function isOsNewEnough(currentOsVersion, minimumSystemVersion) {
  if (!minimumSystemVersion) return true;
  try {
    const semver = require("semver");
    return !semver.lt(String(currentOsVersion), String(minimumSystemVersion));
  } catch {
    return true;
  }
}

function isUpdateSupported(updateInfo, currentOsVersion) {
  if (!isBetaPrereleaseVersion(updateInfo && updateInfo.version)) return false;
  return isOsNewEnough(currentOsVersion, updateInfo && updateInfo.minimumSystemVersion);
}

function renderUpdateYml({
  version,
  zipName,
  sha512,
  size,
  releaseDate,
  minimumSystemVersion = MINIMUM_MACOS_VERSION,
}) {
  return [
    `version: ${version}`,
    "files:",
    `  - url: ${zipName}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${zipName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    `minimumSystemVersion: ${minimumSystemVersion}`,
    "",
  ].join("\n");
}

module.exports = {
  UPDATE_CHANNEL,
  FALLBACK_CHANNEL,
  UPDATE_CHANNEL_FILE,
  FALLBACK_CHANNEL_FILE,
  MINIMUM_MACOS_VERSION,
  channelFileName,
  isBetaPrereleaseVersion,
  isOsNewEnough,
  isUpdateSupported,
  renderUpdateYml,
};
