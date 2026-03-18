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
    <div style={{
      display: "flex",
      minHeight: "100vh",
      alignItems: "center",
      justifyContent: "center",
      background: "#0a0a0a",
      padding: "16px",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      WebkitFontSmoothing: "antialiased",
    }}>
      <div style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", color: "rgba(255,255,255,0.9)", margin: 0 }}>
          YouTube Transcriber
        </h1>
        <p style={{ marginTop: 4, fontSize: 14, color: "rgba(255,255,255,0.3)" }}>Cloud edition</p>

        <div style={{ marginTop: 32 }}>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "rgba(255,255,255,0.55)", margin: 0 }}>
            Transcribe any YouTube video in seconds.<br />
            No install. No Python. No local setup.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 12, fontSize: 12, color: "rgba(255,255,255,0.25)" }}>
            <span>Captions + Whisper</span>
            <span>·</span>
            <span>Searchable library</span>
            <span>·</span>
            <span>LLM export</span>
          </div>
        </div>

        {status === "success" || status === "already" ? (
          <div style={{
            marginTop: 40,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.03)",
            padding: 24,
          }}>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", margin: 0 }}>
              {status === "already"
                ? "You're already on the list. We'll be in touch."
                : "You're in. We'll email you when it's ready."}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ marginTop: 40 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                required
                style={{
                  flex: 1,
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(255,255,255,0.04)",
                  padding: "10px 16px",
                  fontSize: 14,
                  color: "rgba(255,255,255,0.9)",
                  outline: "none",
                }}
              />
              <button
                type="submit"
                disabled={status === "loading"}
                style={{
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(255,255,255,0.1)",
                  padding: "10px 20px",
                  fontSize: 14,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.8)",
                  cursor: status === "loading" ? "default" : "pointer",
                  opacity: status === "loading" ? 0.5 : 1,
                }}
              >
                {status === "loading" ? "..." : "Join waitlist"}
              </button>
            </div>
            {status === "error" && (
              <p style={{ marginTop: 12, fontSize: 12, color: "rgba(239,68,68,0.7)" }}>
                Something went wrong. Try again.
              </p>
            )}
          </form>
        )}

        <div style={{ marginTop: 48, display: "flex", alignItems: "center", justifyContent: "center", gap: 16, fontSize: 11, color: "rgba(255,255,255,0.15)" }}>
          <a
            href="https://github.com/lifesized/youtube-transcriber"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit", textDecoration: "none" }}
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
