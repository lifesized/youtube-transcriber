import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ALLOWED_KEYS = [
  "groq_api_key",
  "whisper_cloud_provider",
  "whisper_cloud_model",
  "groq_usage_seconds",
  "groq_usage_date",
];

function maskApiKey(key: string): string {
  if (key.length <= 4) return "****";
  return "*".repeat(key.length - 4) + key.slice(-4);
}

export async function GET() {
  try {
    const settings = await prisma.setting.findMany({
      where: { key: { in: ALLOWED_KEYS } },
    });

    const result: Record<string, string> = {};
    for (const s of settings) {
      result[s.key] =
        s.key === "groq_api_key" ? maskApiKey(s.value) : s.value;
    }

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load settings" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Record<string, string>;

    const entries = Object.entries(body).filter(([k]) =>
      ALLOWED_KEYS.includes(k)
    );

    if (entries.length === 0) {
      return NextResponse.json(
        { error: "No valid settings provided" },
        { status: 400 }
      );
    }

    await Promise.all(
      entries.map(([key, value]) =>
        prisma.setting.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        })
      )
    );

    return NextResponse.json({ saved: entries.map(([k]) => k) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save settings" },
      { status: 500 }
    );
  }
}
