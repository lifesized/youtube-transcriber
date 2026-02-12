"use client";

import { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TranscriptSegment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconButton, iconButtonClassName } from "@/components/ui/icon-button";

interface QueueItem {
  url: string;
  status: "pending" | "processing" | "completed" | "failed";
  title?: string;
  id?: string;
  error?: string;
  progress: number;
  statusText: string;
}

interface VideoSummary {
  id: string;
  videoId: string;
  title: string;
  author: string;
  channelUrl: string | null;
  thumbnailUrl: string | null;
  videoUrl: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
}

interface VideoRecord extends VideoSummary {
  transcript: string;
}

function isYouTubeUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+/.test(url);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id");
  const libraryLayout = searchParams.get("layout") === "list" ? "list" : "tiles";

  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const [transcripts, setTranscripts] = useState<VideoSummary[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [video, setVideo] = useState<VideoRecord | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);
  const progressIntervals = useRef<Map<number, ReturnType<typeof setInterval>>>(
    new Map()
  );

  const fetchTranscripts = useCallback(async (query: string) => {
    try {
      const endpoint = query
        ? `/api/transcripts?q=${encodeURIComponent(query)}`
        : "/api/transcripts";
      const res = await fetch(endpoint);
      if (!res.ok) return;
      const data = await res.json();
      setTranscripts(data);
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    setLibraryLoading(true);
    fetchTranscripts("");
  }, [fetchTranscripts]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLibraryLoading(true);
      fetchTranscripts(search);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, fetchTranscripts]);

  useEffect(() => {
    async function fetchSelectedVideo(id: string) {
      setVideo(null);
      setVideoError(null);
      setVideoLoading(true);
      try {
        const res = await fetch(`/api/transcripts/${id}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setVideoError(data.error || "Transcript not found.");
          return;
        }
        const data = await res.json();
        setVideo(data);
      } catch {
        setVideoError("Failed to load transcript.");
      } finally {
        setVideoLoading(false);
      }
    }

    if (!selectedId) {
      setVideo(null);
      setVideoError(null);
      setVideoLoading(false);
      return;
    }

    fetchSelectedVideo(selectedId);
  }, [selectedId]);

  const selectTranscript = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("id", id);
      router.push(`/?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const setLibraryLayout = useCallback(
    (layout: "tiles" | "list") => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("layout", layout);
      router.push(`/?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const clearSelectedTranscript = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("id");
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : "/", { scroll: false });
  }, [router, searchParams]);

  const handleCopyFromLibrary = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/transcripts/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      const segs: TranscriptSegment[] = JSON.parse(data.transcript);
      const text = segs
        .map((seg) => `[${formatTimestamp(seg.startMs)}] ${seg.text}`)
        .join("\n");
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  }, []);

  const updateQueue = useCallback(
    (updater: (prev: QueueItem[]) => QueueItem[]) => {
      setQueue((prev) => {
        const next = updater(prev);
        queueRef.current = next;
        return next;
      });
    },
    []
  );

  const startProgressForItem = useCallback(
    (idx: number) => {
      let elapsed = 0;
      const tick = 500;

      const interval = setInterval(() => {
        elapsed += tick;
        const seconds = elapsed / 1000;

        let progress: number;
        let statusText: string;

        if (seconds < 5) {
          progress = Math.min(seconds * 4, 20);
          statusText = "Checking for YouTube captions...";
        } else if (seconds < 15) {
          progress = 20 + (seconds - 5) * 1.5;
          statusText = "Downloading audio...";
        } else if (seconds < 300) {
          progress = Math.min(
            35 + 55 * (1 - Math.exp(-((seconds - 15) / 120))),
            90
          );
          const pct = Math.round(progress);
          statusText = `Transcribing with Whisper... ~${pct}%`;
        } else {
          progress = Math.min(90 + (seconds - 300) * 0.01, 95);
          statusText = "Almost done... Processing a long video.";
        }

        updateQueue((prev) =>
          prev.map((item, i) =>
            i === idx ? { ...item, progress, statusText } : item
          )
        );
      }, tick);

      progressIntervals.current.set(idx, interval);
    },
    [updateQueue]
  );

  const stopProgressForItem = useCallback((idx: number) => {
    const interval = progressIntervals.current.get(idx);
    if (interval) {
      clearInterval(interval);
      progressIntervals.current.delete(idx);
    }
  }, []);

  const processNext = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    while (true) {
      const idx = queueRef.current.findIndex(
        (item) => item.status === "pending"
      );
      if (idx < 0) break;

      const itemUrl = queueRef.current[idx].url;
      updateQueue((prev) =>
        prev.map((item, i) =>
          i === idx
            ? {
                ...item,
                status: "processing",
                progress: 0,
                statusText: "Checking for YouTube captions...",
              }
            : item
        )
      );
      startProgressForItem(idx);

      // Quick title fetch via oEmbed (non-blocking — don't fail if this errors)
      try {
        const oembedRes = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(itemUrl)}&format=json`
        );
        if (oembedRes.ok) {
          const oembed = await oembedRes.json();
          if (oembed.title) {
            updateQueue((prev) =>
              prev.map((item, i) =>
                i === idx ? { ...item, title: oembed.title } : item
              )
            );
          }
        }
      } catch {
        // Ignore — title is optional, we'll get it from the transcript API response
      }

      try {
        const res = await fetch("/api/transcripts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: itemUrl }),
        });
        const data = await res.json();

        stopProgressForItem(idx);

        if (res.ok) {
          // Update library and focus the newly created transcript.
          if (data?.id) {
            selectTranscript(data.id);
          }
          fetchTranscripts(search);
          updateQueue((prev) =>
            prev.map((item, i) =>
              i === idx
                ? {
                    ...item,
                    status: "completed",
                    title: data.title,
                    id: data.id,
                    progress: 100,
                    statusText: "",
                  }
                : item
            )
          );

          // Remove completed item from queue after a short delay
          setTimeout(() => {
            updateQueue((prev) => prev.filter((_, i) => i !== idx));
          }, 2500);
        } else {
          let errorMsg = data.error || "Failed";
          if (res.status === 429) {
            errorMsg =
              "YouTube is temporarily limiting requests. Please wait a minute and try again.";
          } else if (res.status === 403) {
            errorMsg =
              "YouTube is blocking requests from your current network. Try disabling your VPN.";
          }
          updateQueue((prev) =>
            prev.map((item, i) =>
              i === idx
                ? {
                    ...item,
                    status: "failed",
                    error: errorMsg,
                    progress: 0,
                    statusText: "",
                  }
                : item
            )
          );
        }
      } catch {
        stopProgressForItem(idx);
        updateQueue((prev) =>
          prev.map((item, i) =>
            i === idx
              ? {
                  ...item,
                  status: "failed",
                  error: "Network error",
                  progress: 0,
                  statusText: "",
                }
              : item
          )
        );
      }
    }

    processingRef.current = false;
  }, [
    updateQueue,
    startProgressForItem,
    stopProgressForItem,
    fetchTranscripts,
    search,
    selectTranscript,
  ]);

  function addToQueue(urls: string[]) {
    const newItems: QueueItem[] = urls.map((u) => ({
      url: u,
      status: "pending" as const,
      progress: 0,
      statusText: "",
    }));

    // Update ref synchronously so processNext can see new items immediately
    queueRef.current = [...queueRef.current, ...newItems];
    setQueue([...queueRef.current]);

    if (!processingRef.current) {
      processNext();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = url.trim();
    if (!trimmed) {
      setError("Please enter a YouTube URL.");
      return;
    }

    if (!isYouTubeUrl(trimmed)) {
      setError("Please enter a valid YouTube URL.");
      return;
    }

    addToQueue([trimmed]);
    setUrl("");
  }

  const isProcessing = queue.some((q) => q.status === "processing");
  const completedCount = queue.filter((q) => q.status === "completed").length;
  const totalCount = queue.length;
  const hasQueue = queue.length > 0;

  const segments: TranscriptSegment[] =
    video?.transcript ? JSON.parse(video.transcript) : [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div
        className={`grid grid-cols-1 gap-6 ${
          selectedId ? "lg:grid-cols-[640px_minmax(0,1fr)]" : "lg:grid-cols-1"
        }`}
      >
        {/* Left rail: capture + library */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-4 shadow-[0_20px_70px_-55px_rgba(0,0,0,0.9)]">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h1 className="text-base font-medium text-white/80">
                  YouTube Transcript Capture
                </h1>
                <p className="text-sm text-white/45">
                  Paste a YouTube URL. Capture once. Reuse forever.
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="w-full">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type="text"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="h-[51px] pr-10"
                  />
                  {url && (
                    <IconButton
                      size="sm"
                      onClick={() => {
                        setUrl("");
                        setError(null);
                      }}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2"
                      title="Clear"
                    >
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
                        <path d="M6 6l8 8M14 6l-8 8" />
                      </svg>
                    </IconButton>
                  )}
                </div>
                {url.trim() && (
                  <button
                    type="submit"
                    className="shrink-0 rounded-full border border-white/20 bg-white/10 px-8 py-3.5 font-(family-name:--font-geist-pixel) text-[15px] font-medium tracking-[1px] text-white shadow-[0_8px_32px_-12px_rgba(0,0,0,0.4)] backdrop-blur-xl transition-all duration-150 hover:border-white/40 hover:bg-white/25 hover:shadow-[0_12px_48px_-16px_rgba(255,255,255,0.2)] active:bg-white/15 active:scale-[0.98]"
                  >
                    {isProcessing ? "Add" : "Capture"}
                  </button>
                )}
              </div>
            </form>

            {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}

            {/* Queue list */}
            {hasQueue && (
              <div className="mt-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-white/45">
                    {completedCount}/{totalCount} completed
                  </h2>
                  {!isProcessing && (
                    <Button
                      onClick={() => {
                        setQueue([]);
                        queueRef.current = [];
                      }}
                      variant="ghost"
                      size="sm"
                      className="font-mono text-[10px] uppercase tracking-wider text-white/45 hover:text-white"
                    >
                      Clear
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  {queue.map((item, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        if (item.status === "completed" && item.id) {
                          selectTranscript(item.id);
                        }
                      }}
                      disabled={item.status !== "completed"}
                      className={`w-full rounded-xl border border-white/10 bg-[hsl(var(--panel-2))] px-4 py-3 text-left transition ${
                        item.status === "completed"
                          ? "cursor-pointer hover:bg-white/5"
                          : "cursor-default"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Status indicator */}
                        <div className="mt-0.5 shrink-0">
                          {item.status === "pending" && (
                            <span className="inline-block h-3 w-3 rounded-full bg-white/20" />
                          )}
                          {item.status === "processing" && (
                            <span className="inline-block h-3 w-3 rounded-full bg-white/40" />
                          )}
                          {item.status === "completed" && (
                            <svg
                              className="h-3 w-3 text-green-500"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L7 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                          {item.status === "failed" && (
                            <svg
                              className="h-3 w-3 text-red-500"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                            >
                              <path
                                fillRule="evenodd"
                                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </div>

                        {/* Content */}
                        <div className="min-w-0 flex-1">
                          {item.title ? (
                            <p className="truncate text-sm font-medium text-white/75">
                              {item.title}
                            </p>
                          ) : (
                            <p className="truncate text-sm text-white/50">
                              {item.url}
                            </p>
                          )}
                          {item.title && (
                            <p className="truncate text-xs text-white/35">
                              {item.url}
                            </p>
                          )}
                          {item.status === "failed" && item.error && (
                            <p className="mt-0.5 text-xs text-red-500">
                              {item.error}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Progress bar for processing item */}
                      {item.status === "processing" && (
                        <div className="mt-2">
                          <div className="mb-1 flex items-center justify-between">
                            {item.statusText && (
                              <p className="font-(family-name:--font-geist-pixel-square) text-[10px] uppercase tracking-wider text-white/45">
                                {item.statusText}
                              </p>
                            )}
                            <span className="font-mono text-[10px] font-medium tabular-nums text-white/60">
                              {Math.round(item.progress)}%
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-white/30 transition-all duration-700 ease-out"
                              style={{
                                width: `${item.progress}%`,
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-4 shadow-[0_20px_70px_-55px_rgba(0,0,0,0.9)]">
            <div className="mb-4 flex items-center gap-2">
              <Input
                type="text"
                placeholder="Search by title or author..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <IconButton
                onClick={() => setLibraryLayout("tiles")}
                className={`shrink-0 ${libraryLayout === "tiles" ? "bg-white/10 text-white" : ""}`}
                title="Tiles view"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="6" height="6" rx="1" />
                  <rect x="11" y="3" width="6" height="6" rx="1" />
                  <rect x="3" y="11" width="6" height="6" rx="1" />
                  <rect x="11" y="11" width="6" height="6" rx="1" />
                </svg>
              </IconButton>
              <IconButton
                onClick={() => setLibraryLayout("list")}
                className={`shrink-0 ${libraryLayout === "list" ? "bg-white/10 text-white" : ""}`}
                title="List view"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h14M3 10h14M3 14h14" />
                </svg>
              </IconButton>
            </div>

            {libraryLoading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="animate-pulse rounded-lg border border-white/10 bg-[hsl(var(--panel-2))] p-3"
                  >
                    <div className="mb-2 h-24 rounded bg-white/10" />
                    <div className="mb-1 h-3 w-3/4 rounded bg-white/10" />
                    <div className="h-3 w-1/2 rounded bg-white/10" />
                  </div>
                ))}
              </div>
            ) : transcripts.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm text-white/45">
                  {search ? "No transcripts match your search." : "No transcripts yet."}
                </p>
              </div>
            ) : (
              <>
                {libraryLayout === "tiles" ? (
                  <div className="grid grid-cols-2 gap-3">
                    {transcripts.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => selectTranscript(t.id)}
                        className={`group overflow-hidden rounded-lg border text-left shadow-sm transition ${
                          selectedId === t.id
                            ? "border-white/25 ring-2 ring-white/10"
                            : "border-white/10 hover:bg-white/5"
                        }`}
                        title={t.title}
                      >
                        {t.thumbnailUrl ? (
                          <img
                            src={t.thumbnailUrl}
                            alt={t.title}
                            className="h-24 w-full object-cover opacity-40 sepia saturate-50 brightness-110"
                          />
                        ) : (
                          <div className="flex h-24 items-center justify-center bg-white/5 text-xs text-white/25">
                            No thumbnail
                          </div>
                        )}
                        <div className="p-2.5">
                          <p className="line-clamp-2 text-xs font-medium text-white/75">
                            {t.title}
                          </p>
                          <p className="mt-1 truncate text-[11px] text-white/40">
                            {t.author}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-white/10 bg-[hsl(var(--panel-2))]">
                    {transcripts.map((t) => (
                      <div
                        key={t.id}
                        className={`group/row flex w-full items-start gap-3 px-3 py-2 transition ${
                          selectedId === t.id ? "bg-white/5" : "hover:bg-white/5"
                        }`}
                      >
                        <button
                          onClick={() => selectTranscript(t.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-sm font-medium text-white/75">
                            {t.title}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-white/40">
                            {t.author} · {formatDate(t.createdAt)}
                            {t.source ? ` · ${t.source}` : ""}
                          </p>
                        </button>

                        <div className="mt-0.5 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/row:opacity-100">
                          <a
                            href={`/api/transcripts/${t.id}/download`}
                            title="Download as Markdown"
                            className={iconButtonClassName("sm")}
                          >
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
                              <path d="M10 3v10m0 0l-3.5-3.5M10 13l3.5-3.5" />
                              <path d="M3 15v1a1 1 0 001 1h12a1 1 0 001-1v-1" />
                            </svg>
                          </a>
                          <button
                            type="button"
                            title={copiedId === t.id ? "Copied!" : "Copy transcript"}
                            onClick={() => handleCopyFromLibrary(t.id)}
                            className={iconButtonClassName("sm")}
                          >
                            {copiedId === t.id ? (
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
                                <path d="M5 10.5l3 3 7-7" />
                              </svg>
                            ) : (
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
                                <rect x="7" y="7" width="9" height="9" rx="1" />
                                <path d="M4 13V4a1 1 0 011-1h9" />
                              </svg>
                            )}
                          </button>
                          <button
                            type="button"
                            title="Delete"
                            onClick={() => setDeleteId(t.id)}
                            className={`${iconButtonClassName("sm")} hover:bg-red-500/15 hover:text-red-200`}
                          >
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
                              <path d="M4 5h12M8 5V3.5a1 1 0 011-1h2a1 1 0 011 1V5m2 0v10.5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 016 15.5V5" />
                              <path d="M9 9v5M11 9v5" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        {/* Right: transcript viewer */}
        {selectedId && (
        <div className="rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-5 shadow-[0_20px_70px_-55px_rgba(0,0,0,0.9)]">
          {!selectedId ? (
            <div className="flex min-h-[420px] items-center justify-center text-center">
              <div>
                <p className="text-sm font-medium text-white/70">
                  Select a transcript
                </p>
                <p className="mt-1 text-sm text-white/45">
                  Choose something from your library to view it here.
                </p>
              </div>
            </div>
          ) : videoLoading ? (
            <div className="flex min-h-[420px] items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/15 border-t-white/50" />
            </div>
          ) : videoError || !video ? (
            <div className="min-h-[420px]">
              <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {videoError || "Transcript not found."}
              </div>
              <div className="mt-4">
                <Button onClick={clearSelectedTranscript} variant="ghost" size="sm">
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-semibold text-white/80">
                    {video.title}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/45">
                    <span>
                      {video.channelUrl ? (
                        <a
                          href={video.channelUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-white/65 hover:text-white/90 hover:underline"
                        >
                          {video.author}
                        </a>
                      ) : (
                        video.author
                      )}
                    </span>
                    <span>Captured {formatDate(video.createdAt)}</span>
                    <a
                      href={video.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/65 hover:text-white/90 hover:underline"
                    >
                      Watch
                    </a>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={`/api/transcripts/${video.id}/download`}
                    title="Download as Markdown"
                    className={iconButtonClassName()}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M10 3v10m0 0l-3.5-3.5M10 13l3.5-3.5" />
                      <path d="M3 15v1a1 1 0 001 1h12a1 1 0 001-1v-1" />
                    </svg>
                  </a>
                  <button
                    title={copied ? "Copied!" : "Copy transcript"}
                    onClick={() => {
                      const text = segments
                        .map((seg) => `[${formatTimestamp(seg.startMs)}] ${seg.text}`)
                        .join("\n");
                      navigator.clipboard.writeText(text);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className={iconButtonClassName()}
                  >
                    {copied ? (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 10.5l3 3 7-7" />
                      </svg>
                    ) : (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="7" y="7" width="9" height="9" rx="1" />
                        <path d="M4 13V4a1 1 0 011-1h9" />
                      </svg>
                    )}
                  </button>
                  <button
                    title="Delete"
                    onClick={() => setDeleteId(video.id)}
                    className={`${iconButtonClassName()} hover:bg-red-500/15 hover:text-red-200`}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 5h12M8 5V3.5a1 1 0 011-1h2a1 1 0 011 1V5m2 0v10.5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 016 15.5V5" />
                      <path d="M9 9v5M11 9v5" />
                    </svg>
                  </button>
                  <IconButton
                    onClick={clearSelectedTranscript}
                    title="Close transcript"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M6 6l8 8M14 6l-8 8" />
                    </svg>
                  </IconButton>
                </div>
              </div>

              <div className="space-y-0">
                {segments.map((seg, i) => (
                  <div
                    key={i}
                    className={`flex gap-4 rounded px-3 py-2 ${
                      i % 2 === 0 ? "bg-white/5" : ""
                    }`}
                  >
                    <span className="shrink-0 font-mono text-xs leading-6 text-white/30">
                      {formatTimestamp(seg.startMs)}
                    </span>
                    <span className="text-sm leading-6 text-white/70">
                      {seg.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-6 shadow-[0_30px_120px_-60px_rgba(0,0,0,0.95)]">
            <h2 className="mb-2 text-lg font-medium text-white/80">Delete transcript?</h2>
            <p className="mb-4 text-sm text-white/50">
              Are you sure you want to delete this transcript? This action cannot
              be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                onClick={() => setDeleteId(null)}
                disabled={deleting}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  setDeleting(true);
                  try {
                    const res = await fetch(`/api/transcripts/${deleteId}`, {
                      method: "DELETE",
                    });
                    if (res.ok) {
                      setTranscripts((prev) =>
                        prev.filter((t) => t.id !== deleteId)
                      );
                      if (selectedId === deleteId) {
                        clearSelectedTranscript();
                      }
                      setDeleteId(null);
                    }
                  } finally {
                    setDeleting(false);
                  }
                }}
                disabled={deleting}
                variant="destructive"
              >
                {deleting ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex min-h-[calc(100vh-57px)] max-w-7xl items-center justify-center px-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/15 border-t-white/50" />
        </div>
      }
    >
      <HomeInner />
    </Suspense>
  );
}
