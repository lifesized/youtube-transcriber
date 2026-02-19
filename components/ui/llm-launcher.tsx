"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface LlmProvider {
  id: string;
  name: string;
  /** URL template — `{prompt}` is replaced with encoded prompt text */
  urlTemplate: string | null;
  /** If true, copies prompt to clipboard instead of URL-encoding it */
  clipboardFallback: boolean;
}

const PROVIDERS: LlmProvider[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    urlTemplate: "https://chatgpt.com/?q={prompt}",
    clipboardFallback: false,
  },
  {
    id: "claude",
    name: "Claude",
    urlTemplate: null,
    clipboardFallback: true,
  },
];

const OPEN_URLS: Record<string, string> = {
  claude: "https://claude.ai/new",
};

const STORAGE_KEY = "llm-launcher-last-provider";

function buildSummarizePrompt(title: string, transcript: string): string {
  return `Summarize the following transcript from "${title}". Focus on the main topics, key insights, and any actionable takeaways.\n\nTranscript:\n\n${transcript}`;
}

interface LlmLauncherProps {
  videoId: string;
  videoTitle: string;
  onToast?: (message: string) => void;
}

export function LlmLauncher({ videoId, videoTitle, onToast }: LlmLauncherProps) {
  const [open, setOpen] = useState(false);
  const [lastProvider, setLastProvider] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLastProvider(localStorage.getItem(STORAGE_KEY));
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const launchWithProvider = useCallback(
    async (provider: LlmProvider) => {
      setOpen(false);
      localStorage.setItem(STORAGE_KEY, provider.id);
      setLastProvider(provider.id);

      // Fetch full transcript text
      let transcriptText: string;
      try {
        const res = await fetch(`/api/transcripts/${videoId}`);
        if (!res.ok) {
          onToast?.("Failed to load transcript");
          return;
        }
        const data = await res.json();
        const segments = JSON.parse(data.transcript);
        transcriptText = segments.map((s: { text: string; speaker?: string }, idx: number) => {
          const prev = segments[idx - 1] as { speaker?: string } | undefined;
          const speakerChanged = s.speaker && (!prev || prev.speaker !== s.speaker);
          return speakerChanged ? `\n${s.speaker}: ${s.text}` : s.text;
        }).join(" ");
      } catch {
        onToast?.("Failed to load transcript");
        return;
      }

      const prompt = buildSummarizePrompt(videoTitle, transcriptText);

      if (provider.urlTemplate && !provider.clipboardFallback) {
        const encoded = encodeURIComponent(prompt);
        // Truncate if URL would be excessively long (browsers cap around 2000-8000 chars)
        const maxLen = 6000;
        const url =
          encoded.length > maxLen
            ? provider.urlTemplate.replace("{prompt}", encoded.slice(0, maxLen))
            : provider.urlTemplate.replace("{prompt}", encoded);
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        // Clipboard fallback — copy prompt then open the provider
        try {
          await navigator.clipboard.writeText(prompt);
          onToast?.("Prompt copied — paste into " + provider.name + " (⌘V)");
        } catch {
          onToast?.("Failed to copy prompt");
        }
        const fallbackUrl = OPEN_URLS[provider.id];
        if (fallbackUrl) {
          window.open(fallbackUrl, "_blank", "noopener,noreferrer");
        }
      }
    },
    [videoId, videoTitle, onToast]
  );

  // Sort providers so the last-used one appears first
  const sortedProviders = lastProvider
    ? [
        ...PROVIDERS.filter((p) => p.id === lastProvider),
        ...PROVIDERS.filter((p) => p.id !== lastProvider),
      ]
    : PROVIDERS;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        title="Summarize with LLM..."
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/5 hover:text-white/90 active:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        {/* Sparkle / wand icon */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10 2v2M10 16v2M2 10h2M16 10h2" />
          <path d="M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41" />
          <circle cx="10" cy="10" r="2" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-white/15 bg-[hsl(var(--panel))] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-widest text-white/40">
              Summarize with
            </p>
          </div>
          {sortedProviders.map((provider) => (
            <button
              key={provider.id}
              type="button"
              onClick={() => launchWithProvider(provider)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-white/75 transition hover:bg-white/5 hover:text-white"
            >
              <span>{provider.name}</span>
              {provider.id === lastProvider && (
                <span className="ml-auto text-[10px] text-white/30">last used</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
