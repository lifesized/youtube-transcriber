import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  decryptApiKeyForUse,
  SecretsKeyError,
} from "@/lib/secrets-store.js";

export async function POST() {
  try {
    // Get API key from DB first, fall back to env
    const dbKey = await prisma.setting.findUnique({
      where: { key: "groq_api_key" },
    });
    let apiKey: string | undefined;
    if (dbKey?.value?.trim()) {
      apiKey = decryptApiKeyForUse(dbKey.value);
    } else {
      apiKey = process.env.WHISPER_CLOUD_API_KEY?.trim();
    }

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "No Groq API key configured" },
        { status: 400 }
      );
    }

    // Lightweight call: list models (no audio processing needed)
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message =
        (body as Record<string, { message?: string }>)?.error?.message ||
        `HTTP ${res.status}`;
      return NextResponse.json(
        { success: false, error: message },
        { status: 200 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof SecretsKeyError) {
      return NextResponse.json(
        { success: false, error: e.message },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Connection test failed",
      },
      { status: 200 }
    );
  }
}
