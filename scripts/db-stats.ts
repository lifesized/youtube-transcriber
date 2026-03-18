import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./dev.db',
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const videos = await prisma.video.findMany({ select: { title: true, transcript: true, source: true } });

  const durations = videos.map(v => {
    const segs = JSON.parse(v.transcript);
    if (segs.length === 0) return { title: v.title.slice(0, 50), mins: 0, source: v.source };
    const last = segs[segs.length - 1];
    const mins = ((last.startMs + last.durationMs) / 1000 / 60);
    return { title: v.title.slice(0, 50), mins: +mins.toFixed(1), source: v.source };
  }).sort((a, b) => b.mins - a.mins);

  console.table(durations);

  const total = durations.reduce((s, v) => s + v.mins, 0);
  const over50 = durations.filter(v => v.mins > 50);
  const over25 = durations.filter(v => v.mins > 25);

  console.log('\n--- Summary ---');
  console.log('Total videos:            ', durations.length);
  console.log('Total minutes:           ', total.toFixed(1));
  console.log('Avg minutes:             ', (total / durations.length).toFixed(1));
  console.log('Longest:                 ', durations[0]?.mins, 'mins —', durations[0]?.title);
  console.log('Shortest:                ', durations[durations.length - 1]?.mins, 'mins');
  console.log('Over 50 mins (oq cap): ', over50.length, 'videos');
  console.log('Over 25 mins:            ', over25.length, 'videos');

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
