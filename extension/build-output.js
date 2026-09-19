const fs = require("fs");
const os = require("os");
const path = require("path");

let temporaryFileSequence = 0;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureRealDirectory(dir) {
  if (!fs.existsSync(dir)) {
    ensureDir(dir);
    return;
  }
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink()) {
    throw new Error(
      `Build output directory must not be a symbolic link: ${dir}`,
    );
  }
  if (!stat.isDirectory()) {
    throw new Error(`Build output path must be a directory: ${dir}`);
  }
}

function replaceFile(temporaryPath, dest, options = {}) {
  const platform = options.platform || process.platform;
  const renameSync = options.renameSync || fs.renameSync;
  const rmSync = options.rmSync || fs.rmSync;
  try {
    renameSync(temporaryPath, dest);
  } catch (err) {
    if (
      platform !== "win32" ||
      (err?.code !== "EEXIST" && err?.code !== "EPERM")
    ) {
      throw err;
    }
    // Windows cannot rename over an existing file. Changed extension files
    // already require a Chrome reload, so use the narrow remove-and-rename
    // fallback there while preserving atomic replacement on POSIX.
    rmSync(dest, { force: true });
    renameSync(temporaryPath, dest);
  }
}

function copyFileAtomically(src, dest) {
  ensureDir(path.dirname(dest));
  const temporaryPath = path.join(
    path.dirname(dest),
    `.${path.basename(dest)}.tmp-${process.pid}-${temporaryFileSequence++}`,
  );
  fs.copyFileSync(src, temporaryPath);
  try {
    replaceFile(temporaryPath, dest);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function filesMatch(src, dest, destinationStat) {
  if (!destinationStat?.isFile()) return false;
  const sourceStat = fs.statSync(src);
  if (sourceStat.size !== destinationStat.size) return false;
  if ((sourceStat.mode & 0o777) !== (destinationStat.mode & 0o777)) return false;
  return fs.readFileSync(src).equals(fs.readFileSync(dest));
}

function syncDirectoryPreservingRoot(src, dest) {
  ensureRealDirectory(dest);
  const sourceEntries = new Map(
    fs
      .readdirSync(src, { withFileTypes: true })
      .map((entry) => [entry.name, entry]),
  );

  // Publish complete new files before pruning old output. The loaded root and
  // its manifest therefore never disappear while Chrome watches the folder.
  for (const [name, entry] of sourceEntries) {
    const sourcePath = path.join(src, name);
    const destinationPath = path.join(dest, name);
    const existing = fs.existsSync(destinationPath)
      ? fs.lstatSync(destinationPath)
      : null;

    if (entry.isDirectory()) {
      if (existing && !existing.isDirectory()) {
        fs.rmSync(destinationPath, { force: true });
      }
      syncDirectoryPreservingRoot(sourcePath, destinationPath);
    } else {
      if (existing?.isDirectory()) {
        fs.rmSync(destinationPath, { recursive: true, force: true });
      }
      // Chrome executes the unpacked extension directly from this directory.
      // Replacing an unchanged popup/background resource can invalidate a live
      // extension document and leave the persistent side panel blank until the
      // user manually reloads it. Keep byte-identical loaded files untouched.
      if (!filesMatch(sourcePath, destinationPath, existing)) {
        copyFileAtomically(sourcePath, destinationPath);
      }
    }
  }

  for (const entry of fs.readdirSync(dest, { withFileTypes: true })) {
    if (sourceEntries.has(entry.name)) continue;
    fs.rmSync(path.join(dest, entry.name), {
      recursive: entry.isDirectory(),
      force: true,
    });
  }
}

function withTemporaryBuildDirectory(build) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "transcriber-extension-build-"),
  );
  try {
    return build(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

module.exports = {
  replaceFile,
  syncDirectoryPreservingRoot,
  withTemporaryBuildDirectory,
};
