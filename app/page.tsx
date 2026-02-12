"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";

interface QueueItem {
  url: string;
  status: "pending" | "processing" | "completed" | "failed";
  title?: string;
  id?: string;
  error?: string;
  progress: number;
  statusText: string;
}

function isYouTubeUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+/.test(url);
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);
  const progressIntervals = useRef<Map<number, ReturnType<typeof setInterval>>>(
    new Map()
  );

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

      try {
        const res = await fetch("/api/transcripts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: itemUrl }),
        });
        const data = await res.json();

        stopProgressForItem(idx);

        if (res.ok) {
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
  }, [updateQueue, startProgressForItem, stopProgressForItem]);

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

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="mb-2 text-center text-3xl font-bold">
        YouTube Transcript Capture
      </h1>
      <p className="mb-8 text-center text-gray-500">
        Paste a YouTube video URL to capture and save its transcript.
      </p>

      <form onSubmit={handleSubmit} className="w-full">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError(null);
              }}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 pr-9 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            {url && (
              <button
                type="button"
                onClick={() => {
                  setUrl("");
                  setError(null);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 hover:text-gray-600"
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
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={!url.trim()}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isProcessing ? "Add" : "Capture"}
          </button>
        </div>
      </form>

      {error && (
        <p className="mt-1.5 text-xs text-red-500">{error}</p>
      )}

      {/* Queue list */}
      {hasQueue && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              {completedCount}/{totalCount} completed
            </h2>
            {!isProcessing && (
              <button
                onClick={() => {
                  setQueue([]);
                  queueRef.current = [];
                }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Clear
              </button>
            )}
          </div>

          <div className="space-y-2">
            {queue.map((item, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-gray-200 bg-white px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  {/* Status indicator */}
                  <div className="mt-0.5 flex-shrink-0">
                    {item.status === "pending" && (
                      <span className="inline-block h-3 w-3 rounded-full bg-gray-300" />
                    )}
                    {item.status === "processing" && (
                      <svg
                        className="h-3 w-3 animate-spin text-blue-500"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
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
                    {item.status === "completed" && item.id ? (
                      <Link
                        href={`/transcripts/${item.id}`}
                        className="text-sm font-medium text-blue-600 hover:underline"
                      >
                        {item.title || item.url}
                      </Link>
                    ) : (
                      <p className="truncate text-sm text-gray-700">
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
                    <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all duration-500 ease-out"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                    {item.statusText && (
                      <p className="mt-1 text-xs text-gray-400">
                        {item.statusText}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
