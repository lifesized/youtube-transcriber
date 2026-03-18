"use client";

import { useState } from "react";

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
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes subtleGlow {
          0%, 100% { opacity: 0.03; }
          50% { opacity: 0.06; }
        }
        .anim-fade-in { animation: fadeIn 0.8s ease-out both; }
        .anim-fade-up-1 { animation: fadeUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both; }
        .anim-fade-up-2 { animation: fadeUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both; }
        .anim-fade-up-3 { animation: fadeUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both; }
        .anim-fade-up-4 { animation: fadeUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.4s both; }
        .anim-fade-in-late { animation: fadeIn 0.8s ease-out 0.6s both; }
      `}</style>

      <div className="flex min-h-[100dvh] items-center justify-center bg-[#0a0a0a] px-4 py-6 relative overflow-hidden" style={{ fontFamily: '"Outfit", -apple-system, sans-serif' }}>
        {/* Ambient glow */}
        <div
          className="absolute top-[35%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none"
          style={{
            background: "radial-gradient(circle, rgba(255,255,255,0.04) 0%, transparent 70%)",
            animation: "subtleGlow 8s ease-in-out infinite",
          }}
        />

        <div className="w-full max-w-[440px] relative">
          {/* Label */}
          <p className="anim-fade-in text-[11px] font-medium uppercase tracking-[0.08em] text-white/20 m-0">
            YouTube Transcriber
          </p>

          {/* Headline */}
          <h1 className="anim-fade-up-1 text-[32px] font-semibold tracking-tight leading-[1.15] text-white/[0.92] mt-4">
            Stop watching.<br />Start reading.
          </h1>

          {/* Subline */}
          <p className="anim-fade-up-2 text-[15px] leading-relaxed text-white/45 mt-5 max-w-[360px]">
            Paste any YouTube link. Get a clean, searchable transcript you can send straight to an LLM.
          </p>

          {/* Feature pills */}
          <div className="anim-fade-up-3 flex gap-2 mt-4 flex-wrap">
            {["Works with or without captions", "Searchable library", "Private by default"].map((label) => (
              <span
                key={label}
                className="text-[11px] text-white/25 border border-white/[0.08] rounded-full px-3 py-1 transition-colors hover:text-white/40"
              >
                {label}
              </span>
            ))}
          </div>

          {/* Form / Success */}
          <div className="anim-fade-up-4">
            {status === "success" || status === "already" ? (
              <div className="mt-9 border-l-2 border-white/15 pl-4">
                <p className="text-sm text-white/60 leading-normal">
                  {status === "already"
                    ? "You\u2019re already on the list. We\u2019ll be in touch."
                    : "You\u2019re in. We\u2019ll email you when it\u2019s ready."}
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-9">
                <div className="flex rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden transition-colors duration-200 focus-within:border-white/20">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@email.com"
                    required
                    className="flex-1 bg-transparent px-4 py-3 text-sm text-white/90 placeholder-white/20 outline-none"
                    style={{ fontFamily: '"Outfit", sans-serif' }}
                  />
                  <button
                    type="submit"
                    disabled={status === "loading"}
                    className="m-[5px] rounded-lg bg-white/10 px-5 py-2 text-[13px] font-medium text-white/80 whitespace-nowrap transition-all duration-200 hover:bg-white/[0.18] hover:text-white/95 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none"
                    style={{ fontFamily: '"Outfit", sans-serif' }}
                  >
                    {status === "loading" ? "..." : "Join waitlist"}
                  </button>
                </div>
                {status === "error" && (
                  <p className="mt-3 text-xs text-[rgba(220,80,80,0.8)]">Something went wrong. Try again.</p>
                )}
              </form>
            )}
          </div>

          {/* Footer */}
          <div className="anim-fade-in-late mt-14 flex items-center gap-3 text-[11px] text-white/[0.18]">
            <a
              href="https://github.com/lifesized/youtube-transcriber"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors duration-200 hover:text-white/40"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              GitHub
            </a>
            <span className="opacity-50">/</span>
            <span>Open source</span>
          </div>
        </div>
      </div>
    </>
  );
}
