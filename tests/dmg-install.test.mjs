/**
 * DMG install helper: copies Transcriber.app, clears quarantine, opens it.
 */

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const commandName = "Install Transcriber.command";
const commandPath = path.join(projectRoot, "electron", "dmg", commandName);

test("Install Transcriber.command exists and is executable", () => {
  assert.ok(fs.existsSync(commandPath), `${commandName} should exist`);
  const st = fs.statSync(commandPath);
  assert.ok(st.mode & 0o111, `${commandName} must be executable`);
  const text = fs.readFileSync(commandPath, "utf8");
  assert.ok(text.startsWith("#!/bin/bash"));
  assert.ok(text.includes("xattr -dr com.apple.quarantine"));
  assert.ok(text.includes("/Applications/Transcriber.app"));
  assert.ok(text.includes("tell application \"Transcriber\" to quit"));
  assert.match(text, /Privacy & Security/);
  assert.match(text, /Open Anyway/);
  assert.doesNotMatch(text, /Right-click/);
  assert.doesNotMatch(text, /killall Transcriber/);
  assert.ok(text.includes("CFBundleIdentifier"));
  assert.ok(text.includes("com.transcribed.app"));
  assert.ok(text.includes("/usr/libexec/PlistBuddy"));
  assert.ok(text.includes("Print :CFBundleIdentifier"));
  assert.ok(text.includes("ps -axo pid=,args="));
  assert.doesNotMatch(text, /ps -axo pid=,comm=/);
  assert.ok(
    text.includes(
      '{pid=$1; $1=""; sub(/^ +/,""); if ($0==exe || index($0, exe " ")==1) print pid}'
    )
  );
  assert.doesNotMatch(text, /python/i);
  assert.ok(text.includes('basename "$p"') || text.includes("Transcriber.app"));
  assert.ok(text.includes("Only run this from the DMG James sent"));
  const sudoLines = text.split("\n").filter((l) => /^\s*sudo\b/.test(l));
  assert.ok(sudoLines.length > 0, "sudo is allowed as a fallback");
  const sudoGuarded = text.includes("Need permission");
  assert.ok(sudoGuarded, "sudo must be behind a permission-failed path");
});

test("electron-builder packs the helper and background into the DMG, not asar", () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "electron-builder.json"), "utf8")
  );
  assert.ok(config.files.includes("!electron/dmg/**"));
  assert.equal(config.dmg.background, "electron/dmg/background.png");
  assert.equal(config.dmg.backgroundColor, undefined);
  const contents = config.dmg.contents || [];
  const helper = contents.find(
    (c) =>
      c.path === "electron/dmg/Install Transcriber.command" ||
      c.name === "Install Transcriber.command"
  );
  assert.ok(helper, "dmg.contents must include Install Transcriber.command");
  assert.equal(helper.type, "file");
  const appEntry = contents.find((c) => c.type === "file" && !c.path);
  assert.ok(appEntry, "dmg.contents must still include Transcriber.app (file, no path)");
  const apps = contents.find((c) => c.type === "link" && c.path === "/Applications");
  assert.equal(apps, undefined, "no /Applications link: a manual drag leaves the unsigned app 'damaged'");
  assert.equal(config.dmg.iconSize, 128);
  assert.deepEqual(config.dmg.window, { width: 660, height: 420 });
  assert.equal(helper.x, 330);
  assert.equal(helper.y, 200);
  assert.equal(appEntry.x, 330);
  assert.equal(appEntry.y, 560);
});

test("finalize-dmg.sh sets the helper icon and hides the app", () => {
  const script = path.join(projectRoot, "electron", "dmg", "finalize-dmg.sh");
  assert.ok(fs.existsSync(script));
  assert.ok(fs.statSync(script).mode & 0o111, "finalize-dmg.sh must be executable");
  const text = fs.readFileSync(script, "utf8");
  assert.ok(text.includes("setIconForFileOptions"));
  assert.ok(text.includes("NSFileExtensionHidden"));
  assert.ok(text.includes("SetFile -a E"));
  assert.ok(text.includes("SetFile -a C"));
  assert.ok(text.includes('chflags hidden "$MNT/$APP"'));
  assert.ok(text.includes("-format UDZO"));
  assert.doesNotMatch(text, /os\.getxattr/);
  assert.ok(text.includes("install-helper.icns"));
  const icns = path.join(projectRoot, "electron", "dmg", "install-helper.icns");
  assert.ok(fs.existsSync(icns), "electron/dmg/install-helper.icns is Design's helper icon");
  const buf = fs.readFileSync(icns);
  assert.equal(buf.slice(0, 4).toString("ascii"), "icns");
  assert.ok(buf.length > 1000);
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  assert.match(pkg.scripts["electron:build"], /electron-builder[^&]*&& bash electron\/dmg\/finalize-dmg\.sh$/);
});

test("DMG background PNG exists", () => {
  const pngPath = path.join(projectRoot, "electron", "dmg", "background.png");
  const png2x = path.join(projectRoot, "electron", "dmg", "background@2x.png");
  assert.ok(fs.existsSync(pngPath));
  assert.ok(fs.existsSync(png2x));
  const buf = fs.readFileSync(pngPath);
  const buf2x = fs.readFileSync(png2x);
  assert.deepEqual(
    [...buf.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  );
  assert.ok(buf.length > 500);
  assert.equal(buf.readUInt32BE(16), 660);
  assert.equal(buf.readUInt32BE(20), 420);
  assert.equal(buf2x.readUInt32BE(16), 1320);
  assert.equal(buf2x.readUInt32BE(20), 840);
  const gen = fs.readFileSync(
    path.join(projectRoot, "electron", "dmg", "generate-background.py"),
    "utf8"
  );
  assert.ok(gen.includes("#83735e"), "label band must stay the mid-tone that passes 4.5:1 for black and white labels");
  assert.ok(gen.includes("Open Anyway"));
  assert.ok(gen.includes("Double-click the installer"));
  assert.ok(gen.includes("It copies Transcriber to Applications and opens it."));
  assert.doesNotMatch(gen, /right-click/i, "macOS 15 removed right-click → Open");
  assert.doesNotMatch(gen, /run this/);
  assert.doesNotMatch(gen, /load_default/, "never fall back to Pillow's bitmap font");
});

test("beta install docs lead with the helper and xattr fallback", () => {
  const docs = fs.readFileSync(
    path.join(projectRoot, "docs", "beta-install-macos.md"),
    "utf8"
  );
  assert.ok(docs.includes("Install Transcriber.command"));
  assert.ok(docs.includes("xattr -dr com.apple.quarantine /Applications/Transcriber.app"));
  const helperIdx = docs.indexOf("Install Transcriber.command");
  const xattrIdx = docs.indexOf("xattr -dr");
  assert.ok(helperIdx > 0 && helperIdx < xattrIdx, "helper must be the primary path");
  assert.ok(!/NEVER run `xattr/.test(docs));
  assert.ok(docs.includes("shasum -a 256"));
  assert.ok(docs.includes("Only run this from the DMG James sent; it turns off macOS's download check for this app."));
  assert.ok(docs.includes("System Settings → Privacy & Security → Open Anyway"));
  assert.ok(docs.includes("macOS 15 removed right-click → Open"));
});

test("CI mounts the DMG and checks for the helper", () => {
  const workflow = fs.readFileSync(
    path.join(projectRoot, ".github", "workflows", "electron-build-macos.yml"),
    "utf8"
  );
  assert.ok(workflow.includes("hdiutil attach"));
  assert.ok(workflow.includes("Install Transcriber.command"));
  assert.doesNotMatch(workflow, /stamp-dmg-helper-icon/);
  assert.match(workflow, /namedfork\/rsrc/);
  assert.match(workflow, /GetFileInfo -aC/);
  assert.match(workflow, /GetFileInfo -ae/);
  assert.match(workflow, /assert-helper-icon\.py/);
  assert.match(workflow, /hidden.*Transcriber\.app/);
  assert.match(workflow, /test ! -e "\$MOUNT\/Applications"/);
  assert.match(workflow, /screenshot-dmg-window\.py/);
  assert.match(workflow, /name: dmg-window/);
  const assertAt = workflow.indexOf("Assert DMG contains Install Transcriber.command");
  const shaAt = workflow.indexOf("- name: DMG sha256");
  assert.ok(assertAt > 0 && assertAt < shaAt, "helper assert must run before sha256");
  const shot = fs.readFileSync(
    path.join(projectRoot, "electron", "dmg", "screenshot-dmg-window.py"),
    "utf8"
  );
  assert.match(shot, /screencapture/);
  assert.match(shot, /660/);
  assert.match(shot, /420/);
  const assertPy = fs.readFileSync(
    path.join(projectRoot, "electron", "dmg", "assert-helper-icon.py"),
    "utf8"
  );
  assert.match(assertPy, /\.\.namedfork\/rsrc/);
});

test("helper copies the app, clears quarantine, and does not sudo on success", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dmg-install-"));
  const volume = path.join(tmp, "Transcriber");
  const destDir = path.join(tmp, "Applications");
  const dest = path.join(destDir, "Transcriber.app");
  const bin = path.join(tmp, "bin");
  const log = path.join(tmp, "calls.log");
  fs.mkdirSync(path.join(volume, "Transcriber.app", "Contents"), { recursive: true });
  fs.writeFileSync(path.join(volume, "Transcriber.app", "Contents", "marker"), "payload");
  fs.copyFileSync(commandPath, path.join(volume, commandName));
  fs.chmodSync(path.join(volume, commandName), 0o755);
  fs.mkdirSync(bin, { recursive: true });

  const stub = (name, body) => {
    const p = path.join(bin, name);
    fs.writeFileSync(p, `#!/bin/bash\n${body}\n`);
    fs.chmodSync(p, 0o755);
  };
  stub(
    "ditto",
    `echo "ditto $*" >> "${log}"
mkdir -p "$2"
cp -R "$1"/. "$2"`
  );
  stub("xattr", `echo "xattr $*" >> "${log}"`);
  stub("open", `echo "open $*" >> "${log}"`);
  stub("osascript", `echo "osascript $*" >> "${log}"`);
  stub("pgrep", "exit 1");
  stub(
    "sudo",
    `echo "sudo $*" >> "${log}"
echo "sudo must not run on a successful copy" >&2
exit 1`
  );

  const result = spawnSync("bash", [path.join(volume, commandName)], {
    env: {
      ...process.env,
      PATH: `${bin}:/usr/bin:/bin`,
      TRANSCRIBER_INSTALL_DEST: dest,
      TRANSCRIBER_INSTALL_NONINTERACTIVE: "1",
      TRANSCRIBER_QUIT_WAIT_SECS: "1",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(fs.existsSync(path.join(dest, "Contents", "marker")));
  const calls = fs.readFileSync(log, "utf8");
  assert.match(calls, /xattr -dr com\.apple\.quarantine /);
  assert.match(calls, /open /);
  assert.doesNotMatch(calls, /^sudo /m);
  assert.match(result.stdout, /Done/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeInfoPlist(appPath, bundleId) {
  fs.mkdirSync(path.join(appPath, "Contents"), { recursive: true });
  fs.writeFileSync(
    path.join(appPath, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
</dict>
</plist>
`
  );
}

test("helper refuses a destination not named Transcriber.app", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dmg-install-name-"));
  const volume = path.join(tmp, "Transcriber");
  fs.mkdirSync(path.join(volume, "Transcriber.app", "Contents"), { recursive: true });
  fs.writeFileSync(path.join(volume, "Transcriber.app", "Contents", "marker"), "payload");
  fs.copyFileSync(commandPath, path.join(volume, commandName));
  fs.chmodSync(path.join(volume, commandName), 0o755);
  const result = spawnSync("bash", [path.join(volume, commandName)], {
    env: {
      ...process.env,
      PATH: "/usr/bin:/bin",
      TRANSCRIBER_INSTALL_DEST: path.join(tmp, "Evil.app"),
      TRANSCRIBER_INSTALL_NONINTERACTIVE: "1",
      TRANSCRIBER_QUIT_WAIT_SECS: "1",
      TRANSCRIBER_INSTALL_SKIP_OPEN: "1",
    },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /must be named Transcriber\.app/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("helper refuses to replace a dest with a different bundle id", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dmg-install-id-"));
  const volume = path.join(tmp, "Transcriber");
  const destDir = path.join(tmp, "Applications");
  const dest = path.join(destDir, "Transcriber.app");
  fs.mkdirSync(path.join(volume, "Transcriber.app", "Contents"), { recursive: true });
  fs.writeFileSync(path.join(volume, "Transcriber.app", "Contents", "marker"), "payload");
  writeInfoPlist(dest, "com.example.not-transcriber");
  fs.writeFileSync(path.join(dest, "Contents", "keep-me"), "foreign");
  fs.copyFileSync(commandPath, path.join(volume, commandName));
  fs.chmodSync(path.join(volume, commandName), 0o755);
  const result = spawnSync("bash", [path.join(volume, commandName)], {
    env: {
      ...process.env,
      PATH: "/usr/bin:/bin",
      TRANSCRIBER_INSTALL_DEST: dest,
      TRANSCRIBER_INSTALL_NONINTERACTIVE: "1",
      TRANSCRIBER_QUIT_WAIT_SECS: "1",
      TRANSCRIBER_INSTALL_SKIP_OPEN: "1",
    },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /CFBundleIdentifier/);
  assert.ok(fs.existsSync(path.join(dest, "Contents", "keep-me")));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("helper treats a non-integer QUIT_WAIT as the default", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dmg-install-wait-"));
  const volume = path.join(tmp, "Transcriber");
  const destDir = path.join(tmp, "Applications");
  const dest = path.join(destDir, "Transcriber.app");
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(path.join(volume, "Transcriber.app", "Contents"), { recursive: true });
  fs.writeFileSync(path.join(volume, "Transcriber.app", "Contents", "marker"), "payload");
  fs.copyFileSync(commandPath, path.join(volume, commandName));
  fs.chmodSync(path.join(volume, commandName), 0o755);
  fs.mkdirSync(bin, { recursive: true });
  const stub = (name, body) => {
    const p = path.join(bin, name);
    fs.writeFileSync(p, `#!/bin/bash\n${body}\n`);
    fs.chmodSync(p, 0o755);
  };
  stub("ditto", `mkdir -p "$2"\ncp -R "$1"/. "$2"`);
  stub("xattr", "exit 0");
  stub("open", "exit 0");
  stub("osascript", "exit 0");
  const result = spawnSync("bash", [path.join(volume, commandName)], {
    env: {
      ...process.env,
      PATH: `${bin}:/usr/bin:/bin`,
      TRANSCRIBER_INSTALL_DEST: dest,
      TRANSCRIBER_INSTALL_NONINTERACTIVE: "1",
      TRANSCRIBER_QUIT_WAIT_SECS: "nope",
      TRANSCRIBER_INSTALL_SKIP_OPEN: "1",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(fs.existsSync(path.join(dest, "Contents", "marker")));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("install helper awk matches executable paths that contain spaces", () => {
  const awk =
    '{pid=$1; $1=""; sub(/^ +/,""); if ($0==exe || index($0, exe " ")==1) print pid}';
  const exe = "/tmp/My App/Transcriber.app/Contents/MacOS/Transcriber";
  const input = ` 4242 ${exe}\n  99 ${exe} --helper\n   7 /usr/bin/other\n`;
  const result = spawnSync("awk", ["-v", `exe=${exe}`, awk], {
    input,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "4242\n99");
});
