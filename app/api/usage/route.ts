import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DAILY_LIMIT = 14_400;
const COST_PER_SECOND: Record<string, number> = {
  groq: 0.0001, // $0.006/min
};

export async function GET() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const today = `${year}-${month}-${day}`;
  const monthPrefix = `${year}-${month}`;

  // Backfill: if Settings has usage from a previous day not yet in DailyUsage, save it
  const [dateSetting, usageSetting] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "groq_usage_date" } }),
    prisma.setting.findUnique({ where: { key: "groq_usage_seconds" } }),
  ]);
  if (dateSetting?.value && dateSetting.value !== today && usageSetting?.value) {
    const prevSeconds = parseFloat(usageSetting.value);
    if (prevSeconds > 0) {
      await prisma.dailyUsage.upsert({
        where: { date_provider: { date: dateSetting.value, provider: "groq" } },
        update: { seconds: prevSeconds },
        create: { date: dateSetting.value, provider: "groq", seconds: prevSeconds },
      });
    }
  }

  const rows = await prisma.dailyUsage.findMany({
    where: { date: { startsWith: monthPrefix } },
    orderBy: { date: "asc" },
  });

  const days = rows.map((r) => {
    const overage = Math.max(0, r.seconds - DAILY_LIMIT);
    const rate = COST_PER_SECOND[r.provider] ?? 0;
    return {
      date: r.date,
      provider: r.provider,
      seconds: r.seconds,
      overageSeconds: overage,
      cost: parseFloat((overage * rate).toFixed(4)),
    };
  });

  const totalCost = days.reduce((sum, d) => sum + d.cost, 0);
  const totalSeconds = days.reduce((sum, d) => sum + d.seconds, 0);

  return NextResponse.json({ month: monthPrefix, totalCost, totalSeconds, days });
}
