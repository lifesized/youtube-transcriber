"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface LlmProvider {
  id: string;
  name: string;
  /** URL template — `{prompt}` is replaced with encoded prompt text */
  urlTemplate: string | null;
  /** If true, copies prompt to clipboard instead of URL-encoding it */
  clipboardFallback: boolean;
  icon: React.ReactNode;
}

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  claude: (
    <svg width="16" height="16" viewBox="0 0 100 100" fill="#D97757" className="shrink-0">
      <path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z" />
    </svg>
  ),
  chatgpt: (
    <svg width="16" height="16" viewBox="0 0 320 320" fill="currentColor" className="shrink-0">
      <path d="m297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68-15.25-17.18-37.16-26.95-60.13-26.81-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61 41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zm-120.28 168.11c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.92-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74v-74.39c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z" />
    </svg>
  ),
};

const PROVIDERS: LlmProvider[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    urlTemplate: "https://chatgpt.com/?q={prompt}",
    clipboardFallback: false,
    icon: PROVIDER_ICONS.chatgpt,
  },
  {
    id: "claude",
    name: "Claude",
    // Claude.ai's ?q= path triggers an external-prompt warning banner —
    // worse UX than the clipboard hop. Use the extension for one-press parity.
    urlTemplate: null,
    clipboardFallback: true,
    icon: PROVIDER_ICONS.claude,
  },
];

const OPEN_URLS: Record<string, string> = {
  claude: "https://claude.ai/",
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
  // Lazy init avoids the React 19 set-state-in-effect warning. Same-component
  // writes (line ~93) keep this in sync; cross-tab updates are an accepted
  // edge case.
  const [lastProvider, setLastProvider] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null
  );
  const dropdownRef = useRef<HTMLDivElement>(null);

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
        className="group/llm inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/5 hover:text-white/90 active:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        {/* Sparkle / wand icon */}
        <svg
          className="transition-transform duration-300 group-hover/llm:rotate-15"
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
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
          className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-white/15 bg-[hsl(var(--panel))] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)]"
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
              className="group/btn relative flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-white/75 transition hover:bg-white/5 hover:text-white"
            >
              {provider.icon}
              <span className="flex-1">{provider.name}</span>
              {provider.id === lastProvider && (
                <span className="text-[10px] text-white/30">last used</span>
              )}
              {provider.clipboardFallback && (
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 -mb-1.5 -translate-x-[calc(50%-10px)] whitespace-nowrap rounded-md border border-white/10 bg-[hsl(var(--panel))] px-2.5 py-1.5 text-[11px] text-white/50 opacity-0 shadow-lg transition-opacity duration-200 group-hover/btn:opacity-100 group-hover/btn:delay-400">
                  <span className="text-white/70">{typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent) ? "⌘+V" : "Ctrl+V"}</span>{" "}to paste transcript
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
