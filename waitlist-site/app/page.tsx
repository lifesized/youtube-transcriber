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
        .waitlist-form-container:focus-within {
          border-color: rgba(255,255,255,0.2) !important;
        }
        .waitlist-btn:hover:not(:disabled) {
          background: rgba(255,255,255,0.18) !important;
          color: rgba(255,255,255,0.95) !important;
        }
        .waitlist-btn:active:not(:disabled) {
          transform: scale(0.97);
        }
        .footer-link:hover {
          color: rgba(255,255,255,0.5) !important;
        }
        .pill:hover {
          color: rgba(255,255,255,0.4) !important;
        }
      `}</style>

      <div style={{
        display: "flex",
        minHeight: "100dvh",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0a",
        padding: "24px 16px",
        fontFamily: '"Outfit", -apple-system, sans-serif',
        WebkitFontSmoothing: "antialiased",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Ambient glow */}
        <div style={{
          position: "absolute",
          top: "35%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.04) 0%, transparent 70%)",
          animation: "subtleGlow 8s ease-in-out infinite",
          pointerEvents: "none",
        }} />

        <div style={{ width: "100%", maxWidth: 440, position: "relative" }}>
          {/* Label */}
          <p style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase" as const,
            color: "rgba(255,255,255,0.2)",
            margin: 0,
            animation: "fadeIn 0.8s ease-out both",
          }}>
            YouTube Transcriber
          </p>

          {/* Headline */}
          <h1 style={{
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: "-0.03em",
            lineHeight: 1.15,
            color: "rgba(255,255,255,0.92)",
            margin: "16px 0 0",
            animation: "fadeUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both",
          }}>
            Stop watching.<br />Start reading.
          </h1>

          {/* Subline */}
          <p style={{
            fontSize: 15,
            lineHeight: 1.65,
            color: "rgba(255,255,255,0.45)",
            margin: "20px 0 0",
            maxWidth: 360,
            animation: "fadeUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both",
          }}>
            Paste any YouTube link. Get a clean, searchable transcript you can send straight to an LLM. No setup required.
          </p>

          {/* Feature pills */}
          <div style={{
            display: "flex",
            gap: 8,
            marginTop: 16,
            flexWrap: "wrap",
            animation: "fadeUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both",
          }}>
            {["No install needed", "Works with or without captions", "Searchable library"].map((label) => (
              <span
                key={label}
                className="pill"
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.25)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 100,
                  padding: "4px 12px",
                  transition: "color 0.2s",
                }}
              >
                {label}
              </span>
            ))}
          </div>

          {/* Form / Success */}
          <div style={{ animation: "fadeUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.4s both" }}>
            {status === "success" || status === "already" ? (
              <div style={{
                marginTop: 36,
                borderLeft: "2px solid rgba(255,255,255,0.15)",
                paddingLeft: 16,
              }}>
                <p style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", margin: 0, lineHeight: 1.5 }}>
                  {status === "already"
                    ? "You\u2019re already on the list. We\u2019ll be in touch."
                    : "You\u2019re in. We\u2019ll email you when it\u2019s ready."}
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ marginTop: 36 }}>
                <div
                  className="waitlist-form-container"
                  style={{
                    display: "flex",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.03)",
                    overflow: "hidden",
                    transition: "border-color 0.2s",
                  }}
                >
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@email.com"
                    required
                    style={{
                      flex: 1,
                      border: "none",
                      background: "transparent",
                      padding: "12px 16px",
                      fontSize: 14,
                      fontFamily: '"Outfit", sans-serif',
                      color: "rgba(255,255,255,0.9)",
                      outline: "none",
                    }}
                  />
                  <button
                    type="submit"
                    disabled={status === "loading"}
                    className="waitlist-btn"
                    style={{
                      margin: 5,
                      borderRadius: 8,
                      border: "none",
                      background: "rgba(255,255,255,0.1)",
                      padding: "8px 20px",
                      fontSize: 13,
                      fontWeight: 500,
                      fontFamily: '"Outfit", sans-serif',
                      color: "rgba(255,255,255,0.8)",
                      cursor: status === "loading" ? "default" : "pointer",
                      opacity: status === "loading" ? 0.5 : 1,
                      transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {status === "loading" ? "..." : "Join waitlist"}
                  </button>
                </div>
                {status === "error" && (
                  <p style={{ marginTop: 12, fontSize: 12, color: "rgba(220,80,80,0.8)" }}>
                    Something went wrong. Try again.
                  </p>
                )}
              </form>
            )}
          </div>

          {/* Footer */}
          <div style={{
            marginTop: 56,
            fontSize: 11,
            color: "rgba(255,255,255,0.18)",
            animation: "fadeIn 0.8s ease-out 0.6s both",
          }}>
            <span>Want to self-host instead? </span>
            <a
              href="https://github.com/lifesized/youtube-transcriber"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link"
              style={{
                color: "rgba(255,255,255,0.3)",
                textDecoration: "underline",
                textUnderlineOffset: 2,
                transition: "color 0.2s",
              }}
            >
              View on GitHub
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
