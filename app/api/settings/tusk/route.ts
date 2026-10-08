import { NextRequest, NextResponse } from "next/server";
import { requestFromMain } from "@/lib/electron-ipc.js";

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

export async function PUT(request: NextRequest) {
  let body: {
    botToken?: string;
    appToken?: string;
    enabled?: boolean;
    channelAllowlist?: string | string[];
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
    });
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save";
    if (message === "electron_ipc_unavailable") return unavailable();
    const status = /token|auth\.test|xoxb|xapp/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
