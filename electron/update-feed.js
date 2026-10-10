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

function parseOsVersion(value) {
  const m = String(value || "").trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2] || 0),
    patch: Number(m[3] || 0),
  };
}

function toSemver(parsed) {
  if (!parsed) return null;
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

/** Darwin 22 → macOS 13. Darwin majors below 9 cannot use this mapping. */
function darwinReleaseToMacos(darwinRelease) {
  const parsed = parseOsVersion(darwinRelease);
  if (!parsed || parsed.major < 9) return null;
  return toSemver({
    major: parsed.major - 9,
    minor: parsed.minor,
    patch: parsed.patch,
  });
}

function currentMarketingOsVersion(processLike = process, osRelease) {
  if (processLike && typeof processLike.getSystemVersion === "function") {
    const marketing = String(processLike.getSystemVersion() || "").trim();
    if (parseOsVersion(marketing)) return marketing;
  }
  const release =
    osRelease !== undefined ? osRelease : require("os").release();
  return darwinReleaseToMacos(release);
}

function isOsNewEnough(currentOsVersion, minimumSystemVersion) {
  if (!minimumSystemVersion) return true;
  const current = parseOsVersion(currentOsVersion);
  const minimum = parseOsVersion(minimumSystemVersion);
  if (!current || !minimum) return false;
  try {
    const semver = require("semver");
    return !semver.lt(toSemver(current), toSemver(minimum));
  } catch {
    return false;
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
  parseOsVersion,
  darwinReleaseToMacos,
  currentMarketingOsVersion,
  isOsNewEnough,
  isUpdateSupported,
  renderUpdateYml,
};
