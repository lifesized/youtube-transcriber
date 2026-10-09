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
  whisper_priority?: string;
  groq_rate_limit?: string;
}

interface ProviderRow {
  id: string;
  provider: string;
  apiKey: string;
  model: string | null;
  baseUrl: string | null;
  enabled: boolean;
  priority: number;
}

// Unified item: either local whisper or a cloud provider
type FallbackItem =
  | { type: "local"; id: "__local_whisper__"; enabled: boolean; priority: number }
  | { type: "cloud"; id: string; provider: string; apiKey: string; model: string | null; baseUrl: string | null; enabled: boolean; priority: number };

type ProviderType = "openrouter" | "groq" | "custom";

const DAILY_LIMIT = 14_400;
const GROQ_COST_PER_SECOND = 0.0001; // $0.006/min beyond free tier

const PROVIDER_LABELS: Record<ProviderType, string> = {
  openrouter: "OpenRouter",
  groq: "Groq",
  custom: "Custom Endpoint",
};

const OPENROUTER_MODELS = [
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", tag: "recommended" },
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", tag: "budget" },
  { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash", tag: "google" },
  { id: "mistralai/voxtral-small-24b-2507", label: "Voxtral Small 24B", tag: "transcription" },
  { id: "openai/gpt-audio-mini", label: "GPT Audio Mini", tag: "openai" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usageTier(seconds: number) {
  if (seconds === 0)
    return { label: "No usage today", color: "text-[hsl(var(--accent))]", barColor: "bg-[hsl(var(--accent))]" };
  if (seconds < DAILY_LIMIT * 0.75)
    return { label: "Free tier", color: "text-[hsl(var(--accent))]", barColor: "bg-[hsl(var(--accent))]" };
  if (seconds < DAILY_LIMIT)
    return { label: "Approaching limit", color: "text-[hsl(var(--accent))]", barColor: "bg-[hsl(var(--accent))]" };
  return { label: "Paid usage", color: "text-red-400", barColor: "bg-red-400" };
}

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function estimateOverageCost(seconds: number): string | null {
  if (seconds <= DAILY_LIMIT) return null;
  const overage = seconds - DAILY_LIMIT;
  const cost = overage * GROQ_COST_PER_SECOND;
  return cost < 0.01 ? "< $0.01" : `~$${cost.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// ModelSelect
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

  const displayValue = value && models.find((m) => m.id === value)?.label || value;

  return (
    <div ref={ref} className={`relative ${className || ""}`}>
      <button
        type="button"
        onClick={() => { setOpen(!open); setSearch(""); }}
        className="flex h-9 w-full items-center px-0 text-left text-sm text-white/40 transition-colors hover:text-white/70 focus:outline-none"
      >
        <span>
          {displayValue || placeholder || "Select model..."}
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-white/10 bg-[hsl(var(--panel-2))] shadow-2xl">
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

          <div className="max-h-64 overflow-y-auto overscroll-contain py-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 hover:[&::-webkit-scrollbar-thumb]:bg-white/20">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-white/30">No models found</div>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { onChange(m.id); setOpen(false); setSearch(""); }}
                  className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors hover:bg-white/5 ${
                    value === m.id ? "bg-[hsl(var(--accent)/0.1)] text-[hsl(var(--accent))]" : "text-white/70"
                  }`}
                >
                  <span>{m.label}</span>
                  <span className="text-sm text-white/20">{m.id}</span>
                </button>
              ))
            )}
          </div>

          <div className="border-t border-white/10 px-4 py-2">
            <p className="text-xs text-white/25">Type any OpenRouter model ID to use a model not listed here</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle
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
        checked ? "btn-dither bg-[hsl(var(--accent))] hover:brightness-110" : "bg-white/20 hover:bg-white/25"
      }`}
    >
      <span
        className={`pointer-events-none relative z-10 inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// DragHandle
// ---------------------------------------------------------------------------

function DragHandle() {
  return (
    <svg className="h-4 w-4 text-white/15" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="5" cy="3" r="1.2" />
      <circle cx="11" cy="3" r="1.2" />
      <circle cx="5" cy="8" r="1.2" />
      <circle cx="11" cy="8" r="1.2" />
      <circle cx="5" cy="13" r="1.2" />
      <circle cx="11" cy="13" r="1.2" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// SettingsPanel
// ---------------------------------------------------------------------------

export function SettingsPanel() {
  const [whisperEnabled, setWhisperEnabled] = useState(true);
  const [whisperPriority, setWhisperPriority] = useState(0);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; error?: string }>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState<ProviderType>("openrouter");
  const [newApiKey, setNewApiKey] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [usageSeconds, setUsageSeconds] = useState(0);
  const [usageDate, setUsageDate] = useState("");
  const [monthlyCost, setMonthlyCost] = useState<number | null>(null);
  const [monthLabel, setMonthLabel] = useState("");
  const [monthlyDays, setMonthlyDays] = useState<{ date: string; seconds: number; cost: number }[]>([]);
  const [showDailyBreakdown, setShowDailyBreakdown] = useState(false);
  const [groqRateLimit, setGroqRateLimit] = useState<{
    remainingSeconds: number | null;
    limitSeconds: number | null;
    resetSeconds: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [completionAlertsEnabled, setCompletionAlertsEnabled] = useState(true);
  const [llmProvider, setLlmProvider] = useState<"anthropic" | "openai">("anthropic");
  const [llmKey, setLlmKey] = useState("");
  const [llmHasKey, setLlmHasKey] = useState(false);
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmError, setLlmError] = useState("");
  const [notionToken, setNotionToken] = useState("");
  const [notionDatabaseId, setNotionDatabaseId] = useState("");
  const [notionHasToken, setNotionHasToken] = useState(false);
  const [notionSaving, setNotionSaving] = useState(false);
  const [notionError, setNotionError] = useState("");
  const [tuskBotToken, setTuskBotToken] = useState("");
  const [tuskAppToken, setTuskAppToken] = useState("");
  const [tuskAllowlist, setTuskAllowlist] = useState("");
  const [tuskWatchlist, setTuskWatchlist] = useState("");
  const [tuskDigestChannel, setTuskDigestChannel] = useState("");
  const [tuskEnabled, setTuskEnabled] = useState(false);
  const [tuskHasBotToken, setTuskHasBotToken] = useState(false);
  const [tuskHasAppToken, setTuskHasAppToken] = useState(false);
  const [tuskBotMasked, setTuskBotMasked] = useState("");
  const [tuskAppMasked, setTuskAppMasked] = useState("");
  const [tuskTeamName, setTuskTeamName] = useState("");
  const [tuskBotName, setTuskBotName] = useState("");
  const [tuskConnection, setTuskConnection] = useState("");
  const [tuskSaving, setTuskSaving] = useState(false);
  const [tuskError, setTuskError] = useState("");
  const [tuskResetWorkspace, setTuskResetWorkspace] = useState(false);

  // Drag state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  function applyTuskPublic(data: {
    hasBotToken?: boolean;
    hasAppToken?: boolean;
    botTokenMasked?: string;
    appTokenMasked?: string;
    enabled?: boolean;
    teamName?: string;
    botName?: string;
    channelAllowlist?: string[];
    watchFeeds?: Array<{ url?: string }>;
    digestChannel?: string;
    connection?: { state?: string; workspace?: string };
  }) {
    setTuskHasBotToken(!!data.hasBotToken);
    setTuskHasAppToken(!!data.hasAppToken);
    setTuskBotMasked(data.botTokenMasked || "");
    setTuskAppMasked(data.appTokenMasked || "");
    setTuskEnabled(!!data.enabled);
    setTuskTeamName(data.teamName || "");
    setTuskBotName(data.botName || "");
    setTuskAllowlist((data.channelAllowlist || []).join(", "));
    setTuskWatchlist((data.watchFeeds || []).map((feed) => feed.url).filter(Boolean).join("\n"));
    setTuskDigestChannel(data.digestChannel || "");
    setTuskBotToken("");
    setTuskAppToken("");
    setTuskResetWorkspace(false);
    const conn = data.connection?.state || "";
    const workspace = data.connection?.workspace || data.teamName || "";
    if (conn === "connected" && workspace) setTuskConnection(`connected to ${workspace}`);
    else if (conn === "error") setTuskConnection("error");
    else setTuskConnection(conn || (data.enabled ? "off" : "off"));
  }

  const loadSettings = useCallback(async () => {
    try {
      const [settingsRes, providersRes, usageRes, llmRes, notionRes, tuskRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/settings/providers"),
        fetch("/api/usage"),
        fetch("/api/settings/llm"),
        fetch("/api/settings/notion"),
        fetch("/api/settings/tusk"),
      ]);

      if (settingsRes.ok) {
        const data: SettingsData = await settingsRes.json();
        if (data.whisper_enabled !== undefined) {
          setWhisperEnabled(data.whisper_enabled !== "false");
        }
        if (data.whisper_priority !== undefined) {
          setWhisperPriority(parseInt(data.whisper_priority, 10));
        } else {
          setWhisperPriority(0);
        }
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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
        if (data.groq_rate_limit) {
          try {
            setGroqRateLimit(JSON.parse(data.groq_rate_limit));
          } catch { /* ignore parse errors */ }
        }
      }

      if (providersRes.ok) {
        const data: ProviderRow[] = await providersRes.json();
        setProviders(data);
      }

      if (usageRes.ok) {
        const data = await usageRes.json();
        setMonthlyCost(data.totalCost);
        setMonthLabel(data.month);
        setMonthlyDays(data.days);
      }

      if (llmRes.ok) {
        const data = await llmRes.json();
        if (data.provider === "anthropic" || data.provider === "openai") {
          setLlmProvider(data.provider);
        }
        setLlmHasKey(!!data.hasKey);
        setLlmKey(data.keyMasked || "");
      }

      if (notionRes.ok) {
        const data = await notionRes.json();
        setNotionHasToken(!!data.hasToken);
        setNotionToken(data.tokenMasked || "");
        setNotionDatabaseId(data.databaseId || "");
      }

      if (tuskRes.ok) {
        const data = await tuskRes.json();
        applyTuskPublic(data);
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

  // Build unified ordered list
  const items: FallbackItem[] = [
    { type: "local" as const, id: "__local_whisper__" as const, enabled: whisperEnabled, priority: whisperPriority },
    ...providers.map((p) => ({
      type: "cloud" as const,
      id: p.id,
      provider: p.provider,
      apiKey: p.apiKey,
      model: p.model,
      baseUrl: p.baseUrl,
      enabled: p.enabled,
      priority: p.priority,
    })),
  ].sort((a, b) => a.priority - b.priority);

  // Fallback order text (enabled items only)
  const enabledNames = items
    .filter((i) => i.enabled)
    .map((i) => i.type === "local" ? "Local Whisper" : PROVIDER_LABELS[i.provider as ProviderType] || i.provider);

  // ---------------------------------------------------------------------------
  // Reorder
  // ---------------------------------------------------------------------------

  async function persistOrder(newItems: FallbackItem[]) {
    const order = newItems.map((i) => i.id);
    await fetch("/api/settings/providers/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    }).catch(() => {});
  }

  function handleDragStart(id: string) {
    setDragId(id);
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    if (id !== dragId) setDragOverId(id);
  }

  function handleDragLeave() {
    setDragOverId(null);
  }

  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }

    const oldIndex = items.findIndex((i) => i.id === dragId);
    const newIndex = items.findIndex((i) => i.id === targetId);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...items];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);

    // Assign new priorities
    const updated = reordered.map((item, idx) => ({ ...item, priority: idx }));

    // Update local state
    const newWhisperPri = updated.find((i) => i.id === "__local_whisper__")!.priority;
    setWhisperPriority(newWhisperPri);
    setProviders((prev) =>
      prev.map((p) => {
        const match = updated.find((i) => i.id === p.id);
        return match ? { ...p, priority: match.priority } : p;
      })
    );

    persistOrder(updated);
    setDragId(null);
    setDragOverId(null);
  }

  function handleDragEnd() {
    setDragId(null);
    setDragOverId(null);
  }

  // ---------------------------------------------------------------------------
  // Provider actions
  // ---------------------------------------------------------------------------

  async function handleToggleItem(id: string, enabled: boolean) {
    if (id === "__local_whisper__") {
      setWhisperEnabled(enabled);
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whisper_enabled: String(enabled) }),
      }).catch(() => {});
    } else {
      setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, enabled } : p)));
      const provider = providers.find((p) => p.id === id);
      if (!provider) return;
      await fetch("/api/settings/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, provider: provider.provider, apiKey: provider.apiKey, enabled }),
      }).catch(() => {});
    }
  }

  async function handleDeleteProvider(id: string) {
    await fetch(`/api/settings/providers/${id}`, { method: "DELETE" });
    setProviders((prev) => prev.filter((p) => p.id !== id));
    setTestResults((prev) => { const next = { ...prev }; delete next[id]; return next; });
  }

  async function handleTestProvider(id: string) {
    setTestingId(id);
    setTestResults((prev) => { const next = { ...prev }; delete next[id]; return next; });
    try {
      const res = await fetch(`/api/settings/providers/${id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResults((prev) => ({ ...prev, [id]: data }));
      if (data.success) {
        setTimeout(() => {
          setTestResults((prev) => { const next = { ...prev }; delete next[id]; return next; });
        }, 10_000);
      }
    } catch {
      setTestResults((prev) => ({ ...prev, [id]: { success: false, error: "Test request failed" } }));
    } finally {
      setTestingId(null);
    }
  }

  async function handleUpdateModel(id: string, model: string) {
    setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, model } : p)));
    const provider = providers.find((p) => p.id === id);
    if (!provider) return;
    await fetch("/api/settings/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, provider: provider.provider, apiKey: provider.apiKey, model }),
    }).catch(() => {});
  }

  const hasGroqProvider = providers.some((p) => p.provider === "groq");
  const groqLimit = groqRateLimit?.limitSeconds ?? DAILY_LIMIT;
  const groqUsed = groqRateLimit?.remainingSeconds != null
    ? groqLimit - groqRateLimit.remainingSeconds
    : usageSeconds;
  const pct = Math.min((groqUsed / groqLimit) * 100, 100);
  const tier = usageTier(groqUsed);

  if (loading) {
    return <div className="py-4 text-sm text-white/40">Loading settings...</div>;
  }

  async function handleSaveLlm() {
    setLlmSaving(true);
    setLlmError("");
    try {
      const res = await fetch("/api/settings/llm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: llmProvider,
          apiKey: llmKey,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLlmError(data.error || "Could not save");
        return;
      }
      setLlmHasKey(!!data.hasLlmKey || !!data.hasKey || llmHasKey);
      if (data.llmKeyMasked) setLlmKey(data.llmKeyMasked);
    } catch {
      setLlmError("Could not save");
    } finally {
      setLlmSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-white/80">Summaries</h2>
        <p className="text-sm text-white/40">
          Choose Anthropic or OpenAI. The key is stored in the macOS Keychain via the Transcriber app — never in plaintext on disk.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <select
            value={llmProvider}
            onChange={(e) => setLlmProvider(e.target.value as "anthropic" | "openai")}
            className="h-11 rounded-md bg-[hsl(var(--panel-2))] px-3 py-3 text-sm text-white/90 shadow-[var(--edge)] transition-[box-shadow,background,color] duration-150 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))] focus-visible:shadow-[var(--edge-accent)]"
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
          <input
            type="password"
            value={llmKey}
            onChange={(e) => setLlmKey(e.target.value)}
            placeholder={llmHasKey ? "Key saved" : "API key"}
            autoComplete="off"
            className="h-11 min-w-0 flex-1 rounded-md bg-[hsl(var(--panel-2))] px-3 py-3 text-sm text-white/90 placeholder:text-[hsl(var(--muted-2))] shadow-[var(--edge)] transition-[box-shadow,background,color] duration-150 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))] focus-visible:shadow-[var(--edge-accent)]"
          />
          <button
            type="button"
            onClick={() => void handleSaveLlm()}
            disabled={llmSaving}
            aria-busy={llmSaving}
            className="h-11 rounded-md bg-[hsl(var(--accent))] px-4 py-3 text-sm font-semibold text-black shadow-[var(--edge)] transition-[box-shadow,background,color] duration-150 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))] disabled:cursor-not-allowed disabled:text-[hsl(var(--muted-2))] disabled:hover:bg-[hsl(var(--accent))]"
          >
            {llmSaving ? "Saving…" : "Save"}
          </button>
        </div>
        {llmError ? (
          <p className="text-sm text-red-400">{llmError}</p>
        ) : llmHasKey ? (
          <p className="text-sm text-white/30">A key is saved in the app Keychain.</p>
        ) : null}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-white/80">Notion</h2>
        <p className="text-sm text-white/40">
          Paste an internal integration token and a database ID or URL. The extension never sees the token.
        </p>
        <input
          type="password"
          value={notionToken}
          onChange={(e) => setNotionToken(e.target.value)}
          placeholder={notionHasToken ? "Token saved" : "Internal integration token"}
          autoComplete="off"
          className="h-11 w-full rounded-md bg-[hsl(var(--panel-2))] px-3 py-3 text-sm text-white/90 placeholder:text-[hsl(var(--muted-2))] shadow-[var(--edge)] transition-[box-shadow,background,color] duration-150 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))] focus-visible:shadow-[var(--edge-accent)]"
        />
        <input
          type="text"
          value={notionDatabaseId}
          onChange={(e) => setNotionDatabaseId(e.target.value)}
          placeholder="Database ID or URL (page ID is a fallback)"
          autoComplete="off"
          className="h-11 w-full rounded-md bg-[hsl(var(--panel-2))] px-3 py-3 text-sm text-white/90 placeholder:text-[hsl(var(--muted-2))] shadow-[var(--edge)] transition-[box-shadow,background,color] duration-150 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))] focus-visible:shadow-[var(--edge-accent)]"
        />
        <button
          type="button"
          onClick={async () => {
            setNotionSaving(true);
            setNotionError("");
            try {
              const res = await fetch("/api/settings/notion", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  token: notionToken,
                  databaseId: notionDatabaseId,
                }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) {
                setNotionError(data.error || "Could not save");
                return;
              }
              setNotionHasToken(!!data.hasToken || notionHasToken);
              if (data.tokenMasked) setNotionToken(data.tokenMasked);
              if (data.databaseId) setNotionDatabaseId(data.databaseId);
            } catch {
              setNotionError("Could not save");
            } finally {
              setNotionSaving(false);
            }
          }}
          disabled={notionSaving}
          aria-busy={notionSaving}
          className="h-11 rounded-md bg-[hsl(var(--accent))] px-4 py-3 text-sm font-semibold text-black shadow-[var(--edge)] transition-[box-shadow,background,color] duration-150 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))] disabled:cursor-not-allowed disabled:text-[hsl(var(--muted-2))]"
        >
          {notionSaving ? "Saving…" : "Save Notion"}
        </button>
        {notionError ? (
          <p className="text-sm text-red-400">{notionError}</p>
        ) : notionHasToken ? (
          <p className="text-sm text-white/30">Token is stored in the app Keychain.</p>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white/80">Slack (Tusk)</h2>
          <Toggle
            checked={tuskEnabled}
            disabled={!tuskHasBotToken || !tuskHasAppToken || tuskSaving}
            onChange={(val) => {
              void (async () => {
                setTuskSaving(true);
                setTuskError("");
                try {
                  const res = await fetch("/api/settings/tusk", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ enabled: val }),
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    setTuskError(data.error || "Could not update Tusk");
                    return;
                  }
                  applyTuskPublic(data);
                } catch {
                  setTuskError("Could not update Tusk");
                } finally {
                  setTuskSaving(false);
                }
              })();
            }}
          />
        </div>
        <p className="text-sm text-white/40">
          Socket Mode bot for #youtube-notes. Paste the bot token (xoxb) and app-level token (xapp). After save the page only shows saved ••••last4 — never the token again.
        </p>
        <input
          type="password"
          value={tuskBotToken}
          onChange={(e) => setTuskBotToken(e.target.value)}
          placeholder={tuskHasBotToken ? "Bot token saved" : "Bot token (xoxb-…)"}
          autoComplete="off"
          className="h-11 w-full rounded-md bg-[hsl(var(--panel-2))] px-3 py-3 text-sm text-white/90 placeholder:text-[hsl(var(--muted-2))] shadow-[var(--edge)] transition-[box-shadow,background,color] duration-150 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))] focus-visible:shadow-[var(--edge-accent)]"
        />
        <input
          type="password"
          value={tuskAppToken}
          onChange={(e) => setTuskAppToken(e.target.value)}
          placeholder={tuskHasAppToken ? "App-level token saved" : "App-level token (xapp-…)"}
          autoComplete="off"
          className="h-11 w-full rounded-md bg-[hsl(var(--panel-2))] px-3 py-3 text-sm text-white/90 placeholder:text-[hsl(var(--muted-2))] shadow-[var(--edge)] transition-[box-shadow,background,color] duration-150 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))] focus-visible:shadow-[var(--edge-accent)]"
        />
        <input
          type="text"
          value={tuskAllowlist}
          onChange={(e) => setTuskAllowlist(e.target.value)}
          placeholder="Channel IDs (C…), empty = deny all"
          autoComplete="off"
          className="h-11 w-full rounded-md bg-[hsl(var(--panel-2))] px-3 py-3 text-sm text-white/90 placeholder:text-[hsl(var(--muted-2))] shadow-[var(--edge)] transition-[box-shadow,background,color] duration-150 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))] focus-visible:shadow-[var(--edge-accent)]"
        />
        <textarea
          value={tuskWatchlist}
          onChange={(e) => setTuskWatchlist(e.target.value)}
          placeholder="Watchlist: YouTube channel IDs, playlist IDs, or videos.xml URLs (one per line)"
          autoComplete="off"
          rows={3}
          className="w-full rounded-md bg-[hsl(var(--panel-2))] px-3 py-3 text-sm text-white/90 placeholder:text-[hsl(var(--muted-2))] shadow-[var(--edge)] transition-[box-shadow,background,color] duration-150 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))] focus-visible:shadow-[var(--edge-accent)]"
        />
        <input
          type="text"
          value={tuskDigestChannel}
          onChange={(e) => setTuskDigestChannel(e.target.value)}
          placeholder="Digest channel ID (C…), must be on the allowlist"
          autoComplete="off"
          className="h-11 w-full rounded-md bg-[hsl(var(--panel-2))] px-3 py-3 text-sm text-white/90 placeholder:text-[hsl(var(--muted-2))] shadow-[var(--edge)] transition-[box-shadow,background,color] duration-150 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))] focus-visible:shadow-[var(--edge-accent)]"
        />
        <button
          type="button"
          onClick={async () => {
            setTuskSaving(true);
            setTuskError("");
            try {
              const res = await fetch("/api/settings/tusk", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  botToken: tuskBotToken,
                  appToken: tuskAppToken,
                  enabled: tuskEnabled || Boolean(tuskBotToken && tuskAppToken),
                  channelAllowlist: tuskAllowlist,
                  watchlist: tuskWatchlist,
                  digestChannel: tuskDigestChannel,
                  resetWorkspace: tuskResetWorkspace,
                }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) {
                setTuskError(data.error || "Could not save");
                return;
              }
              applyTuskPublic(data);
            } catch {
              setTuskError("Could not save");
            } finally {
              setTuskSaving(false);
            }
          }}
          disabled={tuskSaving}
          aria-busy={tuskSaving}
          className="h-11 rounded-md bg-[hsl(var(--accent))] px-4 py-3 text-sm font-semibold text-black shadow-[var(--edge)] transition-[box-shadow,background,color] duration-150 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))] disabled:cursor-not-allowed disabled:text-[hsl(var(--muted-2))] disabled:hover:bg-[hsl(var(--accent))]"
        >
          {tuskSaving ? "Saving…" : "Save Tusk"}
        </button>
        {tuskTeamName ? (
          <label className="flex items-start gap-2 text-sm text-white/40">
            <input
              type="checkbox"
              checked={tuskResetWorkspace}
              onChange={(e) => setTuskResetWorkspace(e.target.checked)}
              className="mt-1 h-4 w-4 rounded-sm bg-[hsl(var(--panel-2))] accent-[hsl(var(--accent))] shadow-[var(--edge)]"
            />
            <span>
              Reset workspace pin. Required before a token from a different Slack team will save.
              Currently pinned to {tuskTeamName}.
            </span>
          </label>
        ) : null}
        {tuskError ? (
          <p className="text-sm text-red-400">{tuskError}</p>
        ) : (
          <div className="space-y-1 text-sm text-white/30">
            {tuskHasBotToken ? <p>Bot token {tuskBotMasked || "saved ••••"}</p> : null}
            {tuskHasAppToken ? <p>App-level token {tuskAppMasked || "saved ••••"}</p> : null}
            {tuskTeamName || tuskBotName ? (
              <p>
                {tuskBotName ? `@${tuskBotName.replace(/^@/, "")}` : "Bot"}
                {tuskTeamName ? ` in ${tuskTeamName}` : ""}
              </p>
            ) : null}
            <p>Status: {tuskConnection || "off"}</p>
          </div>
        )}
      </div>

      {/* Fallback order summary */}
      <p className="text-sm text-white/40">
        <span className="font-medium text-white/75">Transcription fallback order:</span>{" "}
        {enabledNames.length > 0 ? enabledNames.join(" \u2192 ") : "None configured"}
      </p>

      {/* Unified reorderable list */}
      <div className="space-y-1">
        {items.map((item) => {
          const isDragging = dragId === item.id;
          const isDragOver = dragOverId === item.id;
          const result = item.type === "cloud" ? testResults[item.id] : null;

          return (
            <div
              key={item.id}
              draggable
              onDragStart={() => handleDragStart(item.id)}
              onDragOver={(e) => handleDragOver(e, item.id)}
              onDragLeave={handleDragLeave}
              onDrop={() => handleDrop(item.id)}
              onDragEnd={handleDragEnd}
              className={`-mx-3 rounded-lg px-3 py-2.5 transition-all ${
                isDragging ? "opacity-30" : ""
              } ${isDragOver ? "border-t-2 border-white/20" : "border-t-2 border-transparent"} ${
                item.enabled ? "hover:bg-white/3" : "opacity-40 hover:opacity-60"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="cursor-grab active:cursor-grabbing">
                    <DragHandle />
                  </div>
                  <span className="text-sm font-medium text-white/70">
                    {item.type === "local"
                      ? "Local Whisper"
                      : PROVIDER_LABELS[item.provider as ProviderType] || item.provider}
                  </span>
                  {item.type === "cloud" && (
                    <span className="text-sm text-white/25">{item.apiKey.replace(/\*/g, "\u2022")}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {item.type === "cloud" && (
                    <>
                      <button
                        onClick={() => handleTestProvider(item.id)}
                        disabled={testingId === item.id}
                        title="Test connection"
                        className="rounded-lg p-1.5 text-white/20 transition-colors hover:text-white/50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {testingId === item.id ? (
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
                      <button
                        onClick={() => {
                          if (window.confirm("Are you sure you want to delete this provider?")) {
                            handleDeleteProvider(item.id);
                          }
                        }}
                        title="Remove provider"
                        className="rounded-lg p-1.5 text-white/20 transition-colors hover:text-white/50"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </>
                  )}
                  <Toggle checked={item.enabled} onChange={(val) => handleToggleItem(item.id, val)} />
                </div>
              </div>

              {/* Model selector for OpenRouter */}
              {item.type === "cloud" && item.provider === "openrouter" && (
                <div className="mt-1 pl-7">
                  <ModelSelect
                    value={item.model || ""}
                    onChange={(val) => handleUpdateModel(item.id, val)}
                    placeholder="google/gemini-2.5-flash"
                    models={OPENROUTER_MODELS}
                  />
                </div>
              )}
              {item.type === "cloud" && item.provider !== "openrouter" && item.model && (
                <p className="mt-1 pl-7 text-xs text-white/25">{item.model}</p>
              )}

              {/* Local Whisper description */}
              {item.type === "local" && (
                <p className="mt-1 pl-7 text-xs text-white/30">
                  Runs locally — no file size limit, no API key needed
                </p>
              )}

              {/* Test results */}
              {result && (
                <p className={`mt-1 pl-7 text-xs ${result.success ? "text-[hsl(var(--accent))]" : "text-red-400"}`}>
                  {result.success ? "Connection successful" : result.error || "Test failed"}
                </p>
              )}
            </div>
          );
        })}

        {/* Add provider */}
        {!showAddForm ? (
          <button
            onClick={() => {
              const used = new Set(providers.map((p) => p.provider));
              const available: ProviderType[] = (["openrouter", "groq", "custom"] as ProviderType[]).filter((t) => !used.has(t));
              if (available.length === 0) return;
              setNewProvider(available[0]);
              setNewApiKey("");
              setShowAddForm(true);
            }}
            className="ml-4 mt-2 text-sm text-white/30 transition-colors hover:text-white/60"
          >
            + Add provider
          </button>
        ) : (
          <div className="mt-2 space-y-3 pl-7">
            <div className="flex items-center gap-3">
              <select
                value={newProvider}
                onChange={(e) => setNewProvider(e.target.value as ProviderType)}
                className="h-9 rounded-lg border border-white/10 bg-[hsl(var(--panel))] px-3 text-sm text-white/90 focus:outline-none"
              >
                {!providers.some((p) => p.provider === "openrouter") && <option value="openrouter">OpenRouter</option>}
                {!providers.some((p) => p.provider === "groq") && <option value="groq">Groq</option>}
                <option value="custom">Custom</option>
              </select>
              <input
                type="password"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="API key"
                className="h-9 flex-1 rounded-lg border border-white/10 bg-[hsl(var(--panel))] px-3 text-sm text-white/90 placeholder:text-white/25 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  if (!newApiKey.trim()) return;
                  setAddSaving(true);
                  try {
                    const res = await fetch("/api/settings/providers", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        provider: newProvider,
                        apiKey: newApiKey.trim(),
                        priority: items.length,
                      }),
                    });
                    if (res.ok) {
                      setShowAddForm(false);
                      setNewApiKey("");
                      await loadSettings();
                    }
                  } finally {
                    setAddSaving(false);
                  }
                }}
                disabled={addSaving || !newApiKey.trim()}
                className="text-sm text-white/50 transition-colors hover:text-white/80 disabled:opacity-40"
              >
                {addSaving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => { setShowAddForm(false); setNewApiKey(""); }}
                className="text-sm text-white/30 transition-colors hover:text-white/50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Groq Usage */}
      {hasGroqProvider && (
        <>
          <div className="border-t border-white/5" />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-white/75">Groq Daily Usage</h2>
              <span className="text-sm font-medium text-white/75">{tier.label}</span>
            </div>
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                <div className={`h-full rounded-full transition-all duration-500 ${tier.barColor}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between text-xs text-white/40">
                <span>{formatSeconds(groqUsed)} used</span>
                <span>{formatSeconds(groqLimit)} limit</span>
              </div>
            </div>
            {groqRateLimit?.remainingSeconds != null && (
              <p className="text-xs text-white/40">
                {formatSeconds(groqRateLimit.remainingSeconds)} remaining
                {groqRateLimit.resetSeconds && ` · resets in ${groqRateLimit.resetSeconds}`}
              </p>
            )}
            {estimateOverageCost(groqUsed) && (
              <p className="text-sm font-medium text-red-400">
                Estimated cost today: {estimateOverageCost(groqUsed)} ({formatSeconds(groqUsed - DAILY_LIMIT)} beyond free tier)
              </p>
            )}
            {monthlyCost !== null && monthlyCost > 0 && (
              <div className="space-y-2">
                <button
                  onClick={() => setShowDailyBreakdown((v) => !v)}
                  className="flex items-center gap-1.5 text-sm text-white/50 transition-colors hover:text-white/70"
                >
                  <span className={`inline-block transition-transform duration-200 ${showDailyBreakdown ? "rotate-90" : ""}`}>&#9654;</span>
                  Month total ({monthLabel}): ~${monthlyCost.toFixed(2)}
                </button>
                {showDailyBreakdown && monthlyDays.length > 0 && (
                  <div className="ml-4 space-y-1 border-l border-white/5 pl-3">
                    {monthlyDays.map((day) => (
                      <div key={day.date} className="flex justify-between text-xs text-white/40">
                        <span>{day.date}</span>
                        <span>
                          {formatSeconds(day.seconds)}
                          {day.cost > 0 && <span className="ml-2 text-red-400/70">~${day.cost.toFixed(2)}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <p className="text-sm text-white/30">
              Groq free tier allows {formatSeconds(groqLimit)} per day.
              {usageDate && ` Tracking for ${usageDate}.`}
              {" "}Usage resets daily.
            </p>
          </div>
        </>
      )}

      <div className="border-t border-white/5" />

      {/* Notifications */}
      <div className="-mx-3 flex items-center justify-between rounded-lg px-3 py-2 transition-colors hover:bg-white/3">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-white/75">Completion alerts</h2>
          <p className="text-sm text-white/30">
            Play a sound and show a browser notification when a transcript finishes
          </p>
        </div>
        <Toggle
          checked={completionAlertsEnabled}
          onChange={(val) => { setCompletionAlertsEnabled(val); localStorage.setItem("completionAlertsEnabled", String(val)); }}
        />
      </div>

      <div className="border-t border-white/5" />

      {/* API Key instructions */}
      <div className="space-y-4">
        <h2 className="text-sm font-medium text-white/75">Getting API Keys</h2>
        <div className="space-y-3">
          <div>
            <span className="text-sm font-medium text-white/50">OpenRouter</span>
            <span className="text-sm text-white/40">
              {" \u2014 "}Sign up at{" "}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-white/60 underline decoration-white/20 hover:text-white hover:decoration-white/40">
                openrouter.ai/keys
              </a>
              . Access dozens of transcription models through a single key.
            </span>
          </div>
          <div>
            <span className="text-sm font-medium text-white/50">Groq</span>
            <span className="text-sm text-white/40">
              {" \u2014 "}Sign up at{" "}
              <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" className="text-white/60 underline decoration-white/20 hover:text-white hover:decoration-white/40">
                console.groq.com
              </a>
              . Free tier: 14,400 audio-seconds/day. No credit card required.
            </span>
          </div>
          <div>
            <span className="text-sm font-medium text-white/50">Custom</span>
            <span className="text-sm text-white/40">
              {" \u2014 "}Any OpenAI-compatible transcription endpoint. Provide a base URL and API key.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
