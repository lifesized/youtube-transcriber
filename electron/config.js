"use strict";

/**
 * Packaged Transcriber app config.
 *
 * `port` is the one value to change to switch this beta/testing build
 * back to the documented production default (19720). `npm run dev` stays
 * on 19720 regardless. The app host name and state dir stay separate so
 * the packaged app can run beside a checkout.
 */

const os = require("os");
const path = require("path");

const port = 19721;
const nativeHostName = "com.transcribed.app.host";
const checkoutNativeHostName = "com.transcribed.host";
const stateDirName = "Transcriber App";
const checkoutStateDirName = "Transcriber";

function resolveAppStateDir(home = os.homedir(), platform = process.platform) {
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", stateDirName);
  }
  if (platform === "win32") {
    return path.join(process.env.APPDATA || home, stateDirName);
  }
  return path.join(
    process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
    "transcriber-app"
  );
}

function resolveCheckoutStateDir(home = os.homedir(), platform = process.platform) {
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", checkoutStateDirName);
  }
  if (platform === "win32") {
    return path.join(process.env.APPDATA || home, checkoutStateDirName);
  }
  return path.join(
    process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
    "transcriber"
  );
}

function resolveAppLogDir(home = os.homedir(), platform = process.platform) {
  if (platform === "darwin") {
    return path.join(home, "Library", "Logs", stateDirName);
  }
  return path.join(resolveAppStateDir(home, platform), "logs");
}

function resolveCheckoutLogDir(home = os.homedir(), platform = process.platform) {
  if (platform === "darwin") {
    return path.join(home, "Library", "Logs", checkoutStateDirName);
  }
  return resolveCheckoutStateDir(home, platform);
}

function crashDumpsDir(stateDir) {
  return path.join(stateDir, "Crashpad");
}

function appStatePaths(home = os.homedir(), platform = process.platform) {
  const stateDir = resolveAppStateDir(home, platform);
  const logDir = resolveAppLogDir(home, platform);
  return {
    stateDir,
    userData: stateDir,
    logDir,
    crashDumps: crashDumpsDir(stateDir),
    token: path.join(stateDir, "local-api.token"),
    extensionIds: path.join(stateDir, "extension-ids.json"),
    nativeHostState: path.join(stateDir, "native-host-state.json"),
    nativeHostJson: path.join(stateDir, "native-host.json"),
    db: path.join(stateDir, "transcriber.db"),
    backups: path.join(stateDir, "backups"),
    secrets: path.join(stateDir, "electron-secrets.json"),
    wrapper: path.join(stateDir, "transcriber-app-host.sh"),
    nativeHostLog: path.join(logDir, "native-host.log"),
    nmhManifestFileName: `${nativeHostName}.json`,
  };
}

function checkoutStatePaths(home = os.homedir(), platform = process.platform) {
  const stateDir = resolveCheckoutStateDir(home, platform);
  const logDir = resolveCheckoutLogDir(home, platform);
  return {
    stateDir,
    logDir,
    token: path.join(stateDir, "local-api.token"),
    extensionIds: path.join(stateDir, "extension-ids.json"),
    nativeHostState: path.join(stateDir, "native-host-state.json"),
    nativeHostJson: path.join(stateDir, "native-host.json"),
    db: path.join(stateDir, "transcriber.db"),
    backups: path.join(stateDir, "backups"),
    wrapper: path.join(stateDir, "transcriber-host.sh"),
    nativeHostLog: path.join(logDir, "native-host.log"),
    nmhManifestFileName: `${checkoutNativeHostName}.json`,
  };
}

module.exports = {
  port,
  nativeHostName,
  checkoutNativeHostName,
  stateDirName,
  checkoutStateDirName,
  resolveAppStateDir,
  resolveCheckoutStateDir,
  resolveAppLogDir,
  resolveCheckoutLogDir,
  crashDumpsDir,
  appStatePaths,
  checkoutStatePaths,
};
