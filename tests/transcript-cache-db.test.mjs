/**
 * Real SQLite cache integration test.
 *
 * 1. Temp DB at the pre-cache (init) schema with an old Video row
 * 2. prisma migrate deploy
 * 3. Row survives with captionLanguage='en' and pipelineVersion=1
 * 4. getOrCreateTranscript with an injected fetcher hits once, misses on
 *    a different lang and on a bumped pipelineVersion
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const INIT_MIGRATION = "20260212021540_init";
const CACHE_MIGRATION = "20261007210826_add_transcript_cache_keys";

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("migrate deploy preserves old Video rows and cache keys isolate fetches", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-cache-"));
  const dbPath = path.join(dir, "cache.db");
  const databaseUrl = `file:${dbPath}`;
  process.env.DATABASE_URL = databaseUrl;

  const initSql = fs.readFileSync(
    path.join(projectRoot, "prisma/migrations", INIT_MIGRATION, "migration.sql"),
    "utf8"
  );
  const db = new Database(dbPath);
  db.exec(initSql);
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
  const checksum = sha256File(
    path.join(projectRoot, "prisma/migrations", INIT_MIGRATION, "migration.sql")
  );
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO _prisma_migrations
      (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count)
     VALUES (?, ?, ?, ?, NULL, ?, 1)`
  ).run(crypto.randomUUID(), checksum, now, INIT_MIGRATION, now);

  db.prepare(
    `INSERT INTO Video
      (id, videoId, title, author, channelUrl, thumbnailUrl, videoUrl, transcript, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "oldrow1",
    "oldvid123456",
    "Old Title",
    "Old Author",
    "https://youtube.com/c/old",
    "",
    "https://www.youtube.com/watch?v=oldvid123456",
    JSON.stringify([{ text: "hello from old schema", startMs: 0, durationMs: 1000 }]),
    now,
    now
  );
  db.close();

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  const after = new Database(dbPath);
  const migrated = after
    .prepare("SELECT * FROM Video WHERE videoId = ?")
    .get("oldvid123456");
  assert.ok(migrated, "old Video row should survive migrate deploy");
  assert.equal(migrated.captionLanguage, "en");
  assert.equal(migrated.pipelineVersion, 1);
  const applied = after
    .prepare("SELECT migration_name FROM _prisma_migrations ORDER BY migration_name")
    .all()
    .map((row) => row.migration_name);
  assert.ok(applied.includes(CACHE_MIGRATION));
  after.close();

  let fetchCount = 0;
  const fetcher = async (url, lang) => {
    fetchCount += 1;
    return {
      videoId: "newvid",
      title: `Fetched ${lang || "en"}`,
      author: "Fetcher",
      channelUrl: "https://youtube.com/c/fetch",
      thumbnailUrl: "",
      transcript: [{ text: `lang=${lang || "en"} url=${url}`, startMs: 0, durationMs: 1000 }],
      source: "youtube_captions",
    };
  };

  const cache = await import("../lib/transcript-cache.ts");

  const first = await cache.getOrCreateTranscript(
    "oldvid123456",
    "https://www.youtube.com/watch?v=oldvid123456",
    "en",
    "youtube",
    { fetcher }
  );
  const second = await cache.getOrCreateTranscript(
    "oldvid123456",
    "https://www.youtube.com/watch?v=oldvid123456",
    "en",
    "youtube",
    { fetcher }
  );
  assert.equal(fetchCount, 0, "cached en/v1 row must not refetch");
  assert.equal(first.id, second.id);
  assert.equal(first.captionLanguage, "en");
  assert.equal(first.pipelineVersion, 1);

  await cache.getOrCreateTranscript(
    "oldvid123456",
    "https://www.youtube.com/watch?v=oldvid123456",
    "es",
    "youtube",
    { fetcher }
  );
  assert.equal(fetchCount, 1, "different lang must refetch");

  await cache.getOrCreateTranscript(
    "oldvid123456",
    "https://www.youtube.com/watch?v=oldvid123456",
    "en",
    "youtube",
    { fetcher, pipelineVersion: 2 }
  );
  assert.equal(fetchCount, 2, "bumped pipelineVersion must refetch");
});
