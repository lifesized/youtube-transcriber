#!/usr/bin/env node

/**
 * Extension build script — produces a distributable extension package.
 *
 * Usage:
 *   node build.js          → dist/        (Store build)
 *   node build.js --dev    → dist/        (dev build: renamed so toolbar shows it's the local one)
 *
 * The extension handles local/cloud mode switching at runtime via settings,
 * so there is no need for separate build variants for that. --dev only changes
 * naming so dev and Store installs are visually distinguishable side-by-side.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const IS_DEV = process.argv.includes("--dev");
const SRC = __dirname;
const DIST = path.join(SRC, "dist");
const DEV_KEY_PATH = path.join(SRC, "dev-key.pem");

// Files to copy as-is (relative to extension/)
const COPY_FILES = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "destination-connected.html",
  "destination-connected.js",
  "setup-link.css",
  "content.js",
  "content-spotify.js",
  "content-substack.js",
  "content-app-presence.js",
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

// --- Dev tagging: rename + pin key so dev build has stable, distinguishable ID ---

if (IS_DEV) {
  const manifestPath = path.join(DIST, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.name = `${manifest.name} (dev)`;
  manifest.short_name = "Transcriber dev";

  // Inject "key" field from local keypair so unpacked dev ext gets a stable ID.
  // Without this, Chrome derives the ID from the install path — meaning every
  // path change (e.g. loading dist/ vs extension/) produces a new ID and breaks
  // the native messaging whitelist. dev-key.pem is gitignored and machine-local:
  // each contributor gets their own keypair (and thus their own stable dev ID).
  if (!fs.existsSync(DEV_KEY_PATH)) {
    console.log(`No dev keypair found — generating ${path.relative(process.cwd(), DEV_KEY_PATH)}`);
    const pem = execFileSync("openssl", ["genrsa", "2048"], { stdio: ["ignore", "pipe", "ignore"] });
    const pkcs8 = execFileSync(
      "openssl",
      ["pkcs8", "-topk8", "-nocrypt", "-out", DEV_KEY_PATH],
      { input: pem, stdio: ["pipe", "ignore", "ignore"] }
    );
    void pkcs8;
    fs.chmodSync(DEV_KEY_PATH, 0o600);
  }
  const pubKeyDer = execFileSync("openssl", [
    "rsa",
    "-in", DEV_KEY_PATH,
    "-pubout",
    "-outform", "DER",
  ], { stdio: ["ignore", "pipe", "ignore"] });
  manifest.key = pubKeyDer.toString("base64");

  // Derive + log the resulting Chrome ext ID so contributors know what to
  // whitelist when running `npm run install-native-host`.
  const crypto = require("crypto");
  const idHash = crypto.createHash("sha256").update(pubKeyDer).digest("hex").slice(0, 32);
  const stableId = idHash.replace(/[0-9a-f]/g, (c) => "abcdefghijklmnop"["0123456789abcdef".indexOf(c)]);
  console.log(`Stable dev extension ID: ${stableId}`);

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

console.log(`Built ${IS_DEV ? "dev " : ""}extension → ${path.relative(process.cwd(), DIST)}`);
