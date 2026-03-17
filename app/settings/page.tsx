"use client";

import { useEffect, useState, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SettingsData {
  groq_api_key?: string;
  whisper_cloud_provider?: string;
  groq_usage_seconds?: string;
  groq_usage_date?: string;
  whisper_enabled?: string;
}

interface ProviderRow {
  id: string;
  provider: string;
  apiKey: string; // masked from API
  model: string | null;
  baseUrl: string | null;
  enabled: boolean;
  priority: number;
}

type ProviderType = "openrouter" | "groq" | "custom";

type Status = "idle" | "saving" | "testing" | "saved" | "tested" | "error";

const DAILY_LIMIT = 14_400; // seconds (4 hours)

const PROVIDER_LABELS: Record<ProviderType, string> = {
  openrouter: "OpenRouter",
  groq: "Groq",
  custom: "Custom Endpoint",
};

const PROVIDER_PLACEHOLDERS: Record<ProviderType, string> = {
  openrouter: "sk-or-...",
  groq: "gsk_...",
  custom: "sk-...",
};

const OPENROUTER_MODELS = [
  // Recommended
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", tag: "recommended" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", tag: "recommended" },
  // Google
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", tag: "google" },
  { id: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash", tag: "google" },
  { id: "google/gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite", tag: "google" },
  // OpenAI
  { id: "openai/whisper-large-v3", label: "Whisper Large V3", tag: "openai" },
  { id: "openai/gpt-4o-audio-preview", label: "GPT-4o Audio Preview", tag: "openai" },
  { id: "openai/gpt-4o-mini-audio-preview", label: "GPT-4o Mini Audio Preview", tag: "openai" },
  // Anthropic
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", tag: "anthropic" },
  { id: "anthropic/claude-haiku-4", label: "Claude Haiku 4", tag: "anthropic" },
  // Deepgram
  { id: "deepgram/nova-2", label: "Deepgram Nova 2", tag: "deepgram" },
  { id: "deepgram/nova-3", label: "Deepgram Nova 3", tag: "deepgram" },
  // Meta
  { id: "meta-llama/llama-4-scout", label: "Llama 4 Scout", tag: "meta" },
  { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", tag: "meta" },
  // Qwen
  { id: "qwen/qwen-2.5-omni-7b", label: "Qwen 2.5 Omni 7B", tag: "qwen" },
  // ElevenLabs
  { id: "elevenlabs/scribe", label: "ElevenLabs Scribe", tag: "elevenlabs" },
];

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
      color: "text-[hsl(var(--accent))]",
      barColor: "bg-[hsl(var(--accent))]",
    };
  if (seconds < DAILY_LIMIT * 0.75)
    return {
      label: "Free tier",
      color: "text-[hsl(var(--accent))]",
      barColor: "bg-[hsl(var(--accent))]",
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
// ModelSelect Component
// ---------------------------------------------------------------------------

function ModelSelect({
  value,
  onChange,
  placeholder,
  models,
  className,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  models: { id: string; label: string; tag?: string }[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = search
    ? models.filter(
        (m) =>
          m.id.toLowerCase().includes(search.toLowerCase()) ||
          m.label.toLowerCase().includes(search.toLowerCase()) ||
          (m.tag && m.tag.toLowerCase().includes(search.toLowerCase()))
      )
    : models;

  const displayValue =
    value && models.find((m) => m.id === value)?.label || value;

  return (
    <div ref={ref} className={`relative ${className || ""}`}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          setSearch("");
        }}
        className="flex h-9 w-full items-center justify-between px-0 text-left text-sm text-white/90 focus:outline-none"
      >
        <span className={value ? "text-white/90" : "text-white/25"}>
          {displayValue || placeholder || "Select model..."}
        </span>
        <svg
          className={`h-4 w-4 text-white/30 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-white/10 bg-[hsl(var(--panel-2))] shadow-2xl">
          {/* Search input */}
          <div className="border-b border-white/10 p-2">
            <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3">
              <svg className="h-4 w-4 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && search.trim()) {
                    // Use exact search text as custom model ID
                    const match = filtered[0];
                    onChange(match ? match.id : search.trim());
                    setOpen(false);
                    setSearch("");
                  } else if (e.key === "Escape") {
                    setOpen(false);
                    setSearch("");
                  }
                }}
                placeholder="Search models..."
                className="h-9 w-full bg-transparent text-sm text-white/90 placeholder:text-white/30 focus:outline-none"
              />
            </div>
          </div>

          {/* Options list */}
          <div className="max-h-64 overflow-y-auto overscroll-contain py-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 hover:[&::-webkit-scrollbar-thumb]:bg-white/20">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-white/30">
                No models found
              </div>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors hover:bg-white/5 ${
                    value === m.id
                      ? "bg-[hsl(var(--accent)/0.1)] text-[hsl(var(--accent))]"
                      : "text-white/70"
                  }`}
                >
                  <span>{m.label}</span>
                  <span className="text-xs text-white/20">{m.id}</span>
                </button>
              ))
            )}
          </div>

          {/* Custom model hint */}
          <div className="border-t border-white/10 px-4 py-2">
            <p className="text-xs text-white/25">
              Type any OpenRouter model ID to use a model not listed here
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle Component
// ---------------------------------------------------------------------------

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-white/20 focus:ring-offset-2 focus:ring-offset-[hsl(var(--bg))] disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "bg-[hsl(var(--accent))]" : "bg-white/20"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  // Whisper toggle
  const [whisperEnabled, setWhisperEnabled] = useState(true);

  // Providers
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; error?: string }>>({});

  // Add provider form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState<ProviderType>("openrouter");
  const [newApiKey, setNewApiKey] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [showNewKey, setShowNewKey] = useState(false);
  const [addStatus, setAddStatus] = useState<Status>("idle");
  const [addMessage, setAddMessage] = useState("");

  // Groq usage (kept for backward compat)
  const [usageSeconds, setUsageSeconds] = useState(0);
  const [usageDate, setUsageDate] = useState("");

  // General
  const [loading, setLoading] = useState(true);
  const [completionAlertsEnabled, setCompletionAlertsEnabled] = useState(true);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  const loadSettings = useCallback(async () => {
    try {
      const [settingsRes, providersRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/settings/providers"),
      ]);

      if (settingsRes.ok) {
        const data: SettingsData = await settingsRes.json();

        // Whisper toggle
        if (data.whisper_enabled !== undefined) {
          setWhisperEnabled(data.whisper_enabled !== "false");
        }

        // Groq usage
        const today = new Date().toISOString().slice(0, 10);
        if (data.groq_usage_date === today && data.groq_usage_seconds) {
          setUsageSeconds(parseFloat(data.groq_usage_seconds));
          setUsageDate(data.groq_usage_date);
        } else {
          setUsageSeconds(0);
          setUsageDate(today);
          if (data.groq_usage_date && data.groq_usage_date !== today) {
            fetch("/api/settings", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ groq_usage_seconds: "0", groq_usage_date: today }),
            }).catch(() => {});
          }
        }
      }

      if (providersRes.ok) {
        const data: ProviderRow[] = await providersRes.json();
        setProviders(data);
      }
    } catch {
      // Settings may not exist yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    const stored = localStorage.getItem("completionAlertsEnabled");
    if (stored !== null) setCompletionAlertsEnabled(stored === "true");
  }, [loadSettings]);

  // -------------------------------------------------------------------------
  // Whisper toggle
  // -------------------------------------------------------------------------

  async function handleWhisperToggle(enabled: boolean) {
    setWhisperEnabled(enabled);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ whisper_enabled: String(enabled) }),
    }).catch(() => {});
  }

  // -------------------------------------------------------------------------
  // Provider actions
  // -------------------------------------------------------------------------

  async function handleAddProvider() {
    const key = newApiKey.trim();
    if (!key) return;

    if (newProvider === "custom" && !newBaseUrl.trim()) {
      setAddStatus("error");
      setAddMessage("Base URL is required for custom providers");
      return;
    }

    setAddStatus("saving");
    setAddMessage("");

    try {
      const res = await fetch("/api/settings/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: newProvider,
          apiKey: key,
          model: newModel.trim() || null,
          baseUrl: newBaseUrl.trim() || null,
          priority: providers.length,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }

      setAddStatus("saved");
      setAddMessage("Provider added");
      setNewApiKey("");
      setNewModel("");
      setNewBaseUrl("");
      setShowNewKey(false);
      setShowAddForm(false);
      await loadSettings();
    } catch (e) {
      setAddStatus("error");
      setAddMessage(e instanceof Error ? e.message : "Failed to save provider");
    }
  }

  async function handleDeleteProvider(id: string) {
    await fetch(`/api/settings/providers/${id}`, { method: "DELETE" });
    setProviders((prev) => prev.filter((p) => p.id !== id));
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function handleTestProvider(id: string) {
    setTestingId(id);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    try {
      const res = await fetch(`/api/settings/providers/${id}/test`, {
        method: "POST",
      });
      const data = await res.json();
      setTestResults((prev) => ({ ...prev, [id]: data }));
      if (data.success) {
        setTimeout(() => {
          setTestResults((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }, 10_000);
      }
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [id]: { success: false, error: "Test request failed" },
      }));
    } finally {
      setTestingId(null);
    }
  }

  async function handleToggleProvider(id: string, enabled: boolean) {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled } : p))
    );

    const provider = providers.find((p) => p.id === id);
    if (!provider) return;

    await fetch("/api/settings/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, provider: provider.provider, apiKey: provider.apiKey, enabled }),
    }).catch(() => {});
  }

  async function handleUpdateModel(id: string, model: string) {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, model } : p))
    );

    const provider = providers.find((p) => p.id === id);
    if (!provider) return;

    await fetch("/api/settings/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, provider: provider.provider, apiKey: provider.apiKey, model }),
    }).catch(() => {});
  }

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const hasGroqProvider = providers.some((p) => p.provider === "groq");
  const pct = Math.min((usageSeconds / DAILY_LIMIT) * 100, 100);
  const tier = usageTier(usageSeconds);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

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
              Configure transcription providers and preferences
            </p>
          </div>

          {/* Local Whisper Toggle */}
          <section className="space-y-4 rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-4 transition-colors duration-200 hover:border-white/30 sm:p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h2 className="text-base font-medium text-white/75">
                  Local Whisper
                </h2>
                <p className="text-sm text-white/40">
                  Use local Whisper for transcription when YouTube captions are unavailable
                </p>
              </div>
              <Toggle
                checked={whisperEnabled}
                onChange={handleWhisperToggle}
              />
            </div>
            {!whisperEnabled && (
              <p className="text-sm text-white/40">
                Whisper is disabled. Videos without captions will use your configured cloud provider{providers.filter((p) => p.enabled).length === 0 && (
                  <span className="text-[hsl(var(--accent))]">
                    {" "}&mdash; no providers configured yet. Add one below or transcription will fail for caption-less videos
                  </span>
                )}.
              </p>
            )}
          </section>

          {/* Transcription Providers */}
          <section className="space-y-5 rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-4 transition-colors duration-200 hover:border-white/30 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-medium text-white/75">
                  Cloud Providers
                </h2>
                <p className="mt-1 text-sm text-white/40">
                  Fallback order: {whisperEnabled ? "Local Whisper → " : ""}
                  {providers.filter((p) => p.enabled).length > 0
                    ? providers
                        .filter((p) => p.enabled)
                        .map((p) => PROVIDER_LABELS[p.provider as ProviderType] || p.provider)
                        .join(" → ")
                    : "None configured"}
                </p>
              </div>
            </div>

            {/* Provider List */}
            {providers.length > 0 && (
              <div className="space-y-3">
                {providers.map((p) => {
                  const result = testResults[p.id];
                  return (
                    <div
                      key={p.id}
                      className={`rounded-xl border bg-[hsl(var(--panel-2))] px-4 py-3 transition-colors ${
                        p.enabled
                          ? "border-white/10"
                          : "border-white/5 opacity-60"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium text-white/60">
                            {PROVIDER_LABELS[p.provider as ProviderType] || p.provider}
                          </span>
                          <span className="text-sm text-white/40">
                            {p.apiKey.replace(/\*/g, "•")}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Test connection icon */}
                          <button
                            onClick={() => handleTestProvider(p.id)}
                            disabled={testingId === p.id}
                            title="Test connection"
                            className="rounded-lg p-1.5 text-white/30 transition-colors hover:bg-white/5 hover:text-white/60 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {testingId === p.id ? (
                              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                            ) : (
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                            )}
                          </button>
                          {/* Delete icon */}
                          <button
                            onClick={() => handleDeleteProvider(p.id)}
                            title="Remove provider"
                            className="rounded-lg p-1.5 text-white/30 transition-colors hover:bg-red-500/10 hover:text-red-400"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                          {/* Enable toggle */}
                          <Toggle
                            checked={p.enabled}
                            onChange={(val) => handleToggleProvider(p.id, val)}
                          />
                        </div>
                      </div>

                      {/* Model selector (OpenRouter) or plain label */}
                      {p.provider === "openrouter" ? (
                        <div className="mt-2">
                          <ModelSelect
                            value={p.model || ""}
                            onChange={(val) => handleUpdateModel(p.id, val)}
                            placeholder="google/gemini-2.5-flash-lite"
                            models={OPENROUTER_MODELS}
                          />
                        </div>
                      ) : p.model ? (
                        <p className="mt-1.5 text-xs text-white/30">{p.model}</p>
                      ) : null}
                      {/* Test result (inline) */}
                      {result && (
                        <p className={`mt-1.5 text-xs ${result.success ? "text-green-400" : "text-red-400"}`}>
                          {result.success ? "Connection successful" : result.error || "Test failed"}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add Provider */}
            {!showAddForm ? (
              <button
                onClick={() => {
                  setShowAddForm(true);
                  setAddStatus("idle");
                  setAddMessage("");
                }}
                className="w-full rounded-xl border border-dashed border-white/15 bg-white/2 py-3 text-sm text-white/40 transition-colors hover:border-white/25 hover:bg-white/4 hover:text-white/60"
              >
                + Add Provider
              </button>
            ) : (
              <div className="space-y-4 rounded-xl border border-white/15 bg-[hsl(var(--panel-2))] p-4">
                {/* Provider type */}
                <div className="space-y-2">
                  <label className="block text-sm text-white/50">Provider</label>
                  <select
                    value={newProvider}
                    onChange={(e) => {
                      setNewProvider(e.target.value as ProviderType);
                      setNewModel("");
                    }}
                    className="h-11 w-full rounded-xl border border-white/10 bg-[hsl(var(--panel))] px-4 text-sm text-white/90 focus:border-white/20 focus:outline-none focus:ring-2 focus:ring-white/10"
                  >
                    <option value="openrouter">OpenRouter</option>
                    <option value="groq">Groq</option>
                    <option value="custom">Custom Endpoint (OpenAI-compatible)</option>
                  </select>
                </div>

                {/* API Key */}
                <div className="space-y-2">
                  <label className="block text-sm text-white/50">API Key</label>
                  <div className="relative">
                    <input
                      type={showNewKey ? "text" : "password"}
                      value={newApiKey}
                      onChange={(e) => {
                        setNewApiKey(e.target.value);
                        if (addStatus !== "idle") {
                          setAddStatus("idle");
                          setAddMessage("");
                        }
                      }}
                      onPaste={(e) => {
                        const pasted = e.clipboardData.getData("text").trim();
                        if (pasted.length >= 10) {
                          e.preventDefault();
                          setNewApiKey(pasted);
                        }
                      }}
                      placeholder={PROVIDER_PLACEHOLDERS[newProvider]}
                      className="h-11 w-full rounded-xl border border-white/10 bg-[hsl(var(--panel))] px-4 pr-20 text-sm text-white/90 placeholder:text-white/25 focus:border-white/20 focus:outline-none focus:ring-2 focus:ring-white/10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewKey(!showNewKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40 transition-colors hover:text-white/70"
                    >
                      {showNewKey ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                {/* Model */}
                <div className="space-y-2">
                  <label className="block text-sm text-white/50">
                    Model{newProvider !== "openrouter" && (
                      <span className="text-white/30"> (optional)</span>
                    )}
                  </label>
                  {newProvider === "openrouter" ? (
                    <ModelSelect
                      value={newModel}
                      onChange={setNewModel}
                      placeholder="google/gemini-2.5-flash-lite"
                      models={OPENROUTER_MODELS}
                    />
                  ) : (
                    <input
                      type="text"
                      value={newModel}
                      onChange={(e) => setNewModel(e.target.value)}
                      placeholder={
                        newProvider === "groq"
                          ? "whisper-large-v3-turbo"
                          : "whisper-1"
                      }
                      className="h-11 w-full rounded-xl border border-white/10 bg-[hsl(var(--panel))] px-4 text-sm text-white/90 placeholder:text-white/25 focus:border-white/20 focus:outline-none focus:ring-2 focus:ring-white/10"
                    />
                  )}
                </div>

                {/* Base URL (custom only) */}
                {newProvider === "custom" && (
                  <div className="space-y-2">
                    <label className="block text-sm text-white/50">Base URL</label>
                    <input
                      type="text"
                      value={newBaseUrl}
                      onChange={(e) => setNewBaseUrl(e.target.value)}
                      placeholder="https://your-server.com/v1"
                      className="h-11 w-full rounded-xl border border-white/10 bg-[hsl(var(--panel))] px-4 text-sm text-white/90 placeholder:text-white/25 focus:border-white/20 focus:outline-none focus:ring-2 focus:ring-white/10"
                    />
                  </div>
                )}

                {/* Status */}
                {addMessage && (
                  <p
                    className={`text-sm ${
                      addStatus === "error" ? "text-red-400" : "text-green-400"
                    }`}
                  >
                    {addMessage}
                  </p>
                )}

                {/* Buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={handleAddProvider}
                    disabled={addStatus === "saving" || !newApiKey.trim()}
                    className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white/80 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {addStatus === "saving" ? "Saving..." : "Add Provider"}
                  </button>
                  <button
                    onClick={() => {
                      setShowAddForm(false);
                      setNewApiKey("");
                      setNewModel("");
                      setNewBaseUrl("");
                      setAddStatus("idle");
                      setAddMessage("");
                    }}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/50 transition-colors hover:bg-white/10"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Groq Usage Visualization — only when Groq is configured */}
          {hasGroqProvider && (
            <section className="space-y-4 rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-4 transition-colors duration-200 hover:border-white/30 sm:p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-medium text-white/75">
                  Groq Daily Usage
                </h2>
                <span className="text-base font-medium text-white/75">
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
          )}

          {/* Notifications */}
          <section className="space-y-5 rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-4 transition-colors duration-200 hover:border-white/30 sm:p-6">
            <h2 className="text-base font-medium text-white/75">
              Notifications
            </h2>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-white/70">Completion alerts</p>
                <p className="text-xs text-white/30">
                  Play a sound and show a browser notification when a transcript finishes
                </p>
              </div>
              <Toggle
                checked={completionAlertsEnabled}
                onChange={(val) => {
                  setCompletionAlertsEnabled(val);
                  localStorage.setItem("completionAlertsEnabled", String(val));
                }}
              />
            </div>
          </section>

          {/* How to get API keys */}
          <section className="space-y-4 rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-4 transition-colors duration-200 hover:border-white/30 sm:p-6">
            <h2 className="text-base font-medium text-white/75">
              Getting API Keys
            </h2>

            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-white/60">OpenRouter</h3>
                <p className="text-sm text-white/40">
                  Sign up at{" "}
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/60 underline decoration-blue-400/60 hover:text-white hover:decoration-blue-300"
                  >
                    openrouter.ai/keys
                  </a>
                  {" "}and create an API key. Gives access to dozens of transcription models through a single key.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium text-white/60">Groq</h3>
                <p className="text-sm text-white/40">
                  Sign up at{" "}
                  <a
                    href="https://console.groq.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/60 underline decoration-blue-400/60 hover:text-white hover:decoration-blue-300"
                  >
                    console.groq.com
                  </a>
                  {" "}→ API Keys → Create API Key. Free tier includes 14,400 audio-seconds/day. No credit card required.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium text-white/60">Custom Endpoint</h3>
                <p className="text-sm text-white/40">
                  Any OpenAI-compatible transcription API. Provide the base URL (e.g. <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/50">https://your-server.com/v1</code>) and API key.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
