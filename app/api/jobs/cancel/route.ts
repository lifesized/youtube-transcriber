import { NextRequest, NextResponse } from "next/server";
import { cancelJob } from "@/lib/in-flight-jobs";

export async function POST(request: NextRequest) {
  let body: { jobId?: unknown } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const cancelled = cancelJob(jobId);
  return NextResponse.json(cancelled);
}
