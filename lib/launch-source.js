"use strict";

/**
 * Why the menu-bar app launched. The native host adds this argument to
 * `open -a … --args` so the app can tell a start the extension asked for
 * from one the user made. macOS only delivers it to a fresh launch.
 */
const NATIVE_HOST_LAUNCH_ARG = "--launched-by=native-host";

function launchedByNativeHost(argv) {
  return Array.isArray(argv) && argv.includes(NATIVE_HOST_LAUNCH_ARG);
}

/**
 * The launch tray pop and its notification are for a person who just opened
 * Transcriber. Start at Login and browser-triggered starts stay quiet. The
 * install helper opens the app with a plain `open`, so the first launch after
 * an install or update counts as manual and still pops.
 */
function shouldRevealOnLaunch({ openedAtLogin, argv }) {
  return !openedAtLogin && !launchedByNativeHost(argv);
}

module.exports = { NATIVE_HOST_LAUNCH_ARG, launchedByNativeHost, shouldRevealOnLaunch };
