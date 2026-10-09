import { NextResponse } from "next/server";
import { cancelInFlightJobs } from "@/lib/in-flight-jobs";

export async function POST() {
  const cancelled = cancelInFlightJobs();
  return NextResponse.json({ ok: true, ...cancelled });
}
