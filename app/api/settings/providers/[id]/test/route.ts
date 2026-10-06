import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { testProviderConnection } from "@/lib/providers";
import type { ProviderType } from "@/lib/providers";
import {
  decryptApiKeyForUse,
  SecretsKeyError,
} from "@/lib/secrets-store.js";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const config = await prisma.providerConfig.findUnique({ where: { id } });

    if (!config) {
      return NextResponse.json(
        { error: "Provider not found" },
        { status: 404 }
      );
    }

    const apiKey = decryptApiKeyForUse(config.apiKey);
    const result = await testProviderConnection(
      config.provider as ProviderType,
      apiKey,
      config.baseUrl
    );

    return NextResponse.json(result);
  } catch (e) {
    const status = e instanceof SecretsKeyError ? 503 : 500;
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Test failed" },
      { status }
    );
  }
}
