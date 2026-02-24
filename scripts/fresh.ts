#!/usr/bin/env tsx
/**
 * Full clean-slate reset for first-time UX testing
 *
 * Backs up library → deletes DB + build cache → recreates empty DB
 *
 * Usage:
 *   npm run fresh
 *   tsx scripts/fresh.ts
 */

import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { backupLibrary } from './backup';

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./dev.db',
});
const prisma = new PrismaClient({ adapter });

async function main() {
  try {
    // 1. Auto-backup first (safety net)
    console.log('Step 1: Backing up library...');
    const backupPath = await backupLibrary();

    // Disconnect before deleting the DB file
    await prisma.$disconnect();

    // 2. Delete database
    console.log('\nStep 2: Removing database...');
    const dbPath = path.join(process.cwd(), 'dev.db');
    const journalPath = dbPath + '-journal';
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(journalPath)) fs.unlinkSync(journalPath);
    console.log('✓ Database removed.');

    // 3. Delete build cache
    console.log('\nStep 3: Clearing build cache...');
    const nextDir = path.join(process.cwd(), '.next');
    if (fs.existsSync(nextDir)) {
      fs.rmSync(nextDir, { recursive: true, force: true });
      console.log('✓ .next/ cleared.');
    } else {
      console.log('✓ No build cache to clear.');
    }

    // 4. Recreate empty database
    console.log('\nStep 4: Recreating empty database...');
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    console.log('✓ Empty database ready.');

    // 5. Print instructions
    console.log('\n' + '─'.repeat(50));
    console.log('✓ Clean slate ready!\n');
    console.log('  npm run dev        → test the first-time experience');
    if (backupPath) {
      console.log('  npm run restore    → get your library back');
    }
    console.log('─'.repeat(50));

  } catch (error) {
    console.error('Error during fresh reset:', error);
    process.exit(1);
  }
}

main();
