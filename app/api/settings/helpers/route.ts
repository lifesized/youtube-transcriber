import { NextRequest, NextResponse } from "next/server";
import { requestFromMain } from "@/lib/electron-ipc.js";
import { isSettingsPageWrite } from "@/lib/local-api-auth.js";
import { getExpectedToken } from "@/lib/local-api-token.js";

function unavailable() {
  return NextResponse.json(
    { error: "Helpers are managed by the Transcriber menu-bar app." },
    { status: 503 }
  );
}

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

export async function GET() {
  try {
    const payload = await requestFromMain("helpers-get");
    return NextResponse.json(payload || { helpers: [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load helpers";
    if (message === "electron_ipc_unavailable") return NextResponse.json({ helpers: [] });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!settingsWriteAllowed(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { id?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const allowed = new Set(["start", "stop", "enable", "disable", "revoke"]);
  const action = allowed.has(body.action || "") ? body.action : "";
  if (!action) return NextResponse.json({ error: "action is required" }, { status: 400 });
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    const payload = await requestFromMain("helpers-set", { id, action });
    return NextResponse.json(payload || { helpers: [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update helper";
    if (message === "electron_ipc_unavailable") return unavailable();
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
