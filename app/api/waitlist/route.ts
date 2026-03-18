import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Resend } from "resend";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }

    const existing = await prisma.waitlistSignup.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ status: "already_signed_up" });
    }

    await prisma.waitlistSignup.create({ data: { email } });

    // Send notification email via Resend
    const apiKey = process.env.RESEND_API_KEY;
    const notifyEmail = process.env.WAITLIST_NOTIFY_EMAIL;

    if (apiKey && notifyEmail) {
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from: "YouTube Transcriber <onboarding@resend.dev>",
        to: notifyEmail,
        subject: `New waitlist signup: ${email}`,
        text: `${email} just joined the YouTube Transcriber cloud waitlist.`,
      }).catch((err) => {
        console.error("[waitlist] Failed to send notification:", err);
      });
    }

    // Append to Google Sheet via Apps Script webhook
    const sheetWebhook = process.env.WAITLIST_SHEET_WEBHOOK;
    if (sheetWebhook) {
      fetch(sheetWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }).catch((err) => {
        console.error("[waitlist] Failed to append to sheet:", err);
      });
    }

    return NextResponse.json({ status: "success" });
  } catch (err) {
    console.error("[waitlist] Error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
