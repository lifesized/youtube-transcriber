"use client";

import { useState } from "react";
import { Metadata } from "next";

export default function WaitlistPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "already" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("loading");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        return;
      }

      setStatus(data.status === "already_signed_up" ? "already" : "success");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-4">
      <div className="w-full max-w-md text-center">
        {/* Logo / Title */}
        <h1 className="text-2xl font-semibold tracking-tight text-white/90">
          YouTube Transcriber
        </h1>
        <p className="mt-1 text-sm text-white/30">Cloud edition</p>

        {/* Value prop */}
        <div className="mt-8 space-y-3">
          <p className="text-[15px] leading-relaxed text-white/55">
            Transcribe any YouTube video in seconds.
            <br />
            No install. No Python. No local setup.
          </p>
          <div className="flex justify-center gap-6 text-[12px] text-white/25">
            <span>Captions + Whisper</span>
            <span>·</span>
            <span>Searchable library</span>
            <span>·</span>
            <span>LLM export</span>
          </div>
        </div>

        {/* Form */}
        {status === "success" || status === "already" ? (
          <div className="mt-10 rounded-xl border border-white/10 bg-white/[0.03] p-6">
            <p className="text-sm text-white/70">
              {status === "already"
                ? "You're already on the list. We'll be in touch."
                : "You're in. We'll email you when it's ready."}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-10">
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                required
                className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white/90 placeholder-white/20 outline-none transition-colors focus:border-white/25 focus:bg-white/[0.06]"
              />
              <button
                type="submit"
                disabled={status === "loading"}
                className="rounded-lg border border-white/15 bg-white/10 px-5 py-2.5 text-sm font-medium text-white/80 transition-all hover:bg-white/15 hover:text-white disabled:opacity-50"
              >
                {status === "loading" ? "..." : "Join waitlist"}
              </button>
            </div>
            {status === "error" && (
              <p className="mt-3 text-xs text-red-400/70">Something went wrong. Try again.</p>
            )}
          </form>
        )}

        {/* Footer */}
        <div className="mt-12 flex items-center justify-center gap-4 text-[11px] text-white/15">
          <a
            href="https://github.com/lifesized/youtube-transcriber"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-white/35"
          >
            GitHub
          </a>
          <span>·</span>
          <span>Free &amp; open source</span>
        </div>
      </div>
    </div>
  );
}
