import { NextRequest, NextResponse } from "next/server";
import { getSecretsFromMainOrEnv, requestFromMain } from "@/lib/electron-ipc.js";

function mask(value: string) {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

export async function GET() {
  try {
    const secrets = await getSecretsFromMainOrEnv();
    return NextResponse.json({
      hasToken: Boolean(secrets.notionToken),
      tokenMasked: secrets.notionToken ? mask(secrets.notionToken) : "",
      databaseId: secrets.notionDatabaseId || "",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load Notion settings" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  let body: { token?: string; databaseId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const payload = await requestFromMain("secrets-set", {
      notionToken: body.token,
      notionDatabaseId: body.databaseId,
    });
    return NextResponse.json({
      hasToken: Boolean(payload?.hasNotionToken),
      tokenMasked: payload?.notionTokenMasked || "",
      databaseId: payload?.notionDatabaseId || body.databaseId || "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save";
    const status = message === "electron_ipc_unavailable" ? 503 : 500;
    return NextResponse.json(
      {
        error:
          status === 503
            ? "Notion credentials are stored in the Transcriber app (Keychain). Open the menu-bar app to save them."
            : message,
      },
      { status }
    );
  }
}
