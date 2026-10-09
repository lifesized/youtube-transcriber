import { NextRequest, NextResponse } from "next/server";
import { requestFromMain } from "@/lib/electron-ipc.js";
import { isSettingsPageWrite } from "@/lib/local-api-auth.js";
import { getExpectedToken } from "@/lib/local-api-token.js";

function unavailable() {
  return NextResponse.json(
    {
      error:
        "Tusk tokens are stored in the Transcriber app (Keychain). Open the menu-bar app to save them.",
    },
    { status: 503 }
  );
}

export async function GET() {
  try {
    const payload = await requestFromMain("tusk-get");
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load Tusk settings";
    if (message === "electron_ipc_unavailable") return unavailable();
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function tuskSettingsWriteAllowed(request: NextRequest) {
  return isSettingsPageWrite(
    {
      authorization: request.headers.get("authorization"),
      cookie: request.headers.get("cookie"),
      secFetchSite: request.headers.get("sec-fetch-site"),
    },
    getExpectedToken()
  );
}

export async function PUT(request: NextRequest) {
  if (!tuskSettingsWriteAllowed(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: {
    botToken?: string;
    appToken?: string;
    enabled?: boolean;
    channelAllowlist?: string | string[];
    resetWorkspace?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const payload = await requestFromMain("tusk-set", {
      botToken: body.botToken,
      appToken: body.appToken,
      enabled: body.enabled,
      channelAllowlist: body.channelAllowlist,
      resetWorkspace: body.resetWorkspace,
    });
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save";
    if (message === "electron_ipc_unavailable") return unavailable();
    const statusFromError =
      error instanceof Error && "status" in error
        ? Number((error as Error & { status?: number }).status)
        : 0;
    const status =
      statusFromError ||
      (/cancelled/i.test(message) ? 409 : 0) ||
      (/token|auth\.test|xoxb|xapp/i.test(message) ? 400 : 500);
    return NextResponse.json({ error: message }, { status });
  }
}
