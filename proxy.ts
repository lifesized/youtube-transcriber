import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { localApiAuthDecision } from "./lib/local-api-token.js";

/**
 * Next.js 16 request gate (the Node.js successor to middleware.ts).
 * Edge middleware cannot read the token file, so auth lives here.
 * The bearer value is never logged.
 */
export function proxy(request: NextRequest) {
  const decision = localApiAuthDecision(request.headers.get("authorization"));
  if (!decision.ok) {
    return NextResponse.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "WWW-Authenticate": "Bearer",
          "X-Transcriber-Service": "1",
        },
      }
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
