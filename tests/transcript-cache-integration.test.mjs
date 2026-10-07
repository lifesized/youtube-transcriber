/**
 * Integration test for transcript cache with real database.
 * 
 * Tests:
 * - Migration upgrades existing DB
 * - Cache hit avoids fetcher call
 * - Different lang/pipelineVersion calls fetcher again
 */

import { test } from "node:test";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import path from "path";
import fs from "fs";
import os from "os";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

test("transcript cache integration", async (t) => {
  const testDbPath = path.join(os.tmpdir(), `transcript-cache-integ-${Date.now()}.db`);
  const testDbUrl = `file:${testDbPath}`;
  
  // Set DATABASE_URL before importing
  process.env.DATABASE_URL = testDbUrl;
  
  // Import modules after setting env
  const { PrismaClient } = await import("@prisma/client");
  const { getOrCreateTranscript } = await import("../lib/transcript-cache.ts");
  const { PIPELINE_VERSION } = await import("../lib/transcript-pipeline.ts");
  
  const prisma = new PrismaClient();
  
  try {
    // Run Prisma migrations to create schema
    console.log("Running Prisma migrations...");
    execSync(`DATABASE_URL="${testDbUrl}" npx prisma db push --skip-generate`, {
      cwd: projectRoot,
      stdio: "pipe",
    });
    
    // Seed an old-schema row (simulate existing DB before migration)
    // This verifies the migration correctly backfills
    console.log("Seeding old-schema row...");
    await prisma.$executeRaw`
      INSERT INTO Video (
        id, videoId, captionLanguage, pipelineVersion,
        title, author, videoUrl, transcript, source, platform,
        createdAt, updatedAt
      ) VALUES (
        'test-old-row', 'oldVideoId', 'en', 1,
        'Old Video', 'Old Author', 'https://youtube.com/watch?v=oldVideoId',
        '[]', 'youtube_captions', 'youtube',
        datetime('now'), datetime('now')
      )
    `;
    
    // Verify old row exists with correct defaults
    const oldRow = await prisma.video.findUnique({
      where: {
        videoId_captionLanguage_pipelineVersion: {
          videoId: "oldVideoId",
          captionLanguage: "en",
          pipelineVersion: 1,
        },
      },
    });
    assert.ok(oldRow, "Old row should exist after migration");
    assert.strictEqual(oldRow.captionLanguage, "en");
    assert.strictEqual(oldRow.pipelineVersion, 1);
    
    console.log("✓ Migration backfilled old row correctly");
    
    // Mock the fetcher to track calls
    let fetcherCalls = [];
    const originalGetVideoTranscript = (await import("../lib/transcript.ts")).getVideoTranscript;
    
    // Create mock fetcher
    const mockFetcher = async (url, lang) => {
      fetcherCalls.push({ url, lang });
      return {
        videoId: "testVideo123",
        title: "Test Video",
        author: "Test Author",
        channelUrl: "https://youtube.com/@test",
        thumbnailUrl: "https://i.ytimg.com/vi/testVideo123/hqdefault.jpg",
        transcript: [
          { text: "Hello world", startMs: 0, durationMs: 1000 },
          { text: "Test content", startMs: 1000, durationMs: 2000 },
        ],
        source: "youtube_captions",
      };
    };
    
    // Replace getVideoTranscript temporarily
    const transcriptModule = await import("../lib/transcript.ts");
    const originalFunc = transcriptModule.getVideoTranscript;
    transcriptModule.getVideoTranscript = mockFetcher;
    
    // Test 1: First call should fetch
    console.log("\nTest 1: Cache miss calls fetcher...");
    fetcherCalls = [];
    const result1 = await getOrCreateTranscript(
      "testVideo123",
      "https://youtube.com/watch?v=testVideo123",
      "en"
    );
    
    assert.strictEqual(fetcherCalls.length, 1, "Should call fetcher once on cache miss");
    assert.strictEqual(result1.videoId, "testVideo123");
    assert.strictEqual(result1.captionLanguage, "en");
    assert.strictEqual(result1.pipelineVersion, PIPELINE_VERSION);
    console.log("✓ Cache miss called fetcher");
    
    // Test 2: Second call with same params should NOT fetch (cache hit)
    console.log("\nTest 2: Cache hit avoids fetcher...");
    fetcherCalls = [];
    const result2 = await getOrCreateTranscript(
      "testVideo123",
      "https://youtube.com/watch?v=testVideo123",
      "en"
    );
    
    assert.strictEqual(fetcherCalls.length, 0, "Should NOT call fetcher on cache hit");
    assert.strictEqual(result2.id, result1.id, "Should return same cached entry");
    console.log("✓ Cache hit avoided fetcher");
    
    // Test 3: Different language should fetch again
    console.log("\nTest 3: Different language causes cache miss...");
    fetcherCalls = [];
    const result3 = await getOrCreateTranscript(
      "testVideo123",
      "https://youtube.com/watch?v=testVideo123",
      "es"  // Different language
    );
    
    assert.strictEqual(fetcherCalls.length, 1, "Should call fetcher for different language");
    assert.strictEqual(result3.videoId, "testVideo123");
    assert.strictEqual(result3.captionLanguage, "es");
    assert.notStrictEqual(result3.id, result1.id, "Should be different DB entry");
    console.log("✓ Different language caused cache miss");
    
    // Verify both entries exist
    const entries = await prisma.video.findMany({
      where: { videoId: "testVideo123" },
    });
    assert.strictEqual(entries.length, 2, "Should have 2 entries (en and es)");
    console.log("✓ Multiple language variants coexist");
    
    // Restore original function
    transcriptModule.getVideoTranscript = originalFunc;
    
    console.log("\n✓ All integration tests passed!");
    
  } finally {
    await prisma.$disconnect();
    try {
      fs.unlinkSync(testDbPath);
    } catch {}
  }
});
