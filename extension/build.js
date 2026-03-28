#!/usr/bin/env node

/**
 * Extension build script — produces local or cloud variants.
 *
 * Usage:
 *   node build.js local    → dist/local/  (bundled HTML, localhost API)
 *   node build.js cloud    → dist/cloud/  (iframe shell, transcribed.dev API)
 */

const fs = require("fs");
const path = require("path");

const mode = process.argv[2];
if (!["local", "cloud"].includes(mode)) {
  console.error("Usage: node build.js <local|cloud>");
  process.exit(1);
}

const SRC = __dirname;
const DIST = path.join(SRC, "dist", mode);

const CONFIG = {
  local: {
    apiBase: "http://localhost:19720",
    popupFile: "popup.html",
    extraHostPermissions: [],
  },
  cloud: {
    apiBase: "https://transcribed.dev",
    popupFile: "popup-shell.html",
    extraHostPermissions: ["https://transcribed.dev/*"],
  },
};

const config = CONFIG[mode];

// Files to copy as-is (relative to extension/)
const COPY_FILES = [
  "content.js",
  "content-spotify.js",
  "popup.css",
  "setup-link.css",
  "github-footer.css",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

// --- Helpers ---

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

// --- Clean & create dist ---

fs.rmSync(DIST, { recursive: true, force: true });
ensureDir(DIST);

// --- Manifest ---

const manifest = JSON.parse(
  fs.readFileSync(path.join(SRC, "manifest.json"), "utf8")
);

// Add cloud host permission if needed
if (config.extraHostPermissions.length) {
  manifest.host_permissions.push(...config.extraHostPermissions);
}

// Point side panel to the correct popup file
manifest.side_panel.default_path = "popup.html"; // always named popup.html in dist

fs.writeFileSync(
  path.join(DIST, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);

// --- Background.js — replace API_BASE ---

let bgSource = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
bgSource = bgSource.replace(
  /const API_BASE = "[^"]+"/,
  `const API_BASE = "${config.apiBase}"`
);
fs.writeFileSync(path.join(DIST, "background.js"), bgSource);

// --- Popup HTML ---

const popupSrc = path.join(SRC, config.popupFile);
if (!fs.existsSync(popupSrc)) {
  console.error(`Missing popup file: ${config.popupFile}`);
  process.exit(1);
}
// Always output as popup.html in dist
fs.copyFileSync(popupSrc, path.join(DIST, "popup.html"));

// --- Popup.js — replace API_APP_BASE (only for local, cloud uses shell) ---

if (mode === "local") {
  let popupJs = fs.readFileSync(path.join(SRC, "popup.js"), "utf8");
  popupJs = popupJs.replace(
    /const API_APP_BASE = "[^"]+"/,
    `const API_APP_BASE = "${config.apiBase}"`
  );
  fs.writeFileSync(path.join(DIST, "popup.js"), popupJs);
} else {
  // Cloud shell doesn't use popup.js but we still copy it for the shell's
  // fallback behavior (if it ever needs local-like features)
  copyFile(path.join(SRC, "popup.js"), path.join(DIST, "popup.js"));
}

// --- Copy static files ---

for (const file of COPY_FILES) {
  copyFile(path.join(SRC, file), path.join(DIST, file));
}

console.log(`Built ${mode} extension → ${path.relative(process.cwd(), DIST)}`);
