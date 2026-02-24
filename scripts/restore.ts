#!/usr/bin/env tsx
/**
 * Restore transcript library from a JSON backup file
 *
 * Usage:
 *   npm run restore                    # auto-detect latest backup
 *   npm run restore -- path/to/file    # specific backup file
 *   tsx scripts/restore.ts [path]
 */

import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./dev.db',
});
const prisma = new PrismaClient({ adapter });

function findLatestBackup(): string | null {
  const backupsDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupsDir)) return null;

  const files = fs.readdirSync(backupsDir)
    .filter((f) => f.startsWith('library-') && f.endsWith('.json'))
    .sort()
    .reverse();

  return files.length > 0 ? path.join(backupsDir, files[0]) : null;
}

async function main() {
  try {
    const arg = process.argv[2];
    const filepath = arg || findLatestBackup();

    if (!filepath || !fs.existsSync(filepath)) {
      console.log('No backup file found. Run `npm run backup` first.');
      process.exit(1);
    }

    console.log(`Restoring from: ${path.relative(process.cwd(), filepath)}`);

    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));

    if (!Array.isArray(data) || data.length === 0) {
      console.log('Backup file is empty or invalid.');
      process.exit(1);
    }

    let restored = 0;
    let skipped = 0;

    for (const video of data) {
      const exists = await prisma.video.findUnique({
        where: { videoId: video.videoId },
      });

      if (exists) {
        skipped++;
        continue;
      }

      await prisma.video.create({
        data: {
          videoId: video.videoId,
          title: video.title,
          author: video.author,
          channelUrl: video.channelUrl ?? null,
          thumbnailUrl: video.thumbnailUrl ?? null,
          videoUrl: video.videoUrl,
          transcript: video.transcript,
          source: video.source ?? 'youtube_captions',
          createdAt: new Date(video.createdAt),
        },
      });
      restored++;
    }

    console.log(`✓ Restored ${restored} transcript(s), skipped ${skipped} duplicate(s).`);
  } catch (error) {
    console.error('Error restoring:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
