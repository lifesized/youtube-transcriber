import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { applyMigrations } = require("../lib/apply-migrations.js");

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-sum-"));
const dbPath = path.join(dir, "sum.db");
process.env.DATABASE_URL = `file:${dbPath}`;
applyMigrations(`file:${dbPath}`, path.join(projectRoot, "prisma/migrations"));

test("summarize caches baseSummary and only calls the provider once", async () => {
  const db = new Database(dbPath);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO Video
      (id, videoId, captionLanguage, pipelineVersion, title, author, videoUrl, transcript, createdAt, updatedAt)
     VALUES (?, ?, 'en', 1, ?, 'A', 'https://youtu.be/sumvid1', ?, ?, ?)`
  ).run(
    "sum1",
    "sumvid1",
    "Sum Title",
    JSON.stringify([{ text: "hello", startMs: 0, durationMs: 1000 }]),
    now,
    now
  );
  db.close();

  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Cached summary body" } }],
      }),
    };
  };

  const { summarize } = await import("../lib/summarize.ts");
  const row = {
    videoId: "sumvid1",
    title: "Sum Title",
    transcript: JSON.stringify([{ text: "hello", startMs: 0, durationMs: 1000 }]),
    captionLanguage: "en",
  };
  const first = await summarize(row, 1, {
    fetchImpl,
    provider: "openai",
    apiKey: "sk-test",
  });
  const second = await summarize(row, 1, {
    fetchImpl,
    provider: "openai",
    apiKey: "sk-test",
  });
  assert.equal(first, "Cached summary body");
  assert.equal(second, "Cached summary body");
  assert.equal(calls, 1);

  const bodies = [];
  const qaFetch = async (_url, init) => {
    calls += 1;
    bodies.push(JSON.parse(init.body));
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "The decision was to ship Tusk." } }],
      }),
    };
  };
  const qa = await summarize(row, 1, {
    fetchImpl: qaFetch,
    provider: "openai",
    apiKey: "sk-test",
    promptOverride: "Answer only: what was the decision?",
  });
  assert.equal(qa, "The decision was to ship Tusk.");
  assert.match(JSON.stringify(bodies[0]), /what was the decision/);
  const third = await summarize(row, 1, {
    fetchImpl: qaFetch,
    provider: "openai",
    apiKey: "sk-test",
  });
  assert.equal(third, "Cached summary body");
  assert.equal(third.includes("ship Tusk"), false);
  assert.equal(calls, 2);
});
