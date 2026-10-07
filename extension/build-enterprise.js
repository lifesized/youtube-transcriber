#!/usr/bin/env node

/**
 * Enterprise extension build script — produces ENTERPRISE distributable.
 *
 * Usage:
 *   node build-enterprise.js --base-url https://transcriber.corp.example.com
 *   ENTERPRISE_BASE_URL=https://... node build-enterprise.js
 *
 * ENTERPRISE build (YTT-447): one-tap send to org-hosted Transcriber instance.
 * No nativeMessaging, no loopback. Requires explicit base URL at build time.
 */

const fs = require("fs");
const path = require("path");
const {
  syncDirectoryPreservingRoot,
  withTemporaryBuildDirectory,
} = require("./build-output.js");

const SRC = __dirname;
const DIST = path.join(SRC, "dist-enterprise");

// Parse --base-url from command line or ENTERPRISE_BASE_URL env var
let baseUrl = process.env.ENTERPRISE_BASE_URL;
const baseUrlArg = process.argv.indexOf("--base-url");
if (baseUrlArg !== -1 && process.argv[baseUrlArg + 1]) {
  baseUrl = process.argv[baseUrlArg + 1];
}

if (!baseUrl) {
  console.error(`
ERROR: ENTERPRISE build requires an explicit org base URL.

Usage:
  node build-enterprise.js --base-url https://transcriber.corp.example.com

Or:
  ENTERPRISE_BASE_URL=https://... node build-enterprise.js

The ENTERPRISE build cannot silently default to loopback.
`);
  process.exit(1);
}

// Validate base URL
let parsedUrl;
try {
  parsedUrl = new URL(baseUrl);
} catch {
  console.error(`ERROR: Invalid base URL: ${baseUrl}`);
  process.exit(1);
}

if (parsedUrl.protocol !== "https:") {
  console.error(`ERROR: ENTERPRISE base URL must use HTTPS, got: ${parsedUrl.protocol}`);
  process.exit(1);
}

if (parsedUrl.pathname !== "/" && parsedUrl.pathname !== "") {
  console.warn(`WARNING: Base URL has path component: ${parsedUrl.pathname}`);
}

// Normalize to origin only for consistency
const enterpriseOrigin = parsedUrl.origin;
const enterpriseBaseUrl = baseUrl.replace(/\/$/, ""); // Strip trailing slash

console.log(`Building ENTERPRISE extension for: ${enterpriseBaseUrl}`);

// Files to copy as-is (NO native messaging, NO local-auth-headers)
const COPY_FILES = [
  "send-url-enterprise.js",
  "background.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

withTemporaryBuildDirectory((buildDir) => {
  // Copy enterprise manifest template and inject base URL
  const manifestTemplatePath = path.join(SRC, "manifests", "enterprise.json");
  const manifestTemplate = fs.readFileSync(manifestTemplatePath, "utf8");
  const manifest = manifestTemplate
    .replace(/\{\{ENTERPRISE_BASE_URL\}\}/g, enterpriseBaseUrl)
    .replace(/\{\{ENTERPRISE_ORIGIN\}\}/g, enterpriseOrigin);
  fs.writeFileSync(path.join(buildDir, "manifest.json"), manifest);

  // Copy files and inject base URL into send-url-enterprise.js
  for (const file of COPY_FILES) {
    const src = path.join(SRC, file);
    const dest = path.join(buildDir, file);
    
    if (!fs.existsSync(src)) {
      console.warn(`Warning: ${file} not found, skipping`);
      continue;
    }

    if (file === "send-url-enterprise.js") {
      // Inject base URL and rename to send-url.js
      let content = fs.readFileSync(src, "utf8");
      content = content.replace(/\{\{ENTERPRISE_BASE_URL\}\}/g, enterpriseBaseUrl);
      fs.writeFileSync(path.join(buildDir, "send-url.js"), content);
    } else {
      copyFile(src, dest);
    }
  }

  syncDirectoryPreservingRoot(buildDir, DIST);
});

console.log(`Built ENTERPRISE extension → ${path.relative(process.cwd(), DIST)}`);
console.log(`Target: ${enterpriseBaseUrl}`);
