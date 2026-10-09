"use strict";

/**
 * Apply Prisma SQL migrations with better-sqlite3.
 * The packaged Electron app does not ship the Prisma CLI, so the Next.js
 * server applies pending migrations on boot before opening PrismaClient.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function dbPathFromUrl(databaseUrl) {
  if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
    throw new Error("DATABASE_URL is required to apply migrations");
  }
  const stripped = databaseUrl.replace(/^file:/, "");
  return path.resolve(stripped);
}

function resolveMigrationsDir(explicit) {
  if (explicit && fs.existsSync(explicit)) return explicit;
  const fromEnv = process.env.PRISMA_MIGRATIONS_DIR;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const fromCwd = path.join(process.cwd(), "prisma", "migrations");
  if (fs.existsSync(fromCwd)) return fromCwd;
  return fromCwd;
}

function listMigrationNames(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }
  return fs
    .readdirSync(migrationsDir)
    .filter((name) =>
      fs.existsSync(path.join(migrationsDir, name, "migration.sql"))
    )
    .sort();
}

/**
 * @param {string} databaseUrl
 * @param {string} [migrationsDir]
 * @returns {{ applied: string[], skipped: string[], dbPath: string }}
 */
function applyMigrations(databaseUrl, migrationsDir) {
  const Database = require("better-sqlite3");
  const dbPath = dbPathFromUrl(databaseUrl);
  const dir = resolveMigrationsDir(migrationsDir);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("busy_timeout = 8000");
  try {
    // One exclusive transaction so two Next collect-page workers cannot both
    // apply 0001_init and hit "table Video already exists".
    db.exec("BEGIN IMMEDIATE");
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

    const appliedRows = db
      .prepare(
        "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL"
      )
      .all();
    const already = new Set(appliedRows.map((row) => row.migration_name));
    const names = listMigrationNames(dir);
    const applied = [];
    const skipped = [];
    const insert = db.prepare(
      `INSERT INTO _prisma_migrations
        (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count)
       VALUES (?, ?, ?, ?, NULL, ?, 1)`
    );

    for (const name of names) {
      if (already.has(name)) {
        skipped.push(name);
        continue;
      }
      const sql = fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      const now = new Date().toISOString();
      db.exec(sql);
      insert.run(crypto.randomUUID(), checksum, now, name, now);
      applied.push(name);
    }

    db.exec("COMMIT");
    return { applied, skipped, dbPath };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // not in a transaction
    }
    throw error;
  } finally {
    db.close();
  }
}

module.exports = {
  applyMigrations,
  dbPathFromUrl,
  resolveMigrationsDir,
  listMigrationNames,
};
