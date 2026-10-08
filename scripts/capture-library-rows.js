"use strict";

/**
 * Renders the extension's panel header and Settings › Library rows with the
 * real popup.html/popup.js and saves one PNG per state, for Design review.
 *
 *   npx electron scripts/capture-library-rows.js <out-dir>
 *
 * The chrome.* API is stubbed by capture-library-rows-preload.js.
 */

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const POPUP = path.join(__dirname, "..", "extension", "popup.html");
const PRELOAD = path.join(__dirname, "capture-library-rows-preload.js");
const WIDTH = 360;

const RUNNING = { status: "running", reason: null };
const STOPPED = { status: "stopped", reason: "unreachable" };

const SCENARIOS = {
  "app-running": { target: "app", app: RUNNING, dev: STOPPED },
  "app-starting": { target: "app", app: STOPPED, dev: STOPPED, click: "#connectStart" },
  "app-stopped": { target: "app", app: STOPPED, dev: RUNNING },
  "app-needs-permission": {
    target: "app",
    app: { status: "needs_permission", reason: "extension_not_allowed" },
    dev: STOPPED,
  },
  "app-helper-outdated": {
    target: "app",
    app: { status: "helper_outdated", reason: "unknown_cmd" },
    dev: STOPPED,
  },
  "dev-stopped": { target: "dev", app: RUNNING, dev: STOPPED },
  "dev-needs-permission": {
    target: "dev",
    app: RUNNING,
    dev: { status: "needs_permission", reason: "extension_not_allowed" },
  },
  "dev-not-accepted": {
    target: "dev",
    app: RUNNING,
    dev: { status: "needs_permission", reason: "unauthorized" },
  },
  "dev-helper-outdated": {
    target: "dev",
    app: RUNNING,
    dev: { status: "helper_outdated", reason: "unknown_cmd" },
  },
  "dev-project-root": {
    target: "dev",
    app: RUNNING,
    dev: { status: "stopped", reason: "bad_project_root" },
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(win, expr, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(expr)) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for: ${expr}`);
}

async function capture(name, scenario, outDir) {
  const win = new BrowserWindow({
    width: WIDTH,
    height: 900,
    show: false,
    backgroundColor: "#0a0a0a",
    webPreferences: { preload: PRELOAD, contextIsolation: false, sandbox: false },
  });
  try {
    await win.loadFile(POPUP, { query: { s: JSON.stringify(scenario) } });
    await win.webContents.insertCSS(
      "*, *::before, *::after { animation: none !important; transition: none !important; } html, body { overflow: hidden !important; }"
    );
    await waitFor(win, `document.getElementById("targetPickerTrigger").hasAttribute("data-ready")`);
    // Open Settings the way a user would: click the header indicator.
    await win.webContents.executeJavaScript(`document.getElementById("targetPickerTrigger").click()`);
    const radio = scenario.target === "dev" ? "connectTargetDev" : "connectTargetApp";
    await waitFor(
      win,
      `!document.getElementById("settingsPanel").hidden &&
       document.getElementById("${radio}").checked &&
       !/Checking/.test(document.getElementById("connectTargetAppStatus").textContent)`
    );
    if (scenario.click) {
      await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(scenario.click)}).click()`);
      await sleep(300);
    }
    await win.webContents.executeJavaScript(`document.activeElement && document.activeElement.blur()`);
    await sleep(200);
    const bottom = await win.webContents.executeJavaScript(
      `Math.ceil(document.getElementById("connectTargetSection").getBoundingClientRect().bottom + 16)`
    );
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: WIDTH, height: bottom });
    const file = path.join(outDir, `library-${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    console.log(`wrote ${file}`);
  } finally {
    win.destroy();
  }
}

app.commandLine.appendSwitch("force-device-scale-factor", "2");
// Each state gets a fresh window; don't quit between them.
app.on("window-all-closed", () => {});

// Electron may put its own switches before the script path.
const scriptIndex = process.argv.findIndex((a) => path.resolve(a) === __filename);
const outDir = path.resolve(process.argv[scriptIndex + 1] || "library-rows");

app.whenReady().then(async () => {
  let failed = 0;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      try {
        await capture(name, scenario, outDir);
      } catch (err) {
        failed++;
        console.error(`library-${name}: ${err.message}`);
      }
    }
  } catch (err) {
    failed++;
    console.error(err);
  }
  app.exit(failed ? 1 : 0);
});
