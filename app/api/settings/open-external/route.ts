import { NextRequest, NextResponse } from "next/server";
import { createRequire } from "node:module";
import { requestFromMain } from "@/lib/electron-ipc.js";
import { isSettingsPageWrite } from "@/lib/local-api-auth.js";
import { getExpectedToken } from "@/lib/local-api-token.js";

const require = createRequire(import.meta.url);
const { isAllowedLlmKeyUrl } = require("../../../../electron/tusk/llm-links.js") as {
  isAllowedLlmKeyUrl: (value: unknown) => boolean;
};

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

export async function POST(request: NextRequest) {
  if (!settingsWriteAllowed(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url : "";
  if (!isAllowedLlmKeyUrl(url)) {
    return NextResponse.json({ error: "unsupported url" }, { status: 400 });
  }
  try {
    await requestFromMain("open-external", { url });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open";
    if (message === "electron_ipc_unavailable") {
      return NextResponse.json(
        { error: "Open this page from the Transcriber menu bar." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
