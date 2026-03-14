"use client";

import { useEffect, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SettingsData {
  groq_api_key?: string;
  whisper_cloud_provider?: string;
  groq_usage_seconds?: string;
  groq_usage_date?: string;
}

type Status = "idle" | "saving" | "testing" | "saved" | "tested" | "error";

const DAILY_LIMIT = 14_400; // seconds (4 hours)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usageTier(seconds: number): {
  label: string;
  color: string;
  barColor: string;
} {
  if (seconds === 0)
    return {
      label: "No usage today",
      color: "text-green-400",
      barColor: "bg-green-400",
    };
  if (seconds < DAILY_LIMIT * 0.75)
    return {
      label: "Free tier",
      color: "text-green-400",
      barColor: "bg-green-400",
    };
  if (seconds < DAILY_LIMIT)
    return {
      label: "Approaching limit",
      color: "text-yellow-400",
      barColor: "bg-yellow-400",
    };
  return {
    label: "Paid usage",
    color: "text-red-400",
    barColor: "bg-red-400",
  };
}

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [maskedKey, setMaskedKey] = useState("");
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [usageSeconds, setUsageSeconds] = useState(0);
  const [usageDate, setUsageDate] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to load settings");
      const data: SettingsData = await res.json();

      if (data.groq_api_key) {
        setMaskedKey(data.groq_api_key);
        setHasExistingKey(true);
      }

      const today = new Date().toISOString().slice(0, 10);
      if (data.groq_usage_date === today && data.groq_usage_seconds) {
        setUsageSeconds(parseFloat(data.groq_usage_seconds));
        setUsageDate(data.groq_usage_date);
      } else {
        setUsageSeconds(0);
        setUsageDate(today);
      }
    } catch {
      // Settings may not exist yet — that's fine
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  async function handleSaveKey(key?: string) {
    const keyToSave = (key || apiKey).trim();
    if (!keyToSave && !hasExistingKey) return;

    setStatus("saving");
    setMessage("");

    try {
      const body: Record<string, string> = {
        whisper_cloud_provider: "groq",
      };
      if (keyToSave) {
        body.groq_api_key = keyToSave;
      }

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error("Failed to save");

      setStatus("saved");
      setMessage("Saved");
      if (keyToSave) {
        setMaskedKey(
          "*".repeat(keyToSave.length - 4) + keyToSave.slice(-4)
        );
        setHasExistingKey(true);
        setApiKey("");
      }
    } catch {
      setStatus("error");
      setMessage("Failed to save settings");
    }
  }

  async function handleTest() {
    setStatus("testing");
    setMessage("");

    try {
      const res = await fetch("/api/settings/test-groq", { method: "POST" });
      const data = (await res.json()) as {
        success: boolean;
        error?: string;
      };

      if (data.success) {
        setStatus("tested");
        setMessage("Connection successful — Groq API key is valid");
      } else {
        setStatus("error");
        setMessage(data.error || "Connection test failed");
      }
    } catch {
      setStatus("error");
      setMessage("Connection test failed");
    }
  }

  const pct = Math.min((usageSeconds / DAILY_LIMIT) * 100, 100);
  const tier = usageTier(usageSeconds);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:py-12">
        <div className="mx-auto max-w-[800px]">
          <div className="text-sm text-white/40">Loading settings...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-[800px]">
        <div className="space-y-6 sm:space-y-8">
          {/* Header */}
          <div>
            <h1 className="text-xl font-semibold text-white/90">Settings</h1>
            <p className="mt-1 text-sm text-white/40">
              Configure your Groq API key for cloud transcription
            </p>
          </div>

          {/* API Key Section */}
          <section className="space-y-5 rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-4 transition-colors duration-200 hover:border-white/30 sm:p-6">
            <h2 className="text-base font-medium text-white/75">
              Groq API Key
            </h2>

            {/* Current key status */}
            {hasExistingKey && (
              <div className="flex items-center gap-2 text-sm">
                <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
                <span className="text-white/50">
                  Key configured: {maskedKey}
                </span>
              </div>
            )}

            {/* Input */}
            <div className="space-y-2">
              <label
                htmlFor="apiKey"
                className="block text-sm text-white/50"
              >
                {hasExistingKey ? "Replace API key" : "Enter your API key"}
              </label>
              <div className="relative">
                <input
                  id="apiKey"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => {
                    const val = e.target.value;
                    setApiKey(val);
                    if (status === "saved" || status === "error") {
                      setStatus("idle");
                      setMessage("");
                    }
                  }}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData("text").trim();
                    if (pasted.length >= 10) {
                      e.preventDefault();
                      setApiKey(pasted);
                      // Auto-save after paste
                      setTimeout(() => {
                        handleSaveKey(pasted);
                      }, 0);
                    }
                  }}
                  placeholder="gsk_..."
                  className="h-11 w-full rounded-xl border border-white/10 bg-[hsl(var(--panel-2))] px-4 pr-20 text-sm text-white/90 placeholder:text-white/25 focus:border-white/20 focus:outline-none focus:ring-2 focus:ring-white/10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40 transition-colors hover:text-white/70"
                >
                  {showKey ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleTest}
                disabled={status === "testing" || (!hasExistingKey && !apiKey.trim())}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status === "testing" ? "Testing..." : "Test Connection"}
              </button>
            </div>

            {/* Status message */}
            {message && (
              <p
                className={`text-sm ${
                  status === "error" ? "text-red-400" : "text-green-400"
                }`}
              >
                {message}
              </p>
            )}
          </section>

          {/* Usage Visualization */}
          <section className="space-y-4 rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-4 transition-colors duration-200 hover:border-white/30 sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium text-white/75">
                Daily Usage
              </h2>
              <span className={`text-sm font-medium ${tier.color}`}>
                {tier.label}
              </span>
            </div>

            {/* Progress bar */}
            <div className="space-y-2">
              <div className="h-3 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${tier.barColor}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-white/40">
                <span>{formatSeconds(usageSeconds)} used</span>
                <span>{formatSeconds(DAILY_LIMIT)} limit</span>
              </div>
            </div>

            <p className="text-xs text-white/30">
              Groq free tier allows 14,400 audio-seconds per day (~4 hours).
              {usageDate && ` Tracking for ${usageDate}.`}
              {" "}Usage resets daily.
            </p>
          </section>

          {/* How to get a key */}
          <section className="space-y-4 rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-4 transition-colors duration-200 hover:border-white/30 sm:p-6">
            <h2 className="text-base font-medium text-white/75">
              How to get a free Groq API key
            </h2>
            <ol className="list-inside list-decimal space-y-3 text-sm text-white/50">
              <li>
                Go to{" "}
                <a
                  href="https://console.groq.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/70 underline decoration-blue-400/60 hover:text-white hover:decoration-blue-300"
                >
                  console.groq.com
                </a>{" "}
                and sign up for a free account
              </li>
              <li>
                Navigate to{" "}
                <strong className="text-white/60">API Keys</strong> in the left
                sidebar
              </li>
              <li>
                Click{" "}
                <strong className="text-white/60">Create API Key</strong> and
                give it a name
              </li>
              <li>Copy the key (starts with <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/60">gsk_</code>) and paste it above — it saves automatically</li>
              <li>
                Click{" "}
                <strong className="text-white/60">Test Connection</strong> to
                verify it works
              </li>
            </ol>
            <p className="text-xs text-white/30">
              The free tier includes 14,400 audio-seconds per day with
              Whisper Large V3 Turbo. No credit card required.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
