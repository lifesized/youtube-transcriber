/**
 * LOCAL extension build packages the LinkedIn files, and the LinkedIn host
 * access stays limited to www.linkedin.com content scripts.
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dist = path.join(projectRoot, "extension", "dist");
const LINKEDIN_FILES = ["linkedin-url.js", "linkedin-capture.js", "content-linkedin.js"];

let manifest;
const read = (file) => fs.readFileSync(path.join(dist, file), "utf8");

before(() => {
  execFileSync(process.execPath, [path.join(projectRoot, "extension", "build.js")], { stdio: "pipe" });
  manifest = JSON.parse(read("manifest.json"));
});

test("LOCAL build copies the LinkedIn files", () => {
  for (const file of LINKEDIN_FILES) {
    assert.ok(fs.existsSync(path.join(dist, file)), `${file} missing from extension/dist`);
  }
});

test("every script the manifest, service worker and panel load is in the build", () => {
  const scripts = [manifest.background.service_worker];
  for (const entry of manifest.content_scripts) scripts.push(...entry.js);
  for (const call of read("background.js").matchAll(/importScripts\(([^)]*)\)/g)) {
    scripts.push(...[...call[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]));
  }
  for (const tag of read("popup.html").matchAll(/<script[^>]*src="([^"]+)"/g)) scripts.push(tag[1]);
  for (const file of LINKEDIN_FILES) assert.ok(scripts.includes(file), `${file} is never loaded`);
  for (const file of scripts) {
    assert.ok(fs.existsSync(path.join(dist, file)), `${file} is referenced but not packaged`);
  }
});

test("LinkedIn access is www.linkedin.com only, isolated world, and no extension-page fetches", () => {
  assert.deepEqual(manifest.host_permissions, [
    "http://127.0.0.1:19721/*",
    "http://127.0.0.1:19720/*",
    "https://www.linkedin.com/*",
  ]);
  const linkedIn = manifest.content_scripts.filter((entry) =>
    entry.matches.some((match) => match.includes("linkedin"))
  );
  assert.deepEqual(linkedIn, [
    {
      matches: ["https://www.linkedin.com/*"],
      js: ["linkedin-url.js", "content-linkedin.js"],
      run_at: "document_start",
    },
  ]);
  const connectSrc = manifest.content_security_policy.extension_pages.match(/connect-src([^;]*)/)[1];
  assert.equal(connectSrc.trim(), "'self' http://127.0.0.1:19721 http://127.0.0.1:19720");
});

const MAIN_WORLD = /\bworld["']?\s*:\s*["']MAIN["']/;

test("LinkedIn scripts make no network requests, store nothing, and don't touch page storage, HTML or eval", () => {
  const forbidden = [
    /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|chrome\.storage|cookies/,
    /document\.cookie/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bindexedDB\b/,
    /\binnerHTML\b/,
    /\beval\b/,
    MAIN_WORLD,
  ];
  for (const file of LINKEDIN_FILES) {
    const source = read(file);
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${file}: ${pattern}`);
  }
});

test("store justification and privacy policy describe LinkedIn capture as shipped", () => {
  const doc = (name) => fs.readFileSync(path.join(projectRoot, "extension", name), "utf8");
  const justification = doc("store-permission-justifications.md")
    .split("### `https://www.linkedin.com/*`")[1]
    .split("\n## ")[0];
  assert.ok(
    justification.includes(
      "observes LinkedIn video URLs the tab loads, in memory only, and sends one only when you press Transcribe."
    )
  );

  const policy = doc("privacy-policy.md");
  const permissions = policy.split("\n## Permissions")[1].split("\n### ")[0];
  for (const host of manifest.host_permissions) assert.ok(permissions.includes(host), host);
  assert.match(policy, /fetches the public post page itself/);
});

test("LinkedIn stays isolated; only the YouTube timedtext helper is MAIN-world", () => {
  const linkedIn = manifest.content_scripts.filter((entry) =>
    entry.matches.some((match) => match.includes("linkedin"))
  );
  for (const entry of linkedIn) {
    assert.ok(!("world" in entry) || entry.world === "ISOLATED", `${entry.js.join(", ")} world=${entry.world}`);
  }
  const mainEntries = manifest.content_scripts.filter((entry) => entry.world === "MAIN");
  assert.deepEqual(
    mainEntries.map((entry) => entry.js),
    [["content-captions-main.js"]]
  );
  for (const file of LINKEDIN_FILES) {
    assert.doesNotMatch(read(file), MAIN_WORLD, file);
  }
});
