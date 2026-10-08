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
const stateDirName = "Transcriber App";

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

module.exports = {
  port,
  nativeHostName,
  stateDirName,
  resolveAppStateDir,
};
