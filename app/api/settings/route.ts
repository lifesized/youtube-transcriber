import { NextRequest, NextResponse } from "next/server";
import { stripSecretSettings } from "@/lib/helper-scope.js";
import { prisma } from "@/lib/prisma";
import {
  encryptApiKeyForStorage,
  isMaskedPlaceholder,
  maskApiKeyForResponse,
} from "@/lib/secrets-store.js";
import { SecretsKeyError } from "@/lib/secrets-crypto.js";

const ALLOWED_KEYS = [
  "groq_api_key",
  "whisper_cloud_provider",
  "whisper_cloud_model",
  "groq_usage_seconds",
  "groq_usage_date",
  "whisper_enabled",
  "whisper_priority",
  "groq_rate_limit",
];

export async function GET(request: NextRequest) {
  try {
    const settings = await prisma.setting.findMany({
      where: { key: { in: ALLOWED_KEYS } },
    });

    const result: Record<string, string> = {};
    for (const s of settings) {
      result[s.key] =
        s.key === "groq_api_key" ? maskApiKeyForResponse(s.value) : s.value;
    }

    if (request.headers.get("x-transcriber-helper")) {
      return NextResponse.json(stripSecretSettings(result));
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
      entries.map(async ([key, value]) => {
        if (key === "groq_api_key") {
          const row = await prisma.setting.findUnique({ where: { key } });
          const currentMasked = row ? maskApiKeyForResponse(row.value) : "";
          if (isMaskedPlaceholder(value, currentMasked)) {
            return;
          }
          const stored = encryptApiKeyForStorage(value);
          await prisma.setting.upsert({
            where: { key },
            update: { value: stored },
            create: { key, value: stored },
          });
          return;
        }
        await prisma.setting.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        });
      })
    );

    return NextResponse.json({
      saved: entries.map(([k]) => k),
    });
  } catch (e) {
    const status = e instanceof SecretsKeyError ? 503 : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save settings" },
      { status }
    );
  }
}
