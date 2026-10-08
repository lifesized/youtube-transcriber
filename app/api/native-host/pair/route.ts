import { NextRequest, NextResponse } from "next/server";
import { handlePairPost } from "@/lib/native-host-pair.js";

export async function POST(request: NextRequest) {
  // Extension ID is taken ONLY from Origin. The body is never read.
  const origin = request.headers.get("origin");
  const result = await handlePairPost(origin);
  return NextResponse.json(result.body, { status: result.status });
}
