const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("extension builds preserve the loaded dist directory", () => {
  const { syncDirectoryPreservingRoot } = require("./build-output.js");
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "transcriber-extension-build-"),
  );
  const staged = path.join(fixtureRoot, "staged");
  const dist = path.join(fixtureRoot, "dist");

  try {
    fs.mkdirSync(path.join(staged, "icons"), { recursive: true });
    fs.mkdirSync(path.join(dist, "icons"), { recursive: true });
    fs.writeFileSync(path.join(staged, "manifest.json"), "new manifest\n");
    fs.writeFileSync(path.join(staged, "popup.js"), "new popup\n");
    fs.writeFileSync(path.join(staged, "icons", "icon.svg"), "new icon\n");
    fs.writeFileSync(path.join(dist, "manifest.json"), "old manifest\n");
    fs.writeFileSync(path.join(dist, "stale.js"), "stale\n");

    const originalDirectoryInode = fs.statSync(dist).ino;
    syncDirectoryPreservingRoot(staged, dist);

    assert.equal(fs.statSync(dist).ino, originalDirectoryInode);
    assert.equal(
      fs.readFileSync(path.join(dist, "manifest.json"), "utf8"),
      "new manifest\n",
    );
    assert.equal(
      fs.readFileSync(path.join(dist, "popup.js"), "utf8"),
      "new popup\n",
    );
    assert.equal(
      fs.readFileSync(path.join(dist, "icons", "icon.svg"), "utf8"),
      "new icon\n",
    );
    assert.equal(fs.existsSync(path.join(dist, "stale.js")), false);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("extension builds do not replace unchanged loaded resources", () => {
  const { syncDirectoryPreservingRoot } = require("./build-output.js");
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "transcriber-extension-unchanged-"),
  );
  const staged = path.join(fixtureRoot, "staged");
  const dist = path.join(fixtureRoot, "dist");

  try {
    fs.mkdirSync(staged);
    fs.mkdirSync(dist);
    const stagedPopup = path.join(staged, "popup.js");
    const loadedPopup = path.join(dist, "popup.js");
    fs.writeFileSync(stagedPopup, "unchanged popup\n");
    fs.writeFileSync(loadedPopup, "unchanged popup\n");

    const oldTime = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(loadedPopup, oldTime, oldTime);
    const before = fs.statSync(loadedPopup);

    syncDirectoryPreservingRoot(staged, dist);

    const after = fs.statSync(loadedPopup);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("changed files use the Windows replace fallback", () => {
  const { replaceFile } = require("./build-output.js");
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "transcriber-extension-windows-replace-"),
  );
  const temporaryPath = path.join(fixtureRoot, "popup.js.tmp");
  const destinationPath = path.join(fixtureRoot, "popup.js");
  let renameAttempts = 0;

  try {
    fs.writeFileSync(temporaryPath, "new popup\n");
    fs.writeFileSync(destinationPath, "old popup\n");

    replaceFile(temporaryPath, destinationPath, {
      platform: "win32",
      renameSync(from, to) {
        renameAttempts += 1;
        if (renameAttempts === 1) {
          const error = new Error("destination exists");
          error.code = "EPERM";
          throw error;
        }
        fs.renameSync(from, to);
      },
    });

    assert.equal(renameAttempts, 2);
    assert.equal(fs.readFileSync(destinationPath, "utf8"), "new popup\n");
    assert.equal(fs.existsSync(temporaryPath), false);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("failed extension builds always remove their staging directory", () => {
  const { withTemporaryBuildDirectory } = require("./build-output.js");
  let stagingDirectory;

  assert.throws(
    () =>
      withTemporaryBuildDirectory((directory) => {
        stagingDirectory = directory;
        fs.writeFileSync(
          path.join(directory, "partial-output.js"),
          "partial\n",
        );
        throw new Error("simulated build failure");
      }),
    /simulated build failure/,
  );

  assert.equal(fs.existsSync(stagingDirectory), false);
});

test("extension builds refuse a symlinked dist root", () => {
  const { syncDirectoryPreservingRoot } = require("./build-output.js");
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "transcriber-extension-symlink-"),
  );
  const staged = path.join(fixtureRoot, "staged");
  const target = path.join(fixtureRoot, "unrelated-target");
  const dist = path.join(fixtureRoot, "dist");

  try {
    fs.mkdirSync(staged);
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(staged, "manifest.json"), "new manifest\n");
    fs.writeFileSync(path.join(target, "keep.txt"), "keep me\n");
    fs.symlinkSync(target, dist, "dir");

    assert.throws(
      () => syncDirectoryPreservingRoot(staged, dist),
      /must not be a symbolic link/,
    );
    assert.equal(
      fs.readFileSync(path.join(target, "keep.txt"), "utf8"),
      "keep me\n",
    );
    assert.equal(fs.existsSync(path.join(target, "manifest.json")), false);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
