import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { ProviderType } from "@/lib/providers";

const VALID_PROVIDERS = ["openrouter", "groq", "custom"];

function maskApiKey(key: string): string {
  if (key.length <= 4) return "****";
  return "*".repeat(key.length - 4) + key.slice(-4);
}

export async function GET() {
  try {
    const providers = await prisma.providerConfig.findMany({
      orderBy: { priority: "asc" },
    });

    const masked = providers.map((p) => ({
      ...p,
      apiKey: maskApiKey(p.apiKey),
    }));

    return NextResponse.json(masked);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load providers" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, provider, apiKey, model, baseUrl, enabled, priority } = body as {
      id?: string;
      provider: ProviderType;
      apiKey: string;
      model?: string;
      baseUrl?: string;
      enabled?: boolean;
      priority?: number;
    };

    if (id) {
      // Partial update — only set fields that were provided
      const data: Record<string, unknown> = {};
      if (provider !== undefined) data.provider = provider;
      if (apiKey && !apiKey.startsWith("***")) data.apiKey = apiKey.trim();
      if (model !== undefined) data.model = model?.trim() || null;
      if (baseUrl !== undefined) data.baseUrl = baseUrl?.trim() || null;
      if (enabled !== undefined) data.enabled = enabled;
      if (priority !== undefined) data.priority = priority;

      const updated = await prisma.providerConfig.update({
        where: { id },
        data,
      });
      return NextResponse.json({ ...updated, apiKey: maskApiKey(updated.apiKey) });
    }

    // Create new — require provider and apiKey
    if (!provider || !VALID_PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: `Invalid provider: ${provider}. Must be one of: ${VALID_PROVIDERS.join(", ")}` },
        { status: 400 }
      );
    }

    if (!apiKey || apiKey.trim().length === 0) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 }
      );
    }

    if (provider === "custom" && (!baseUrl || baseUrl.trim().length === 0)) {
      return NextResponse.json(
        { error: "Base URL is required for custom providers" },
        { status: 400 }
      );
    }

    const created = await prisma.providerConfig.create({
      data: {
        provider,
        apiKey: apiKey.trim(),
        model: model?.trim() || null,
        baseUrl: baseUrl?.trim() || null,
        enabled: enabled ?? true,
        priority: priority ?? 0,
      },
    });
    return NextResponse.json(
      { ...created, apiKey: maskApiKey(created.apiKey) },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save provider" },
      { status: 500 }
    );
  }
}
