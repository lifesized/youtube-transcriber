import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
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
