#!/usr/bin/env tsx
/**
 * Reset database to test first-time user experience
 *
 * Usage:
 *   npm run reset-data
 *   bun run reset-data
 *   tsx scripts/reset-data.ts
 */

import { PrismaClient } from '@prisma/client';
import * as readline from 'readline';

const prisma = new PrismaClient();

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function resetDatabase() {
  try {
    // Count existing transcripts
    const count = await prisma.video.count();

    if (count === 0) {
      console.log('✓ Database is already empty. Nothing to reset.');
      return;
    }

    console.log(`Found ${count} transcript(s) in database.`);

    const confirmed = await confirm(
      '\n⚠️  This will DELETE ALL transcripts. Are you sure? (y/N): '
    );

    if (!confirmed) {
      console.log('Cancelled. No changes made.');
      return;
    }

    // Delete all videos
    await prisma.video.deleteMany({});

    console.log('\n✓ Database reset successfully!');
    console.log('→ You can now test the first-time user experience.');

  } catch (error) {
    console.error('Error resetting database:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

resetDatabase();
