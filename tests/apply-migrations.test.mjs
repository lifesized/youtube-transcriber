import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

test("applyMigrations creates Video table on a fresh database", async () => {
  const Database = require("better-sqlite3");
  const { applyMigrations } = require("../lib/apply-migrations.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-migrate-"));
  const dbPath = path.join(dir, "test.db");
  const migrationsDir = path.join(projectRoot, "prisma", "migrations");

  const result = applyMigrations(`file:${dbPath}`, migrationsDir);
  assert.ok(result.applied.length >= 1);
  assert.equal(result.skipped.length, 0);

  const db = new Database(dbPath);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((row) => row.name);
  assert.ok(tables.includes("Video"));
  const cols = db.prepare("PRAGMA table_info(Video)").all().map((c) => c.name);
  assert.ok(cols.includes("captionLanguage"));
  assert.ok(cols.includes("pipelineVersion"));
  db.close();
});

const migrationsDir = path.join(projectRoot, "prisma", "migrations");
const OLD_MIGRATIONS = [
  "20260212021540_init",
  "20261007210826_add_transcript_cache_keys",
];
const TABLES_MIGRATION = "20261008193000_add_settings_usage_waitlist_tables";
// 20261007210826 added these as nullable; making them NOT NULL needs a table
// rebuild, which an in-place app upgrade must not do.
const KNOWN_NULLABLE = new Set(["Video.source", "Video.platform"]);

function scratchDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-bootstrap-"));
  return path.join(dir, "test.db");
}

function oldMigrationsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-old-migrations-"));
  for (const name of OLD_MIGRATIONS) {
    fs.cpSync(path.join(migrationsDir, name), path.join(dir, name), {
      recursive: true,
    });
  }
  return dir;
}

function describeSchema(dbPath) {
  const Database = require("better-sqlite3");
  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations' ORDER BY name"
      )
      .all()
      .map((row) => row.name);
    const out = {};
    for (const table of tables) {
      const columns = db
        .prepare(`PRAGMA table_info("${table}")`)
        .all()
        .map((c) => ({
          name: c.name,
          type: c.type,
          notnull: KNOWN_NULLABLE.has(`${table}.${c.name}`) ? 0 : c.notnull,
          dflt: c.dflt_value,
          pk: c.pk,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const indexes = db
        .prepare(`PRAGMA index_list("${table}")`)
        .all()
        .filter((i) => i.origin !== "pk")
        .map((i) => ({
          name: i.name,
          unique: i.unique,
          columns: db
            .prepare(`PRAGMA index_info("${i.name}")`)
            .all()
            .map((c) => c.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      out[table] = { columns, indexes };
    }
    return out;
  } finally {
    db.close();
  }
}

let schemaDescription;
function expectedSchema() {
  if (schemaDescription) return schemaDescription;
  const Database = require("better-sqlite3");
  const sql = execFileSync(
    path.join(projectRoot, "node_modules", ".bin", "prisma"),
    ["migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"],
    {
      cwd: projectRoot,
      env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const dbPath = scratchDb();
  const db = new Database(dbPath);
  db.exec(sql);
  db.close();
  schemaDescription = describeSchema(dbPath);
  return schemaDescription;
}

function seedVideos(dbPath) {
  const Database = require("better-sqlite3");
  const db = new Database(dbPath);
  const insert = db.prepare(
    `INSERT INTO Video (id, videoId, title, author, videoUrl, transcript, updatedAt, source, platform, baseSummary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insert.run("v1", "abc", "First", "Ann", "https://youtu.be/abc", "[]", "2026-10-01T00:00:00.000Z", "youtube_captions", "youtube", "Summary one");
  insert.run("v2", "linkedin:7151241570371948544", "Second", "Bo", "https://www.linkedin.com/posts/x", '[{"text":"hi"}]', "2026-10-02T00:00:00.000Z", "linkedin_whisper_local", "linkedin", null);
  db.close();
}

function readAll(dbPath, table) {
  const Database = require("better-sqlite3");
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(`SELECT * FROM "${table}" ORDER BY 1`).all();
  } finally {
    db.close();
  }
}

function recordMigrations(dbPath, names) {
  const Database = require("better-sqlite3");
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS _prisma_migrations (
    id TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, finished_at DATETIME,
    migration_name TEXT NOT NULL, logs TEXT, rolled_back_at DATETIME,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_steps_count INTEGER NOT NULL DEFAULT 0)`);
  const insert = db.prepare(
    "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (?, 'x', CURRENT_TIMESTAMP, ?, 1)"
  );
  for (const name of names) insert.run(name, name);
  db.close();
}

test("a fresh app database matches prisma/schema.prisma", () => {
  const { applyMigrations } = require("../lib/apply-migrations.js");
  const dbPath = scratchDb();
  applyMigrations(`file:${dbPath}`, migrationsDir);
  assert.deepEqual(describeSchema(dbPath), expectedSchema());
});

test("an old-bootstrap library heals and keeps its rows, also on a second run", () => {
  const { applyMigrations } = require("../lib/apply-migrations.js");
  const dbPath = scratchDb();
  applyMigrations(`file:${dbPath}`, oldMigrationsDir());
  seedVideos(dbPath);
  const before = readAll(dbPath, "Video");
  assert.equal(before.length, 2);

  const first = applyMigrations(`file:${dbPath}`, migrationsDir);
  assert.deepEqual(first.applied, [TABLES_MIGRATION]);
  assert.deepEqual(first.skipped, OLD_MIGRATIONS);
  assert.deepEqual(readAll(dbPath, "Video"), before);
  assert.deepEqual(describeSchema(dbPath), expectedSchema());

  const second = applyMigrations(`file:${dbPath}`, migrationsDir);
  assert.deepEqual(second.applied, []);
  assert.deepEqual(readAll(dbPath, "Video"), before);
  assert.deepEqual(describeSchema(dbPath), expectedSchema());
});

test("a dev library whose tables came from db push keeps its settings", () => {
  const Database = require("better-sqlite3");
  const { applyMigrations } = require("../lib/apply-migrations.js");
  const dbPath = scratchDb();
  applyMigrations(`file:${dbPath}`, oldMigrationsDir());
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE "Setting" ("key" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL, "updatedAt" DATETIME NOT NULL);
    CREATE TABLE "ProviderConfig" ("id" TEXT NOT NULL PRIMARY KEY, "provider" TEXT NOT NULL, "apiKey" TEXT NOT NULL, "model" TEXT, "baseUrl" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true, "priority" INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL);
    CREATE TABLE "DailyUsage" ("id" TEXT NOT NULL PRIMARY KEY, "date" TEXT NOT NULL, "provider" TEXT NOT NULL, "seconds" REAL NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX "DailyUsage_date_provider_key" ON "DailyUsage"("date", "provider");
    INSERT INTO "Setting" VALUES ('whisper_priority', '2', '2026-10-01T00:00:00.000Z');
    INSERT INTO "ProviderConfig" ("id", "provider", "apiKey", "updatedAt") VALUES ('p1', 'groq', 'enc:v1:abc', '2026-10-01T00:00:00.000Z');
    INSERT INTO "DailyUsage" VALUES ('d1', '2026-10-01', 'groq', 12.5);
  `);
  db.close();
  seedVideos(dbPath);
  const before = ["Setting", "ProviderConfig", "DailyUsage", "Video"].map((t) =>
    readAll(dbPath, t)
  );

  const result = applyMigrations(`file:${dbPath}`, migrationsDir);
  assert.deepEqual(result.applied, [TABLES_MIGRATION]);
  assert.deepEqual(
    ["Setting", "ProviderConfig", "DailyUsage", "Video"].map((t) => readAll(dbPath, t)),
    before
  );
  assert.deepEqual(describeSchema(dbPath), expectedSchema());
});

test("the tables migration SQL can run twice on the same database", () => {
  const Database = require("better-sqlite3");
  const { applyMigrations } = require("../lib/apply-migrations.js");
  const dbPath = scratchDb();
  applyMigrations(`file:${dbPath}`, migrationsDir);
  recordMigrations(dbPath, []);
  const sql = fs.readFileSync(
    path.join(migrationsDir, TABLES_MIGRATION, "migration.sql"),
    "utf8"
  );
  const db = new Database(dbPath);
  db.exec(sql);
  db.exec(sql);
  db.close();
  assert.deepEqual(describeSchema(dbPath), expectedSchema());
});

test("the startup secrets check reads ProviderConfig and Setting on a fresh library", async () => {
  const { applyMigrations } = require("../lib/apply-migrations.js");
  const { ensureSecretsMigrated } = require("../lib/secrets-store.js");
  const { PrismaClient } = require("@prisma/client");
  const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
  const dbPath = scratchDb();
  applyMigrations(`file:${dbPath}`, migrationsDir);
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${dbPath}` }),
  });
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const result = await ensureSecretsMigrated(async () => prisma);
    assert.doesNotMatch(String(result.reason || ""), /no such table/);
  } finally {
    console.error = originalError;
    await prisma.$disconnect();
  }
  assert.deepEqual(
    errors.filter((line) => line.includes("Migration failed")),
    []
  );
});

test("concurrent applyMigrations does not throw table already exists", async () => {
  const { spawnSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-migrate-race-"));
  const dbPath = path.join(dir, "test.db");
  const script = path.join(dir, "apply.js");
  fs.writeFileSync(
    script,
    `
      const { applyMigrations } = require(${JSON.stringify(path.join(projectRoot, "lib/apply-migrations.js"))});
      applyMigrations(${JSON.stringify(`file:${dbPath}`)}, ${JSON.stringify(migrationsDir)});
    `
  );
  const workers = Array.from({ length: 2 }, () =>
    spawnSync(process.execPath, [script], { encoding: "utf8" })
  );
  for (const worker of workers) {
    assert.equal(worker.status, 0, worker.stderr || worker.stdout);
  }
  const Database = require("better-sqlite3");
  const db = new Database(dbPath, { readonly: true });
  assert.ok(
    db.prepare("SELECT name FROM sqlite_master WHERE name='Video'").get()
  );
  db.close();
});

test("applyMigrations is idempotent", async () => {
  const { applyMigrations } = require("../lib/apply-migrations.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-migrate-"));
  const dbPath = path.join(dir, "test.db");
  const migrationsDir = path.join(projectRoot, "prisma", "migrations");

  const first = applyMigrations(`file:${dbPath}`, migrationsDir);
  const second = applyMigrations(`file:${dbPath}`, migrationsDir);
  assert.ok(first.applied.length >= 1);
  assert.equal(second.applied.length, 0);
  assert.equal(second.skipped.length, first.applied.length);
});
