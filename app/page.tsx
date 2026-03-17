"use client";

import { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGroup, motion } from "framer-motion";
import type { TranscriptSegment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconButton, iconButtonClassName } from "@/components/ui/icon-button";
import { LlmLauncher } from "@/components/ui/llm-launcher";

interface QueueItem {
  url: string;
  status: "pending" | "processing" | "completed" | "failed";
  title?: string;
  id?: string;
  error?: string;
  progress: number;
  statusText: string;
  startedAt?: number;
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

interface DebugEvent {
  id: number;
  elapsedSec: number;
  type: string;
  detail: string;
}

interface DebugFilters {
  selection: boolean;
  fetch: boolean;
  animation: boolean;
  layout: boolean;
  state: boolean;
}

interface MotionTuning {
  drawerStiffness: number;
  drawerDamping: number;
  drawerMass: number;
  opacityDuration: number;
  rowStiffness: number;
  rowDamping: number;
  rowMass: number;
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

function safeSegmentCount(transcript: string | undefined): number {
  if (!transcript) return 0;
  try {
    const parsed = JSON.parse(transcript);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

interface MergedBlock {
  startMs: number;
  text: string;
  speaker?: string;
}

/**
 * Merge short transcript segments into larger blocks (~30s each).
 * A new block starts when: the gap exceeds 30s, or the speaker changes.
 */
function mergeSegments(segments: TranscriptSegment[]): MergedBlock[] {
  if (segments.length === 0) return [];
  const BLOCK_DURATION_MS = 10_000;
  const blocks: MergedBlock[] = [];
  let current: MergedBlock = {
    startMs: segments[0].startMs,
    text: segments[0].text,
    speaker: segments[0].speaker,
  };

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const elapsed = seg.startMs - current.startMs;
    const speakerChanged = seg.speaker !== current.speaker;

    if (elapsed >= BLOCK_DURATION_MS || speakerChanged) {
      blocks.push(current);
      current = { startMs: seg.startMs, text: seg.text, speaker: seg.speaker };
    } else {
      current.text += " " + seg.text;
    }
  }
  blocks.push(current);
  return blocks;
}

function eventCategory(type: string): keyof DebugFilters {
  if (type.includes("select.") || type.includes("route.") || type.includes("layout.change")) {
    return "selection";
  }
  if (type.includes("fetch") || type.includes("loading") || type.includes("debounce")) {
    return "fetch";
  }
  if (type.includes(".anim.")) return "animation";
  if (type.includes(".layout.")) return "layout";
  return "state";
}

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id");
  const libraryLayout = searchParams.get("layout") === "tiles" ? "tiles" : "list";

  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [duplicateHint, setDuplicateHint] = useState<{ message: string; id: string } | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [hasCreatedTranscript, setHasCreatedTranscript] = useState(false);

  const [transcripts, setTranscripts] = useState<VideoSummary[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [video, setVideo] = useState<VideoRecord | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [closingVideo, setClosingVideo] = useState<VideoRecord | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [justCompletedIds, setJustCompletedIds] = useState<Set<string>>(new Set());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [completionAlertsEnabled, setCompletionAlertsEnabled] = useState(true);
  const originalTitleRef = useRef<string>("");
  const originalFaviconRef = useRef<string>("");
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([]);
  const [debugPaused, setDebugPaused] = useState(false);
  const [debugCollapsed, setDebugCollapsed] = useState(false);

  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);
  const didInitRef = useRef(false);
  const didRunSearchEffectRef = useRef(false);
  const debugStartRef = useRef<number>(performance.now());
  const debugIdRef = useRef(0);
  const progressIntervals = useRef<Map<number, ReturnType<typeof setInterval>>>(
    new Map()
  );

  const addDebugEvent = useCallback(
    (type: string, detail: string) => {
      if (debugPaused) return;
      const id = ++debugIdRef.current;
      const elapsedSec = (performance.now() - debugStartRef.current) / 1000;
      setDebugEvents((prev) => [{ id, elapsedSec, type, detail }, ...prev].slice(0, 250));
    },
    [debugPaused]
  );

  const fetchTranscripts = useCallback(async (query: string) => {
    const endpoint = query
      ? `/api/transcripts?q=${encodeURIComponent(query)}`
      : "/api/transcripts";
    addDebugEvent("library.fetch.start", `query="${query || "(empty)"}" endpoint="${endpoint}"`);
    try {
      const res = await fetch(endpoint);
      if (!res.ok) {
        addDebugEvent("library.fetch.error", `status=${res.status}`);
        return;
      }
      const data = await res.json();
      setTranscripts(data);
      addDebugEvent("library.fetch.success", `count=${Array.isArray(data) ? data.length : 0}`);
    } catch (error) {
      addDebugEvent("library.fetch.exception", error instanceof Error ? error.message : "unknown");
    } finally {
      setLibraryLoading(false);
      addDebugEvent("library.loading", "setLibraryLoading(false)");
    }
  }, [addDebugEvent]);

  useEffect(() => {
    addDebugEvent("app.mount", "HomeInner mounted");
  }, [addDebugEvent]);

  const setFaviconBadge = useCallback(() => {
    if (typeof document === "undefined") return;

    // Save original favicon on first call
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link && !originalFaviconRef.current) {
      originalFaviconRef.current = link.href;
    }

    const favicon = new Image();
    favicon.crossOrigin = "anonymous";
    favicon.src = link?.href ?? "/favicon.ico";
    favicon.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(favicon, 0, 0, 64, 64);

      // Green badge circle (bottom-right)
      ctx.beginPath();
      ctx.arc(52, 52, 12, 0, 2 * Math.PI);
      ctx.fillStyle = "#22c55e";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fff";
      ctx.stroke();

      // Checkmark
      ctx.beginPath();
      ctx.moveTo(46, 52);
      ctx.lineTo(50, 56);
      ctx.lineTo(58, 47);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      const newHref = canvas.toDataURL("image/png");
      if (link) {
        link.href = newHref;
      } else {
        const newLink = document.createElement("link");
        newLink.rel = "icon";
        newLink.href = newHref;
        document.head.appendChild(newLink);
      }
    };
  }, []);

  const resetTabNotification = useCallback(() => {
    if (typeof document === "undefined") return;

    // Restore original title
    if (originalTitleRef.current) {
      document.title = originalTitleRef.current;
    }

    // Restore original favicon
    if (originalFaviconRef.current) {
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (link) link.href = originalFaviconRef.current;
    }
  }, []);

  const notifyTranscriptReady = useCallback(
    async (title?: string) => {
      const label = title ? `Transcript ready: ${title}` : "Transcript ready";
      setToast(label);
      setTimeout(() => setToast(null), 3000);

      // Update tab title and favicon badge so it's visible from other tabs
      if (typeof document !== "undefined") {
        if (!originalTitleRef.current) originalTitleRef.current = document.title;
        document.title = `✓ ${label}`;
        setFaviconBadge();
      }

      if (!completionAlertsEnabled || typeof window === "undefined") {
        return;
      }

      try {
        const audioContext = new window.AudioContext();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = 880;
        gainNode.gain.value = 0.0001;
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        const now = audioContext.currentTime;
        gainNode.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
        oscillator.start(now);
        oscillator.stop(now + 0.4);
        setTimeout(() => {
          audioContext.close().catch(() => undefined);
        }, 500);
      } catch {
        // Ignore audio limitations (autoplay policy, etc.)
      }

      if (!("Notification" in window)) return;
      if (Notification.permission === "granted") {
        new Notification("YouTube Transcriber", {
          body: label,
          silent: true,
        });
        return;
      }
      if (Notification.permission === "default") {
        try {
          const permission = await Notification.requestPermission();
          if (permission === "granted") {
            new Notification("YouTube Transcriber", {
              body: label,
              silent: true,
            });
          }
        } catch {
          // Ignore notification permission errors
        }
      }
    },
    [completionAlertsEnabled, setFaviconBadge]
  );

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    // Check if user has ever created a transcript
    const hasTranscripts = localStorage.getItem("hasCreatedTranscript") === "true";
    const completionAlerts = localStorage.getItem("completionAlertsEnabled");
    if (completionAlerts !== null) {
      setCompletionAlertsEnabled(completionAlerts === "true");
    }
    setHasCreatedTranscript(hasTranscripts);
    addDebugEvent("ftu.state", `hasCreatedTranscript=${hasTranscripts}`);

    // Restore view preference from localStorage only once on first mount.
    const currentLayout = searchParams.get("layout");
    const savedLayout = localStorage.getItem("libraryLayout");
    if (!currentLayout && savedLayout) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("layout", savedLayout);
      addDebugEvent("layout.restore", `restoring layout=${savedLayout}`);
      router.push(`/?${params.toString()}`, { scroll: false });
    }

    setLibraryLoading(true);
    addDebugEvent("library.loading", "setLibraryLoading(true) initial");
    fetchTranscripts("");
  }, [addDebugEvent, fetchTranscripts, router, searchParams]);

  useEffect(() => {
    // Skip the first run; initial library fetch is handled in the init effect.
    if (!didRunSearchEffectRef.current) {
      didRunSearchEffectRef.current = true;
      addDebugEvent("search.debounce.skip", `initial query="${search}"`);
      return;
    }

    addDebugEvent("search.debounce.schedule", `query="${search}" delayMs=250`);
    const timer = setTimeout(() => {
      setLibraryLoading(true);
      addDebugEvent("search.debounce.fire", `query="${search}"`);
      fetchTranscripts(search);
    }, 250);
    return () => {
      clearTimeout(timer);
      addDebugEvent("search.debounce.cancel", `query="${search}"`);
    };
  }, [addDebugEvent, search, fetchTranscripts]);

  useEffect(() => {
    async function fetchSelectedVideo(id: string) {
      addDebugEvent("video.fetch.start", `id=${id}`);
      // Only update state if values are actually changing to prevent unnecessary re-renders
      setVideo((prev) => (prev === null ? prev : null));
      setVideoError((prev) => (prev === null ? prev : null));
      setVideoLoading((prev) => (prev ? prev : true));
      try {
        const res = await fetch(`/api/transcripts/${id}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setVideoError(data.error || "Transcript not found.");
          addDebugEvent("video.fetch.error", `id=${id} status=${res.status}`);
          return;
        }
        const data = await res.json();
        setVideo(data);
        addDebugEvent("video.fetch.success", `id=${id} segments=${safeSegmentCount(data.transcript)}`);
      } catch {
        setVideoError("Failed to load transcript.");
        addDebugEvent("video.fetch.exception", `id=${id}`);
      } finally {
        setVideoLoading(false);
        addDebugEvent("video.loading", `setVideoLoading(false) id=${id}`);
      }
    }

    if (!selectedId) {
      addDebugEvent("video.selection.clear", "selectedId is empty");
      setVideo((prev) => (prev === null ? prev : null));
      setVideoError((prev) => (prev === null ? prev : null));
      setVideoLoading((prev) => (prev ? false : prev));
      return;
    }

    addDebugEvent("video.selection.change", `selectedId=${selectedId}`);
    fetchSelectedVideo(selectedId);

    // Auto-scroll to the selected transcript
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-transcript-id="${selectedId}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [addDebugEvent, selectedId]);

  useEffect(() => {
    addDebugEvent(
      "state.snapshot",
      `layout=${libraryLayout} selected=${selectedId ?? "none"} closing=${closingVideo?.id ?? "none"} video=${video?.id ?? "none"} videoLoading=${videoLoading}`
    );
  }, [addDebugEvent, libraryLayout, selectedId, closingVideo?.id, video?.id, videoLoading]);

  const selectTranscript = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());

      // Toggle: if clicking the same item, deselect it
      if (selectedId === id) {
        // Preserve video data for exit animation
        setClosingVideo(video);
        addDebugEvent("select.toggle.close", `id=${id} hasVideo=${Boolean(video?.id)}`);

        // Update URL immediately to trigger exit animation
        params.delete("id");
        const qs = params.toString();
        addDebugEvent("route.push", `close id=${id} qs="${qs}"`);
        router.push(qs ? `/?${qs}` : "/", { scroll: false });
      } else {
        setClosingVideo(null);
        params.set("id", id);
        const qs = params.toString();
        addDebugEvent("select.toggle.open", `id=${id} qs="${qs}"`);
        router.push(qs ? `/?${qs}` : "/", { scroll: false });
      }
    },
    [addDebugEvent, router, searchParams, selectedId, video]
  );

  const setLibraryLayout = useCallback(
    (layout: "tiles" | "list") => {
      // Save preference to localStorage
      localStorage.setItem("libraryLayout", layout);
      addDebugEvent("layout.change", `layout=${layout}`);

      const params = new URLSearchParams(searchParams.toString());
      params.set("layout", layout);
      router.push(`/?${params.toString()}`, { scroll: false });
    },
    [addDebugEvent, router, searchParams]
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
        .map((seg, idx) => {
          const prev = segs[idx - 1];
          const speakerChanged = seg.speaker && (!prev || prev.speaker !== seg.speaker);
          const prefix = speakerChanged ? `[${seg.speaker}] ` : "";
          return `[${formatTimestamp(seg.startMs)}] ${prefix}${seg.text}`;
        })
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

        // Fast phase: caption fetching via web scrape typically completes in 2-5s.
        // Ramp quickly to ~80% in the first 5s so the bar looks nearly done
        // when captions are found. If it takes longer (Whisper fallback),
        // the curve flattens and continues slowly toward 95%.
        if (seconds < 3) {
          // Quick ramp: 0 → 60% in 3s (caption fetch + parse)
          progress = seconds * 20;
          statusText = "Fetching captions...";
        } else if (seconds < 6) {
          // 60 → 85% over next 3s (still in caption path)
          progress = 60 + (seconds - 3) * 8.3;
          statusText = "Fetching captions...";
        } else if (seconds < 20) {
          // Caption path didn't resolve — likely downloading audio for Whisper
          progress = 85 + (seconds - 6) * 0.35;
          statusText = "Downloading audio...";
        } else if (seconds < 240) {
          // Whisper transcription: slow climb from ~90 toward 95
          progress = Math.min(
            90 + 5 * (1 - Math.exp(-((seconds - 20) / 120))),
            95
          );
          statusText = "Transcribing with Whisper...";
        } else if (seconds < 360) {
          progress = Math.min(
            95 + 3 * (1 - Math.exp(-((seconds - 240) / 60))),
            98
          );
          statusText = "Identifying speakers...";
        } else {
          progress = Math.min(90 + (seconds - 360) * 0.01, 95);
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
                startedAt: Date.now(),
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
          // Mark that user has created at least one transcript
          localStorage.setItem("hasCreatedTranscript", "true");
          setHasCreatedTranscript(true);

          if (data?.duplicate) {
            // Already transcribed — remove from queue, switch to list view,
            // select the existing item, and show hint below the input.
            updateQueue((prev) => prev.filter((_, i) => i !== idx));
            setSearch("");
            await fetchTranscripts("");
            // Set layout + selection in a single router.push to avoid race conditions
            if (data?.id) {
              localStorage.setItem("libraryLayout", "list");
              setClosingVideo(null);
              const params = new URLSearchParams(searchParams.toString());
              params.set("layout", "list");
              params.set("id", data.id);
              router.push(`/?${params.toString()}`, { scroll: false });
            }
            setDuplicateHint({ message: "This video has already been transcribed.", id: data.id });
            setTimeout(() => setDuplicateHint(null), 6000);
            processingRef.current = false;
            return;
          }

          // Update library and clear search so the new video is visible.
          setSearch("");
          const startedAt = queueRef.current[idx]?.startedAt;
          const elapsedMs = startedAt ? Date.now() - startedAt : 0;
          const shouldAutoOpenTranscript = elapsedMs > 0 && elapsedMs <= 5000;

          if (data?.id && shouldAutoOpenTranscript) {
            localStorage.setItem("libraryLayout", "list");
            setClosingVideo(null);
            const params = new URLSearchParams(searchParams.toString());
            params.set("layout", "list");
            params.set("id", data.id);
            router.push(`/?${params.toString()}`, { scroll: false });
          } else {
            localStorage.setItem("libraryLayout", "list");
            const params = new URLSearchParams(searchParams.toString());
            params.set("layout", "list");
            params.delete("id");
            router.push(`/?${params.toString()}`, { scroll: false });
            setToast("Transcript finished. Use ✨ to summarize.");
            setTimeout(() => setToast(null), 4000);
          }
          fetchTranscripts("");
          void notifyTranscriptReady(data?.title);

          // Show a brief tick on the new transcript in the list
          if (data?.id) {
            setJustCompletedIds((prev) => new Set(prev).add(data.id));
            setTimeout(() => {
              setJustCompletedIds((prev) => {
                const next = new Set(prev);
                next.delete(data.id);
                return next;
              });
            }, 1500);
          }

          // Animate progress bar to 100% while still showing it
          updateQueue((prev) =>
            prev.map((item, i) =>
              i === idx
                ? { ...item, progress: 100, statusText: "Done!" }
                : item
            )
          );

          // Let the 100% animation play, then mark completed
          await new Promise((r) => setTimeout(r, 900));
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
    notifyTranscriptReady,
    router,
    searchParams,
  ]);

  function addToQueue(urls: string[]) {
    resetTabNotification();

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

  function retryItem(index: number) {
    // Update ref synchronously so processNext can see the reset item immediately
    queueRef.current = queueRef.current.map((item, i) =>
      i === index
        ? { ...item, status: "pending" as const, error: undefined, progress: 0, statusText: "" }
        : item
    );
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
    <div className="mx-auto max-w-7xl px-4 py-12">
      <div className="mx-auto max-w-[800px]">
        <div className="space-y-8">
          <section>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold text-white/90">
                  YouTube Transcriber
                </h1>
                <p className="mt-2 text-base text-white/50">
                  YouTube to LLM-ready transcript in one click.
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
                      if (duplicateHint) setDuplicateHint(null);
                    }}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="h-12 pr-12"
                  />
                  {url && (
                    <IconButton
                      size="sm"
                      onClick={() => {
                        setUrl("");
                        setError(null);
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2"
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
                    className="btn-dither shrink-0 rounded-full border border-white/20 bg-white/10 px-8 py-3 font-(family-name:--font-geist-pixel) text-base font-medium tracking-wide text-white shadow-[0_8px_32px_-12px_rgba(0,0,0,0.4)] backdrop-blur-xl transition-all duration-150 hover:border-white/30 hover:bg-white/15 active:bg-white/10 active:scale-[0.98]"
                  >
                    {isProcessing ? "Add" : "Extract"}
                  </button>
                )}
              </div>
            </form>

            {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
            {duplicateHint && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-white/50">
                <span>{duplicateHint.message}</span>
                <button
                  type="button"
                  onClick={() => {
                    const el = document.querySelector(`[data-transcript-id="${duplicateHint.id}"]`);
                    el?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className="inline-flex items-center rounded-md p-0.5 text-white/40 transition-colors hover:text-white/70"
                  title="Scroll to transcript"
                >
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 4v12M5 11l5 5 5-5" />
                  </svg>
                </button>
              </p>
            )}

            {/* Queue list */}
            {hasQueue && (
              <div className="mt-8">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-mono text-sm font-medium uppercase tracking-wider text-white/50">
                    {completedCount}/{totalCount} completed
                  </h2>
                  <div className="flex items-center gap-2">
                    {!isProcessing && (
                      <Button
                        onClick={() => {
                          setQueue([]);
                          queueRef.current = [];
                        }}
                        variant="ghost"
                        size="sm"
                        className="font-mono text-xs uppercase tracking-wider text-white/45 hover:text-white"
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  {queue.map((item, idx) => (
                    <div
                      key={idx}
                      role="button"
                      tabIndex={item.status === "completed" ? 0 : -1}
                      onClick={() => {
                        if (item.status === "completed" && item.id) {
                          selectTranscript(item.id);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (item.status === "completed" && item.id) {
                            selectTranscript(item.id);
                          }
                        }
                      }}
                      className={`w-full rounded-xl border border-white/10 bg-[hsl(var(--panel-2))] px-4 py-4 text-left transition ${
                        item.status === "completed"
                          ? "cursor-pointer hover:bg-white/5"
                          : "cursor-default"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        {/* Status indicator */}
                        <div className="shrink-0">
                          {item.status === "pending" && (
                            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-white/30" />
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
                          {item.status === "pending" && (
                            <p className="mt-1 text-xs text-white/35">Queued</p>
                          )}
                          {item.status === "failed" && item.error && (
                            <div className="mt-1 flex items-start justify-between gap-2">
                              <p className="text-sm text-red-500">
                                {item.error}
                              </p>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  retryItem(idx);
                                }}
                                className="shrink-0 rounded px-2 py-0.5 text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                              >
                                Retry
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Progress bar for processing item */}
                      {item.status === "processing" && (
                        <div className="mt-4">
                          <div className="mb-2 flex items-center justify-between">
                            {item.statusText && (
                              <p className="font-(family-name:--font-geist-pixel-square) text-xs uppercase tracking-wider text-white/50">
                                {item.statusText}
                              </p>
                            )}
                            <span className="font-mono text-xs font-medium tabular-nums text-white/60">
                              {Math.round(item.progress)}%
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-white/30 transition-all duration-700 ease-out"
                              style={{
                                width: `${item.progress}%`,
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {hasCreatedTranscript && (
            <section className="rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-6 shadow-[0_20px_70px_-55px_rgba(0,0,0,0.9)]">
              <div className="mb-6 flex items-center gap-2">
                <Input
                  type="text"
                  placeholder="Search by title or author..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <IconButton
                  onClick={() => setLibraryLayout("tiles")}
                  className={`h-9 w-9 shrink-0 ${libraryLayout === "tiles" ? "bg-white/10 text-white" : ""}`}
                  title="Tiles view"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1.2" />
                    <rect x="14" y="3" width="7" height="7" rx="1.2" />
                    <rect x="3" y="14" width="7" height="7" rx="1.2" />
                    <rect x="14" y="14" width="7" height="7" rx="1.2" />
                  </svg>
                </IconButton>
                <IconButton
                  onClick={() => setLibraryLayout("list")}
                  className={`h-9 w-9 shrink-0 ${libraryLayout === "list" ? "bg-white/10 text-white" : ""}`}
                  title="List view"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 7h16M4 12h16M4 17h16" />
                  </svg>
                </IconButton>
              </div>

              {libraryLoading ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="animate-pulse rounded-lg border border-white/10 bg-[hsl(var(--panel-2))] p-4"
                    >
                      <div className="mb-2 h-24 rounded bg-white/10" />
                      <div className="mb-2 h-4 w-3/4 rounded bg-white/10" />
                      <div className="h-4 w-1/2 rounded bg-white/10" />
                    </div>
                  ))}
                </div>
              ) : transcripts.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-base text-white/50">
                    {search ? "No transcripts match your search." : "No transcripts yet."}
                  </p>
                </div>
              ) : (
                <>
                  {libraryLayout === "tiles" ? (
                    <div className="grid grid-cols-2 gap-4">
                      {transcripts.map((t) => {
                        const isSelected = selectedId === t.id;

                        return (
                          <a
                            key={t.id}
                            data-transcript-id={t.id}
                            href={t.videoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`group relative w-full overflow-hidden rounded-lg border text-left transition-all duration-200 ${
                              isSelected
                                ? "border-white/20 bg-white/5"
                                : "border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.03]"
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
                              <div className="flex h-24 items-center justify-center bg-white/5 text-sm text-white/30">
                                No thumbnail
                              </div>
                            )}
                            <div className="p-3">
                              <p className="line-clamp-2 text-sm font-medium text-white/75">
                                {t.title}
                              </p>
                              <p className="mt-1 truncate text-xs text-white/40">
                                {t.author}
                              </p>
                            </div>
                          </a>
                        );
                      })}
                    </div>
                  ) : (
                    <LayoutGroup>
                      <div className="overflow-hidden rounded-lg border border-white/10 bg-[hsl(var(--panel-2))]">
                      {transcripts.map((t) => {
                        const isSelected = selectedId === t.id;
                        const isClosing = closingVideo?.id === t.id;
                        const showDrawer = isSelected || isClosing;
                        // Use closingVideo if available (during exit animation), otherwise use current video
                        const videoData = closingVideo || video;
                        const transcriptSegments: TranscriptSegment[] =
                          showDrawer && videoData?.transcript && videoData.id === t.id
                            ? JSON.parse(videoData.transcript)
                            : [];

                        return (
                          <motion.div
                            key={t.id}
                            data-transcript-id={t.id}
                            layout
                            transition={{
                              layout: {
                                type: "spring",
                                stiffness: 300,
                                damping: 36,
                                mass: 0.9,
                              },
                            }}
                            onLayoutAnimationStart={() => {
                              addDebugEvent("list.row.layout.start", `id=${t.id}`);
                            }}
                            onLayoutAnimationComplete={() => {
                              addDebugEvent("list.row.layout.complete", `id=${t.id}`);
                            }}
                          >
                            <div
                              className={`group/row relative flex w-full items-center gap-4 px-4 py-3 transition-all ${
                                isSelected
                                  ? "bg-white/10 shadow-[inset_3px_0_0_0_rgba(255,255,255,0.3)]"
                                  : "hover:bg-white/5"
                              }`}
                            >
                              {justCompletedIds.has(t.id) && (
                                <span
                                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500/15 text-green-400 animate-[fadeTickOut_1.5s_ease-in-out_forwards]"
                                >
                                  <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L7 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                </span>
                              )}
                              <button
                                onClick={() => selectTranscript(t.id)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <p className="truncate text-base font-medium text-white/75">
                                  {t.title}
                                </p>
                                <p className="mt-1 truncate text-sm text-white/40">
                                  {t.author} · {formatDate(t.createdAt)}
                                  {t.source ? ` · ${t.source}` : ""}
                                </p>
                              </button>

                              <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover/row:opacity-100">
                                <LlmLauncher
                                  videoId={t.id}
                                  videoTitle={t.title}
                                  onToast={(msg) => {
                                    setToast(msg);
                                    setTimeout(() => setToast(null), 2500);
                                  }}
                                />
                                <a
                                  href={`/api/transcripts/${t.id}/download`}
                                  title="Download as Markdown"
                                  className={`${iconButtonClassName("sm")} group/dl`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <svg
                                    className="transition-transform duration-300 group-hover/dl:translate-y-0.5"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 20 20"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.75"
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopyFromLibrary(t.id);
                                  }}
                                  className={`${iconButtonClassName("sm")} group/cp`}
                                >
                                  {copiedId === t.id ? (
                                    <svg
                                      className="transition-transform duration-300"
                                      width="16"
                                      height="16"
                                      viewBox="0 0 20 20"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.75"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <path d="M5 10.5l3 3 7-7" />
                                    </svg>
                                  ) : (
                                    <svg
                                      className="transition-transform duration-300 group-hover/cp:scale-110"
                                      width="16"
                                      height="16"
                                      viewBox="0 0 20 20"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.75"
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteId(t.id);
                                  }}
                                  className={`${iconButtonClassName("sm")} group/del hover:bg-red-500/15 hover:text-red-200`}
                                >
                                  <svg
                                    className="transition-transform duration-300 group-hover/del:-rotate-6"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 20 20"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.75"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M4 5h12M8 5V3.5a1 1 0 011-1h2a1 1 0 011 1V5m2 0v10.5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 016 15.5V5" />
                                    <path d="M9 9v5M11 9v5" />
                                  </svg>
                                </button>
                              </div>
                            </div>

                            {/* Transcript drawer */}
                            {showDrawer && (
                              <motion.div
                                key={`list-drawer-${t.id}`}
                                initial={{ opacity: 0, height: 0 }}
                                animate={{
                                  opacity: isSelected ? 1 : 0,
                                  height: isSelected ? "auto" : 0,
                                }}
                                onAnimationStart={() => {
                                  addDebugEvent(
                                    "list.drawer.anim.start",
                                    `id=${t.id} selected=${isSelected} closing=${isClosing}`
                                  );
                                }}
                                onLayoutAnimationStart={() => {
                                  addDebugEvent("list.drawer.layout.start", `id=${t.id}`);
                                }}
                                onLayoutAnimationComplete={() => {
                                  addDebugEvent("list.drawer.layout.complete", `id=${t.id}`);
                                }}
                                transition={{
                                  height: {
                                    type: "spring",
                                    stiffness: 240,
                                    damping: 32,
                                    mass: 0.95,
                                  },
                                  opacity: {
                                    duration: 0.28,
                                    ease: "easeOut",
                                  },
                                }}
                                onAnimationComplete={() => {
                                  addDebugEvent(
                                    "list.drawer.anim.complete",
                                    `id=${t.id} selected=${isSelected} closing=${isClosing}`
                                  );
                                  if (!isSelected) {
                                    setClosingVideo((prev) => (prev?.id === t.id ? null : prev));
                                  }
                                }}
                                className="overflow-hidden"
                              >
                                <div className="border-t border-white/10 bg-white/5 px-6 py-6">
                                  {videoLoading ? (
                                    <div className="flex items-center justify-center py-8">
                                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-white/50" />
                                    </div>
                                  ) : videoError ? (
                                    <p className="py-4 text-center text-sm text-red-500">
                                      {videoError}
                                    </p>
                                  ) : transcriptSegments.length > 0 ? (
                                    <div className="space-y-4">
                                      {mergeSegments(transcriptSegments).map((block, idx, blocks) => {
                                        const showSpeaker = block.speaker && (
                                          idx === 0 || blocks[idx - 1]?.speaker !== block.speaker
                                        );
                                        return (
                                          <div key={idx}>
                                            {showSpeaker && (
                                              <p className="mb-1 text-xs font-medium text-white/50">
                                                {block.speaker}
                                              </p>
                                            )}
                                            <div className="flex items-baseline gap-3">
                                              <span className="w-10 shrink-0 text-right font-mono text-xs leading-relaxed text-white/35">
                                                {formatTimestamp(block.startMs)}
                                              </span>
                                              <p className="text-sm leading-relaxed text-white/70">
                                                {block.text}
                                              </p>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <p className="py-4 text-center text-sm text-white/50">
                                      No transcript available
                                    </p>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </motion.div>
                        );
                      })}
                      </div>
                    </LayoutGroup>
                  )}
                </>
              )}

              {/* Footer */}
              <div className="mt-8 flex items-center justify-between">
                <a
                  href="/settings"
                  className="text-white/35 transition-colors hover:text-white/60"
                  title="Settings"
                >
                  <svg
                    className="h-5 w-5"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path fillRule="evenodd" d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.454 7.454 0 0 0-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 0 0-2.282.819l-.922 1.597a1.875 1.875 0 0 0 .432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 0 0 0 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 0 0-.432 2.385l.922 1.597a1.875 1.875 0 0 0 2.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 0 0 2.28-.819l.923-1.597a1.875 1.875 0 0 0-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 0 0 0-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 0 0-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 0 0-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 0 0-1.85-1.567h-1.843ZM12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z" clipRule="evenodd" />
                  </svg>
                </a>
                <a
                    href="https://github.com/lifesized/youtube-transcriber"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/35 transition-colors hover:text-white/60"
                    title="View on GitHub"
                  >
                    <svg
                      className="h-5 w-5"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                        clipRule="evenodd"
                      />
                    </svg>
                </a>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-white/15 bg-[hsl(var(--panel))] px-4 py-2.5 text-sm text-white/80 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)]">
          {toast}
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-8 shadow-[0_30px_120px_-60px_rgba(0,0,0,0.95)]">
            <h2 className="mb-3 text-xl font-semibold text-white/90">Delete transcript?</h2>
            <p className="mb-6 text-base text-white/60">
              Are you sure you want to delete this transcript? This action cannot
              be undone.
            </p>
            <div className="flex justify-end gap-4">
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
