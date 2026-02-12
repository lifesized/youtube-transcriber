"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Capturing transcript...");
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = url.trim();
    if (!trimmed) {
      setError("Please enter a YouTube URL.");
      return;
    }

    setLoading(true);
    setStatusMessage("Checking for YouTube captions...");
    timersRef.current = [
      setTimeout(() => setStatusMessage("No captions found. Downloading audio..."), 8000),
      setTimeout(() => setStatusMessage("Transcribing with local AI (Whisper)... This may take a few minutes."), 20000),
      setTimeout(() => setStatusMessage("Still transcribing... Whisper runs locally on your CPU, so longer videos take more time."), 60000),
      setTimeout(() => setStatusMessage("Almost there... Processing a long video."), 180000),
    ];
    try {
      const res = await fetch("/api/transcripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          setError(
            "YouTube is temporarily limiting requests. Please wait a minute and try again."
          );
        } else if (res.status === 403) {
          setError(
            "YouTube is blocking requests from your current network. Try disabling your VPN or connecting from a different network."
          );
        } else {
          setError(data.error || "Something went wrong.");
        }
        return;
      }

      router.push(`/transcripts/${data.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-57px)] max-w-xl flex-col items-center justify-center px-4">
      <h1 className="mb-2 text-3xl font-bold">YouTube Transcript Capture</h1>
      <p className="mb-8 text-center text-gray-500">
        Paste a YouTube video URL to capture and save its transcript.
      </p>

      <form onSubmit={handleSubmit} className="w-full">
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin"
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
                Capturing...
              </span>
            ) : (
              "Capture Transcript"
            )}
          </button>
        </div>
      </form>

      {loading && (
        <p className="mt-4 text-center text-sm text-gray-500">
          {statusMessage}
        </p>
      )}

      {error && (
        <div className="mt-4 w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
