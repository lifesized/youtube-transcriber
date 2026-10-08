import { NextRequest, NextResponse } from "next/server";
import { requestFromMain } from "@/lib/electron-ipc.js";
import { getSecretsFromMainOrEnv } from "@/lib/electron-ipc.js";

const VALID = new Set(["anthropic", "openai"]);

function mask(value: string) {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

export async function GET() {
  try {
    const secrets = await getSecretsFromMainOrEnv();
    const provider = VALID.has(secrets.llmProvider) ? secrets.llmProvider : "";
    return NextResponse.json({
      provider,
      hasKey: Boolean(secrets.llmApiKey),
      keyMasked: secrets.llmApiKey ? mask(secrets.llmApiKey) : "",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load LLM settings" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  let body: { provider?: string; apiKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const provider = body.provider;
  if (provider && !VALID.has(provider)) {
    return NextResponse.json(
      { error: "provider must be anthropic or openai" },
      { status: 400 }
    );
  }
  try {
    const payload = await requestFromMain("secrets-set", {
      llmProvider: provider,
      llmApiKey: body.apiKey,
    });
    return NextResponse.json({
      provider: payload?.llmProvider || provider,
      hasKey: Boolean(payload?.hasLlmKey),
      keyMasked: payload?.llmKeyMasked || "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save";
    const status = message === "electron_ipc_unavailable" ? 503 : 500;
    return NextResponse.json(
      {
        error:
          status === 503
            ? "LLM keys are stored in the Transcriber app (Keychain). Open the menu-bar app to save them."
            : message,
      },
      { status }
    );
  }
}
