#!/usr/bin/env node

/**
 * Extension build script — produces a distributable extension package.
 *
 * Usage:
 *   node build.js    → dist/
 *
 * The extension handles local/cloud mode switching at runtime via settings,
 * so there is no need for separate build variants.
 */

const fs = require("fs");
const path = require("path");

const SRC = __dirname;
const DIST = path.join(SRC, "dist");

// Files to copy as-is (relative to extension/)
const COPY_FILES = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "popup-shell.html",
  "popup-shell.js",
  "destination-connected.html",
  "destination-connected.js",
  "setup-link.css",
  "content.js",
  "content-spotify.js",
  "content-llm-handoff.js",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "icons/notion.svg",
  "icons/obsidian.svg",
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

// --- Copy all source files ---

for (const file of COPY_FILES) {
  const src = path.join(SRC, file);
  if (!fs.existsSync(src)) {
    console.warn(`Warning: ${file} not found, skipping`);
    continue;
  }
  copyFile(src, path.join(DIST, file));
}

console.log(`Built extension → ${path.relative(process.cwd(), DIST)}`);
