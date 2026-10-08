/**
 * Import existing library: backup-first merge from an old init-schema DB.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const INIT_MIGRATION = "20260212021540_init";
const EXTRA_MIGRATION = "20260918120000_index_video_created_at";
const {
  importLibrary,
  inspectSourceDatabase,
} = require(path.join(projectRoot, "lib", "import-library.js"));
const { applyMigrations } = require(path.join(
  projectRoot,
  "lib",
  "apply-migrations.js"
));

const migrationsDir = path.join(projectRoot, "prisma", "migrations");

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function recordMigration(db, name, sql = "") {
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  const now = new Date().toISOString();
  db.exec(`
    CREATE TABLE IF NOT EXISTS _prisma_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL,
      finished_at DATETIME,
      migration_name TEXT NOT NULL,
      logs TEXT,
      rolled_back_at DATETIME,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      applied_steps_count INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare(
    `INSERT INTO _prisma_migrations
      (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count)
     VALUES (?, ?, ?, ?, NULL, ?, 1)`
  ).run(crypto.randomUUID(), checksum, now, name, now);
}

function insertInitVideo(db, { id, videoId, title }) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO Video
      (id, videoId, title, author, channelUrl, thumbnailUrl, videoUrl, transcript, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    videoId,
    title,
    "Author",
    "https://youtube.com/c/a",
    "",
    `https://www.youtube.com/watch?v=${videoId}`,
    JSON.stringify([{ text: title, startMs: 0, durationMs: 1000 }]),
    now,
    now
  );
}

function buildOldSourceDb(filePath) {
  const initSql = fs.readFileSync(
    path.join(migrationsDir, INIT_MIGRATION, "migration.sql"),
    "utf8"
  );
  const db = new Database(filePath);
  db.exec(initSql);
  recordMigration(db, INIT_MIGRATION, initSql);
  db.exec(`CREATE INDEX "Video_createdAt_idx" ON "Video"("createdAt");`);
  recordMigration(db, EXTRA_MIGRATION, `CREATE INDEX "Video_createdAt_idx" ON "Video"("createdAt");`);
  insertInitVideo(db, { id: "src-keep", videoId: "aaaaaaaaaaa", title: "Keep me" });
  insertInitVideo(db, { id: "src-overlap", videoId: "overlapvid1", title: "From source" });
  insertInitVideo(db, { id: "src-third", videoId: "bbbbbbbbbbb", title: "Third" });
  db.close();
}

function buildAppDb(filePath, { withOverlap = true } = {}) {
  applyMigrations(`file:${filePath}`, migrationsDir);
  const db = new Database(filePath);
  if (withOverlap) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Video
        (id, videoId, captionLanguage, pipelineVersion, title, author, channelUrl, thumbnailUrl, videoUrl, transcript, createdAt, updatedAt)
       VALUES (?, ?, 'en', 1, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "dest-overlap",
      "overlapvid1",
      "Existing dest title",
      "Dest Author",
      "",
      "",
      "https://www.youtube.com/watch?v=overlapvid1",
      JSON.stringify([{ text: "dest", startMs: 0, durationMs: 1000 }]),
      now,
      now
    );
  }
  db.close();
}

function videoTitles(filePath) {
  const db = new Database(filePath, { readonly: true });
  const rows = db.prepare("SELECT videoId, title FROM Video ORDER BY videoId").all();
  db.close();
  return rows;
}

test("inspectSourceDatabase counts Video rows and rejects non-libraries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-import-inspect-"));
  const source = path.join(dir, "old.db");
  buildOldSourceDb(source);
  assert.equal(inspectSourceDatabase(source).count, 3);

  const empty = path.join(dir, "empty.db");
  const db = new Database(empty);
  db.exec("CREATE TABLE notes (id TEXT);");
  db.close();
  assert.throws(
    () => inspectSourceDatabase(empty),
    (err) => err && err.code === "IMPORT_NO_VIDEO_TABLE"
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("import merges old init-schema rows, extra index/history tolerated, existing keys win", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-import-"));
  const source = path.join(dir, "old.db");
  const dest = path.join(dir, "transcriber.db");
  const backupsDir = path.join(dir, "backups");
  buildOldSourceDb(source);
  buildAppDb(dest);
  const sourceHash = sha256File(source);

  const result = await importLibrary({
    sourcePath: source,
    destPath: dest,
    backupsDir,
    migrationsDir,
    timestamp: "test-stamp",
  });

  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.backupPath, path.join(backupsDir, "test-stamp.db"));
  assert.ok(fs.existsSync(result.backupPath));
  assert.equal(sha256File(source), sourceHash, "source file must stay byte-identical");

  const titles = videoTitles(dest);
  assert.equal(titles.length, 3);
  const overlap = titles.find((r) => r.videoId === "overlapvid1");
  assert.equal(overlap.title, "Existing dest title");
  assert.ok(titles.some((r) => r.videoId === "aaaaaaaaaaa"));
  assert.ok(titles.some((r) => r.videoId === "bbbbbbbbbbb"));

  const backup = new Database(result.backupPath, { readonly: true });
  assert.equal(backup.prepare("SELECT COUNT(*) AS n FROM Video").get().n, 1);
  backup.close();
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(result.backupPath).mode & 0o777, 0o600);
  }

  const again = await importLibrary({
    sourcePath: source,
    destPath: dest,
    backupsDir,
    migrationsDir,
    timestamp: "test-stamp-2",
  });
  assert.equal(again.imported, 0);
  assert.equal(again.skipped, 3);
  assert.equal(again.failed, 0);
  assert.equal(sha256File(source), sourceHash);
  assert.equal(videoTitles(dest).length, 3);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("injected merge failure rolls back dest and leaves the backup", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-import-fail-"));
  const source = path.join(dir, "old.db");
  const dest = path.join(dir, "transcriber.db");
  const backupsDir = path.join(dir, "backups");
  buildOldSourceDb(source);
  buildAppDb(dest);
  const destDump = JSON.stringify(videoTitles(dest));
  const sourceHash = sha256File(source);

  await assert.rejects(
    () =>
      importLibrary({
        sourcePath: source,
        destPath: dest,
        backupsDir,
        migrationsDir,
        timestamp: "fail-stamp",
        beforeCommit() {
          throw new Error("injected failure");
        },
      }),
    /injected failure/
  );

  assert.equal(
    JSON.stringify(videoTitles(dest)),
    destDump,
    "dest library must be unchanged after rollback"
  );
  assert.equal(sha256File(source), sourceHash, "source must stay byte-identical");
  assert.ok(fs.existsSync(path.join(backupsDir, "fail-stamp.db")));
  assert.equal(videoTitles(dest).length, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("import backups are created 0600 and keep only the last 5", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-import-prune-"));
  const source = path.join(dir, "old.db");
  const dest = path.join(dir, "transcriber.db");
  const backupsDir = path.join(dir, "backups");
  buildOldSourceDb(source);
  buildAppDb(dest);
  fs.mkdirSync(backupsDir, { recursive: true });
  for (let i = 0; i < 5; i++) {
    const p = path.join(backupsDir, `old-${i}.db`);
    fs.writeFileSync(p, "old");
    fs.utimesSync(p, new Date(1_000 + i), new Date(1_000 + i));
  }
  await importLibrary({
    sourcePath: source,
    destPath: dest,
    backupsDir,
    migrationsDir,
    timestamp: "newest-stamp",
  });
  const left = fs.readdirSync(backupsDir).filter((n) => n.endsWith(".db")).sort();
  assert.equal(left.length, 5);
  assert.ok(left.includes("newest-stamp.db"));
  assert.equal(left.includes("old-0.db"), false);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(backupsDir, "newest-stamp.db")).mode & 0o777, 0o600);
  }
  const src = fs.readFileSync(
    path.join(projectRoot, "lib", "import-library.js"),
    "utf8"
  );
  assert.ok(src.includes('openSync(filePath, "wx", mode)'));
  assert.ok(src.includes("createMode: 0o600"));
  assert.equal(src.includes("process.umask("), false);
  assert.equal(src.includes("chmodSync(backupPath"), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("tray offers Import Existing Library…", () => {
  const tray = fs.readFileSync(
    path.join(projectRoot, "electron", "tray-manager.js"),
    "utf8"
  );
  const menu = fs.readFileSync(
    path.join(projectRoot, "electron", "tray-menu.js"),
    "utf8"
  );
  assert.ok(menu.includes("Import Existing Library…"));
  assert.ok(tray.includes("importLibrary"));
});
