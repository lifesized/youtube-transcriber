import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(root, ".github", "workflows", "electron-build-macos.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");

const UNSIGNED_STEPS = [
  "Checkout code",
  "Setup Node.js",
  "Install dependencies",
  "Unit tests (packaging + migrations)",
  "Transcript cache integration test",
  "LLM summarize tests",
  "Notion save tests",
  "LinkedIn capture tests",
  "Home page library gate tests",
  "Local API cookie auth (middleware) tests",
  "Build Next.js",
  "Download ffmpeg (arm64 static)",
  "Download yt-dlp",
  "Build Electron app",
  "Assert DMG contains Install Transcriber.command",
  "Upload DMG window screenshot",
  "Assert asar contains every main-process require",
  "Assert no outbound app symlinks and Electron-ABI sqlite",
  "Launch packaged Transcriber.app",
  "Test packaged app (smoke test)",
  "Packaged app creates and heals every schema table",
  "Capture tray menu screenshot",
  "Capture Settings › Library rows",
  "Upload Design screenshots",
  "Report packaged size",
  "DMG sha256",
  "Upload DMG artifact",
  "Upload build info",
  "Upload build info artifact",
];

function stepNames(yaml) {
  return [...yaml.matchAll(/^\s+- name: (.+)$/gm)].map((m) => m[1]);
}

test("unsigned path step names stay in today's order before any signing step", () => {
  const names = stepNames(workflow);
  const start = names.indexOf(UNSIGNED_STEPS[0]);
  assert.ok(start >= 0, "Checkout code");
  const slice = names.slice(start, start + UNSIGNED_STEPS.length);
  assert.deepEqual(slice, UNSIGNED_STEPS);
  const detect = names.indexOf("Detect signing secrets");
  assert.ok(detect > names.indexOf("Upload build info artifact"));
});

test("unsigned artifact name and glob are unchanged", () => {
  assert.match(
    workflow,
    /name: Transcriber-macOS-arm64\n\s+path: dist-electron\/\*\.dmg/
  );
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: false/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(pkg.scripts["electron:build"], /electron-builder[^&]*&& bash electron\/dmg\/finalize-dmg\.sh$/);
});

test("signing and notarization are gated on the exact secret names", () => {
  for (const name of [
    "MACOS_CERT_P12_BASE64",
    "MACOS_CERT_PASSWORD",
    "APPLE_TEAM_ID",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER_ID",
    "APPLE_API_KEY_P8_BASE64",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
  ]) {
    assert.ok(workflow.includes(`secrets.${name}`), name);
  }
  assert.match(workflow, /steps\.signing\.outputs\.sign == 'true'/);
  assert.match(workflow, /macos-signing-keychain\.sh setup/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /macos-signing-keychain\.sh teardown/);
  assert.match(workflow, /macos-codesign-app\.sh/);
  assert.match(workflow, /macos-notarize\.sh app/);
  assert.match(workflow, /macos-notarize\.sh dmg/);
  assert.match(workflow, /build-signed-dmg\.sh/);
  assert.match(workflow, /macos-update-artifacts\.sh/);
  assert.match(workflow, /run-actionlint\.sh/);
  const actionlint = fs.readFileSync(path.join(root, "scripts", "run-actionlint.sh"), "utf8");
  assert.match(actionlint, /EXPECTED_SHA256=/);
  assert.doesNotMatch(actionlint, /download failed; skip/);
});

test("release job is tag or dispatch only, contents write, no PAT", () => {
  assert.match(workflow, /tags:\n\s+- ["']beta-v\*["']/);
  assert.match(workflow, /publish_github_release/);
  const release = workflow.slice(workflow.indexOf("name: Publish GitHub prerelease"));
  assert.match(release, /permissions:\s*\n\s+contents: write/);
  assert.match(release, /github\.token|GITHUB_TOKEN/);
  assert.doesNotMatch(release, /secrets\.[A-Z0-9_]*TOKEN/);
  assert.doesNotMatch(release, /PAT/);
  assert.match(release, /--prerelease/);
  assert.match(release, /latest-mac\.yml/);
  assert.match(release, /SHA256SUMS/);
});

test("signed entitlements are the minimum JIT pair and omit library validation", () => {
  const plist = fs.readFileSync(
    path.join(root, "electron", "entitlements.mac.sign.plist"),
    "utf8"
  );
  assert.match(plist, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(plist, /com\.apple\.security\.cs\.allow-unsigned-executable-memory/);
  assert.match(plist, /TODO\(signed-run\): try allow-jit alone/);
  assert.doesNotMatch(plist, /disable-library-validation/);
  assert.doesNotMatch(plist, /network\.(client|server)/);
});

test("signing scripts never echo secrets and write decoded files under RUNNER_TEMP mode 600", () => {
  const files = [
    "scripts/macos-signing-keychain.sh",
    "scripts/macos-codesign-app.sh",
    "scripts/macos-codesign-dmg.sh",
    "scripts/macos-notarize.sh",
    "scripts/macos-update-artifacts.sh",
  ].map((rel) => fs.readFileSync(path.join(root, rel), "utf8"));
  for (const text of files) {
    assert.doesNotMatch(text, /echo ["']?\$\{?MACOS_CERT/);
    assert.doesNotMatch(text, /echo ["']?\$\{?APPLE_API_KEY_P8/);
    assert.doesNotMatch(text, /echo ["']?\$\{?APPLE_APP_SPECIFIC_PASSWORD/);
    assert.doesNotMatch(text, /echo ["']?\$\{?APPLE_ID/);
    assert.doesNotMatch(text, /set -x/);
  }
  const keychain = files[0];
  assert.match(keychain, /RUNNER_TEMP/);
  assert.match(keychain, /chmod 600/);
  assert.match(keychain, /-T \/usr\/bin\/codesign/);
  assert.match(keychain, /set-key-partition-list/);
  assert.doesNotMatch(keychain, /security import[\s\S]*\s-A\s/);
  assert.match(keychain, /openssl rand/);
  assert.match(keychain, /Developer ID Application/);
  const sign = files[1];
  assert.match(sign, /--options runtime --timestamp/);
  assert.match(sign, /entitlements\.mac\.sign\.plist/);
  assert.match(sign, /signing-identity\.json/);
  const notary = files[3];
  assert.match(notary, /notarytool submit/);
  assert.match(notary, /"\$status" != "Accepted"/);
  assert.match(notary, /notarytool log/);
  assert.match(notary, /APPLE_API_KEY_P8_BASE64/);
  assert.match(notary, /APPLE_APP_SPECIFIC_PASSWORD/);
  assert.match(notary, /ditto -c -k --keepParent/);
  assert.match(notary, /stapler staple/);
  assert.match(notary, /spctl -a -vvv -t exec/);
  assert.match(notary, /context:primary-signature/);
});

test("signed DMG is drag-to-Applications and does not reuse the helper payload", () => {
  const script = fs.readFileSync(
    path.join(root, "electron", "dmg", "build-signed-dmg.sh"),
    "utf8"
  );
  assert.match(script, /ln -s \/Applications/);
  assert.match(script, /background-signed\.png/);
  assert.match(script, /helper must not be on the signed DMG/);
  assert.match(script, /\.payload must not be on the signed DMG/);
  assert.ok(fs.existsSync(path.join(root, "electron", "dmg", "background-signed.png")));
  assert.ok(fs.existsSync(path.join(root, "electron", "dmg", "background-signed@2x.png")));
  const buf = fs.readFileSync(path.join(root, "electron", "dmg", "background-signed.png"));
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(buf.readUInt32BE(16), 660);
  assert.equal(buf.readUInt32BE(20), 420);
});

test("main wires the updater gate and stops Next before quitAndInstall", () => {
  const main = fs.readFileSync(path.join(root, "electron", "main.js"), "utf8");
  assert.ok(main.includes('require("./updater.js")'));
  assert.ok(main.includes("createUpdater"));
  assert.ok(main.includes("installingUpdate"));
  assert.ok(main.includes("listExtensionIds"));
  assert.ok(main.includes("shouldRepointNativeHost"));
  assert.ok(main.includes("readRecordedBundlePath"));
  assert.doesNotMatch(main, /require\(["']electron-updater["']\)/);
  const updater = fs.readFileSync(path.join(root, "electron", "updater.js"), "utf8");
  assert.doesNotMatch(updater, /require\(["']electron-updater["']\)/);
  const afterPack = fs.readFileSync(path.join(root, "electron", "after-pack.js"), "utf8");
  assert.ok(afterPack.includes("copyUpdaterModules"));
  assert.ok(afterPack.includes("electron-updater"));
});

test("docs list every secret and the GitHub update call", () => {
  const docs = fs.readFileSync(path.join(root, "docs", "signing-and-updates.md"), "utf8");
  for (const name of [
    "MACOS_CERT_P12_BASE64",
    "MACOS_CERT_PASSWORD",
    "APPLE_TEAM_ID",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER_ID",
    "APPLE_API_KEY_P8_BASE64",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
  ]) {
    assert.ok(docs.includes(name), name);
  }
  assert.ok(docs.includes("Settings › Secrets and variables › Actions"));
  const privacy = fs.readFileSync(path.join(root, "extension", "privacy-policy.md"), "utf8");
  assert.ok(privacy.includes("19721"));
  assert.ok(privacy.includes("lifesized/youtube-transcriber"));
});
