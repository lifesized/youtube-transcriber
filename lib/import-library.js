"use strict";

/**
 * Import an existing Transcriber SQLite library into the app DB.
 *
 * Source is opened read-only and copied with SQLite's online backup API.
 * Migrations run only on that temp copy. The app DB is backed up first;
 * merge is one transaction (existing cache keys win).
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { applyMigrations, resolveMigrationsDir } = require("./apply-migrations.js");

function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function pruneImportBackups(backupsDir, keep = 5) {
  if (!fs.existsSync(backupsDir)) return [];
  const files = fs
    .readdirSync(backupsDir)
    .filter((name) => name.endsWith(".db"))
    .map((name) => {
      const full = path.join(backupsDir, name);
      return { name, full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
  const removed = [];
  for (const extra of files.slice(keep)) {
    fs.rmSync(extra.full, { force: true });
    removed.push(extra.name);
  }
  return removed;
}

function openDatabase(filePath, options) {
  const Database = require("better-sqlite3");
  return new Database(filePath, options);
}

async function sqliteBackup(sourcePath, destPath, { readonly = false } = {}) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const src = openDatabase(sourcePath, {
    readonly,
    fileMustExist: true,
  });
  try {
    await src.backup(destPath);
  } finally {
    src.close();
  }
}

function hasVideoTable(db) {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Video'"
    )
    .get();
  return Boolean(row);
}

function inspectSourceDatabase(sourcePath) {
  const db = openDatabase(sourcePath, { readonly: true, fileMustExist: true });
  try {
    if (!hasVideoTable(db)) {
      const err = new Error("Not a Transcriber library (no Video table).");
      err.code = "IMPORT_NO_VIDEO_TABLE";
      throw err;
    }
    const count = db.prepare("SELECT COUNT(*) AS n FROM Video").get().n;
    return { count: Number(count) || 0 };
  } finally {
    db.close();
  }
}

function cacheKey(row) {
  const lang =
    row.captionLanguage == null || row.captionLanguage === ""
      ? "en"
      : String(row.captionLanguage);
  const pipeline =
    row.pipelineVersion == null || row.pipelineVersion === ""
      ? 1
      : Number(row.pipelineVersion);
  return `${row.videoId}\0${lang}\0${pipeline}`;
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all();
}

function existingIds(db) {
  return new Set(
    db.prepare("SELECT id FROM Video").all().map((row) => row.id)
  );
}

function existingKeys(db) {
  const cols = new Set(tableColumns(db, "Video").map((c) => c.name));
  const hasLang = cols.has("captionLanguage");
  const hasPipeline = cols.has("pipelineVersion");
  const keys = new Set();
  for (const row of db.prepare("SELECT * FROM Video").iterate()) {
    if (!hasLang) row.captionLanguage = "en";
    if (!hasPipeline) row.pipelineVersion = 1;
    keys.add(cacheKey(row));
  }
  return keys;
}

function mergeVideos(dest, source, { beforeCommit } = {}) {
  const destCols = tableColumns(dest, "Video");
  const destColNames = destCols.map((c) => c.name);
  const sourceColNames = new Set(tableColumns(source, "Video").map((c) => c.name));
  const placeholders = destColNames.map(() => "?").join(", ");
  const quoted = destColNames.map((name) => `"${name}"`).join(", ");
  const insertSql = `INSERT INTO Video (${quoted}) VALUES (${placeholders})`;
  const insert = dest.prepare(insertSql);
  const keys = existingKeys(dest);
  const ids = existingIds(dest);

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  dest.exec("BEGIN IMMEDIATE");
  try {
    if (typeof beforeCommit === "function") beforeCommit();
    for (const row of source.prepare("SELECT * FROM Video").iterate()) {
      try {
        if (!row.videoId) {
          failed += 1;
          continue;
        }
        if (!sourceColNames.has("captionLanguage")) row.captionLanguage = "en";
        if (!sourceColNames.has("pipelineVersion")) row.pipelineVersion = 1;
        if (row.captionLanguage == null || row.captionLanguage === "") {
          row.captionLanguage = "en";
        }
        if (row.pipelineVersion == null || row.pipelineVersion === "") {
          row.pipelineVersion = 1;
        }
        const key = cacheKey(row);
        if (keys.has(key)) {
          skipped += 1;
          continue;
        }
        if (ids.has(row.id)) {
          row.id = crypto.randomUUID();
        }
        const values = destColNames.map((name) => {
          if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
          const col = destCols.find((c) => c.name === name);
          if (col && col.dflt_value != null) return undefined;
          if (name === "updatedAt" || name === "createdAt") {
            return new Date().toISOString();
          }
          return null;
        });
        const bind = values.map((v) => (v === undefined ? null : v));
        insert.run(...bind);
        keys.add(key);
        ids.add(row.id);
        imported += 1;
      } catch (error) {
        failed += 1;
        throw error;
      }
    }
    dest.exec("COMMIT");
  } catch (error) {
    try {
      dest.exec("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw error;
  }

  return { imported, skipped, failed };
}

/**
 * @param {object} options
 * @param {string} options.sourcePath
 * @param {string} options.destPath
 * @param {string} options.backupsDir
 * @param {string} [options.migrationsDir]
 * @param {string} [options.timestamp]
 * @param {() => void} [options.beforeCommit]  injected failure hook (tests)
 * @param {(backupPath: string) => void} [options.afterBackup]
 */
function pickMigrationsDir(explicit) {
  const candidates = [
    explicit,
    process.env.PRISMA_MIGRATIONS_DIR,
    process.resourcesPath
      ? path.join(process.resourcesPath, "standalone", "prisma", "migrations")
      : null,
    path.join(process.cwd(), "prisma", "migrations"),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return resolveMigrationsDir(explicit);
}

async function importLibrary(options) {
  const sourcePath = options.sourcePath;
  const destPath = options.destPath;
  const backupsDir = options.backupsDir;
  const migrationsDir = pickMigrationsDir(options.migrationsDir);
  const timestamp = options.timestamp || backupTimestamp();

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source database not found: ${sourcePath}`);
  }
  if (!fs.existsSync(destPath)) {
    throw new Error(
      "No Transcriber library found. Open Transcriber once, then try again."
    );
  }

  inspectSourceDatabase(sourcePath);

  const backupPath = path.join(backupsDir, `${timestamp}.db`);
  await sqliteBackup(destPath, backupPath, { readonly: false });
  try {
    fs.chmodSync(backupPath, 0o600);
  } catch {
    // Windows may ignore chmod
  }
  pruneImportBackups(backupsDir, 5);
  if (typeof options.afterBackup === "function") {
    options.afterBackup(backupPath);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-import-"));
  const tempPath = path.join(tempDir, "source.db");
  try {
    await sqliteBackup(sourcePath, tempPath, { readonly: true });
    applyMigrations(`file:${tempPath}`, migrationsDir);

    const dest = openDatabase(destPath);
    const source = openDatabase(tempPath, { readonly: true });
    try {
      const counts = mergeVideos(dest, source, {
        beforeCommit: options.beforeCommit,
      });
      return { ...counts, backupPath };
    } finally {
      dest.close();
      source.close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  importLibrary,
  inspectSourceDatabase,
  sqliteBackup,
  backupTimestamp,
  pruneImportBackups,
  cacheKey,
};
