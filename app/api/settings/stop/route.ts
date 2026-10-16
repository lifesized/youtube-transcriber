import { NextRequest, NextResponse } from "next/server";
import { canStopViaElectronIpc, requestFromMain } from "@/lib/electron-ipc.js";
import { isSettingsPageWrite } from "@/lib/local-api-auth.js";
import { getExpectedToken } from "@/lib/local-api-token.js";

function settingsWriteAllowed(request: NextRequest) {
  return isSettingsPageWrite(
    {
      authorization: request.headers.get("authorization"),
      cookie: request.headers.get("cookie"),
      secFetchSite: request.headers.get("sec-fetch-site"),
    },
    getExpectedToken()
  );
}

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!settingsWriteAllowed(request)) return unauthorized();
  return NextResponse.json({ canStop: canStopViaElectronIpc() });
}

export async function POST(request: NextRequest) {
  if (!settingsWriteAllowed(request)) return unauthorized();
  if (!canStopViaElectronIpc()) {
    return NextResponse.json(
      { error: "Open this page from the Transcriber menu bar." },
      { status: 503 }
    );
  }
  try {
    await requestFromMain("server-stop");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't stop the server.";
    if (message === "electron_ipc_unavailable") {
      return NextResponse.json(
        { error: "Open this page from the Transcriber menu bar." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
