import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

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
  "Frame headers tests",
  "Typecheck",
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
  const signJob = workflow.indexOf("\n  sign:");
  assert.ok(signJob > 0);
  const build = workflow.slice(0, signJob);
  assert.doesNotMatch(build, /secrets\.(MACOS_|APPLE_)/);
  assert.ok(names.indexOf("Upload unsigned app for signing") > names.indexOf("Upload build info artifact"));
});

test("unsigned artifact name and glob are unchanged", () => {
  assert.match(
    workflow,
    /name: Transcriber-macOS-arm64\n\s+path: dist-electron\/\*\.dmg/
  );
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.doesNotMatch(workflow, /upload-artifact@v4\b/);
  assert.match(
    workflow,
    /upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/
  );
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: false/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.version, "0.2.0-beta.1");
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
  assert.match(workflow, /environment: release/);
  assert.match(workflow, /vars\.SIGNING_ENABLED == 'true'/);
  assert.match(workflow, /github\.event_name != 'pull_request'/);
  const sign = workflow.slice(workflow.indexOf("\n  sign:"), workflow.indexOf("\n  unsigned-path-contract:"));
  assert.doesNotMatch(sign, /npm ci/);
  assert.match(sign, /persist-credentials: false/);
  assert.match(sign, /macos-signing-keychain\.sh setup/);
  assert.match(sign, /macos-signing-keychain\.sh unlock/);
  assert.ok(
    sign.indexOf("macos-signing-keychain.sh unlock") <
      sign.indexOf("macos-codesign-dmg.sh")
  );
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /macos-signing-keychain\.sh teardown/);
  assert.match(workflow, /macos-codesign-app\.sh/);
  assert.match(workflow, /macos-notarize\.sh app/);
  assert.match(workflow, /macos-notarize\.sh dmg/);
  assert.match(workflow, /build-signed-dmg\.sh/);
  assert.match(workflow, /macos-update-artifacts\.sh/);
  assert.match(workflow, /read-electron-fuses\.js/);
  assert.doesNotMatch(sign, /@electron\/fuses/);
  assert.doesNotMatch(sign, /app-builder-bin/);
  assert.doesNotMatch(sign, /signing-helpers/);
  assert.match(sign, /Read fuses on the signed app/);
  assert.match(sign, /Read fuses on the app inside the signed DMG/);
  assert.match(workflow, /run-actionlint\.sh/);
  const actionlint = fs.readFileSync(path.join(root, "scripts", "run-actionlint.sh"), "utf8");
  assert.match(actionlint, /EXPECTED_SHA256=/);
  assert.doesNotMatch(actionlint, /download failed; skip/);
  assert.doesNotMatch(actionlint, /-ignore 'SC2086:'/);
  assert.doesNotMatch(actionlint, /-ignore 'SC2012:'/);
});

test("release job is tag or dispatch only, contents write, no PAT", () => {
  assert.match(workflow, /tags:\n\s+- ["']v\*-beta\.\*["']/);
  assert.doesNotMatch(workflow, /beta-v\*/);
  assert.match(workflow, /publish_github_release/);
  const sign = workflow.slice(workflow.indexOf("\n  sign:"), workflow.indexOf("\n  unsigned-path-contract:"));
  const release = workflow.slice(workflow.indexOf("name: Publish GitHub prerelease"));
  for (const job of [sign, release]) {
    assert.match(job, /vars\.SIGNING_ENABLED == 'true'/);
    assert.match(job, /startsWith\(github\.ref, 'refs\/tags\/v'\) && contains\(github\.ref, '-beta\.'\)/);
    assert.match(job, /workflow_dispatch.*github\.ref == 'refs\/heads\/beta\/electron-menubar'/s);
  }
  assert.doesNotMatch(sign, /event_name == 'push' && github\.ref == 'refs\/heads\/beta/);
  assert.match(release, /environment: release/);
  assert.match(release, /persist-credentials: false/);
  assert.match(release, /merge-base --is-ancestor/);
  assert.match(release, /refs\/heads\/beta\/electron-menubar/);
  assert.match(release, /tag \$\{TAG\} does not exist\. Push it first/);
  assert.doesNotMatch(release, /http\.extraheader/);
  assert.doesNotMatch(release, /fetch origin/);
  assert.match(release, /--draft/);
  assert.match(release, /--target "\$GITHUB_SHA"/);
  assert.match(release, /permissions:\s*\n\s+contents: write/);
  assert.match(release, /github\.token|GITHUB_TOKEN/);
  assert.doesNotMatch(release, /secrets\.[A-Z0-9_]*TOKEN/);
  assert.doesNotMatch(release, /PAT/);
  assert.match(release, /--prerelease/);
  assert.match(release, /latest-mac\.yml/);
  assert.match(release, /beta-mac\.yml/);
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
  assert.match(keychain, /-lut 3600/);
  assert.doesNotMatch(keychain, /-lut 900\b/);
  assert.match(keychain, /unlock-keychain/);
  assert.match(keychain, /unlock-keychain[\s\S]*rm -f "\$PASSWORD_PATH"/);
  assert.match(keychain, /security import[\s\S]*\s-x\s/);
  assert.match(keychain, /rm -f "\$CERT_PATH"/);
  assert.match(keychain, /lock-keychain/);
  assert.doesNotMatch(keychain, /security import[\s\S]*\s-A\s/);
  assert.doesNotMatch(keychain, /-lut 21600/);
  assert.match(keychain, /openssl rand/);
  assert.match(keychain, /Developer ID Application/);
  const sign = files[1];
  assert.match(sign, /--options runtime --timestamp/);
  assert.match(sign, /entitlements\.mac\.sign\.plist/);
  assert.match(sign, /signing-identity\.json/);
  const notary = files[3];
  assert.match(notary, /notarytool submit/);
  assert.match(notary, /"\$status" != "Accepted"/);
  assert.match(notary, /rm -f "\$P8_PATH"/);
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
  assert.ok(main.includes("readDarwinSignatureAsync"));
  assert.ok(main.includes("attachUpdaterAfterTray"));
  const ready = main.slice(main.indexOf("app.whenReady()"));
  assert.ok(ready.indexOf("new TrayManager") < ready.indexOf("attachUpdaterAfterTray"));
  assert.ok(ready.indexOf("attachUpdaterAfterTray") < ready.indexOf("checkIfTranslocated"));
  assert.ok(main.includes("installingUpdate"));
  assert.match(
    main,
    /onBeforeQuitAndInstall:\s*async\s*\(\)\s*=>\s*\{[\s\S]*await tuskManager\.stop\(\)/
  );
  assert.ok(main.includes("listExtensionIds"));
  assert.ok(main.includes("shouldRepointNativeHost"));
  assert.ok(main.includes("readRecordedBundlePath"));
  assert.doesNotMatch(main, /require\(["']electron-updater["']\)/);
  const updater = fs.readFileSync(path.join(root, "electron", "updater.js"), "utf8");
  assert.doesNotMatch(updater, /require\(["']electron-updater["']\)/);
  const afterPack = fs.readFileSync(path.join(root, "electron", "after-pack.js"), "utf8");
  assert.ok(afterPack.includes("copyUpdaterModules"));
  assert.ok(afterPack.includes("electron-updater"));
  assert.match(workflow, /require\.resolve\(["']electron-updater["']/);
  assert.match(workflow, /ELECTRON_RUN_AS_NODE=1 "\$APP_PATH" \/tmp\/require-updater\.js/);
  assert.match(workflow, /UPDATER_MODULES missing under unpacked/);
  const fuses = fs.readFileSync(path.join(root, "scripts", "read-electron-fuses.js"), "utf8");
  assert.match(fuses, /dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX/);
  assert.doesNotMatch(fuses, /@electron\/fuses/);
});

test("dependency-free fuse reader parses the sentinel wire", () => {
  const {
    SENTINEL,
    ENABLE,
    DISABLE,
    findSentinel,
    parseFuseWire,
  } = require(path.join(root, "scripts", "read-electron-fuses.js"));
  const wire = Buffer.from([1, 9, ENABLE, ENABLE, DISABLE, DISABLE, ENABLE, ENABLE, DISABLE, ENABLE, DISABLE]);
  const buf = Buffer.concat([Buffer.from("xxxx"), SENTINEL, wire]);
  const at = findSentinel(buf);
  const parsed = parseFuseWire(buf, at);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.length, 9);
  assert.equal(parsed.bytes[0], ENABLE);
  assert.equal(parsed.bytes[2], DISABLE);
  assert.equal(parsed.bytes[3], DISABLE);
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
  assert.ok(docs.includes("Environment secrets"));
  assert.ok(docs.includes("same-repo"));
  assert.ok(docs.includes("v*-beta.*"));
  assert.doesNotMatch(docs, /beta-v\*/);
  assert.ok(docs.includes("environment: release"));
  assert.ok(docs.includes("SIGNING_ENABLED"));
  assert.ok(docs.includes("Prevent self review: leave it OFF"));
  assert.ok(docs.includes("Protect `beta/electron-menubar`"));
  assert.ok(docs.includes("Default workflow permissions: read"));
  assert.ok(docs.includes("blocks `gh release create` from creating the tag"));
  assert.ok(docs.includes("Push the tag first"));
  assert.ok(docs.includes("Beta clients follow the beta channel only"));
  const privacy = fs.readFileSync(path.join(root, "extension", "privacy-policy.md"), "utf8");
  assert.ok(privacy.includes("19721"));
  assert.ok(privacy.includes("lifesized/youtube-transcriber"));
  assert.ok(privacy.includes("releases.atom"));
  assert.ok(privacy.includes("latest-mac.yml"));
  assert.ok(privacy.includes("6 hours"));
});
