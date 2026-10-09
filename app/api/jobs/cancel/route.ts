import { NextRequest, NextResponse } from "next/server";
import { cancelJob, cancelJobsByTag } from "@/lib/in-flight-jobs";

export async function POST(request: NextRequest) {
  let body: { jobId?: unknown; tag?: unknown } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const tag = typeof body.tag === "string" ? body.tag.trim() : "";

  if (jobId) {
    const cancelled = cancelJob(jobId, { tag: "tusk" });
    return NextResponse.json(cancelled);
  }

  if (tag === "tusk") {
    const cancelled = cancelJobsByTag("tusk");
    return NextResponse.json({ ok: true, ...cancelled });
  }

  return NextResponse.json(
    { error: "jobId is required, or tag must be tusk" },
    { status: 400 }
  );
}
