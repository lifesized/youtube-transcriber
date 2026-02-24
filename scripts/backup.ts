#!/usr/bin/env tsx
/**
 * Export transcript library to a JSON backup file
 *
 * Usage:
 *   npm run backup
 *   tsx scripts/backup.ts
 */

import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./dev.db',
});
const prisma = new PrismaClient({ adapter });

export async function backupLibrary(): Promise<string | null> {
  const count = await prisma.video.count();

  if (count === 0) {
    console.log('✓ Database is empty. Nothing to back up.');
    return null;
  }

  const videos = await prisma.video.findMany({
    orderBy: { createdAt: 'asc' },
  });

  const backupsDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[T]/g, '-')
    .replace(/[:.]/g, '')
    .slice(0, 17);
  const filename = `library-${timestamp}.json`;
  const filepath = path.join(backupsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(videos, null, 2));

  console.log(`✓ Backed up ${count} transcript(s) to backups/${filename}`);
  return filepath;
}

async function main() {
  try {
    await backupLibrary();
  } catch (error) {
    console.error('Error backing up:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
