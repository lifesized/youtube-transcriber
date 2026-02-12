"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { TranscriptSegment } from "@/lib/types";

interface VideoRecord {
  id: string;
  videoId: string;
  title: string;
  author: string;
  channelUrl: string | null;
  thumbnailUrl: string | null;
  videoUrl: string;
  transcript: string;
  source?: string;
  createdAt: string;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function TranscriptPage() {
  const params = useParams<{ id: string }>();
  const [video, setVideo] = useState<VideoRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function fetchVideo() {
      try {
        const res = await fetch(`/api/transcripts/${params.id}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Transcript not found.");
          return;
        }
        const data = await res.json();
        setVideo(data);
      } catch {
        setError("Failed to load transcript.");
      } finally {
        setLoading(false);
      }
    }
    fetchVideo();
  }, [params.id]);

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-57px)] max-w-3xl items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || "Transcript not found."}
        </div>
        <Link
          href="/library"
          className="mt-4 inline-block text-sm text-blue-600 hover:underline"
        >
          Back to Library
        </Link>
      </div>
    );
  }

  const segments: TranscriptSegment[] = JSON.parse(video.transcript);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        {video.thumbnailUrl && (
          <img
            src={video.thumbnailUrl}
            alt={video.title}
            className="mb-4 w-full rounded-lg"
          />
        )}
        <div className="mb-2 flex items-center gap-2">
          <h1 className="text-2xl font-bold">{video.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
          <span>
            {video.channelUrl ? (
              <a
                href={video.channelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
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
            className="text-blue-600 hover:underline"
          >
            Watch on YouTube
          </a>
        </div>
      </div>

      {/* Actions */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <a
            href={`/api/transcripts/${video.id}/download`}
            title="Download as Markdown"
            className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3v10m0 0l-3.5-3.5M10 13l3.5-3.5" />
              <path d="M3 15v1a1 1 0 001 1h12a1 1 0 001-1v-1" />
            </svg>
          </a>
          <button
            title={copied ? "Copied!" : "Copy transcript"}
            onClick={() => {
              const text = segments.map(seg => `[${formatTimestamp(seg.startMs)}] ${seg.text}`).join('\n');
              navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50"
          >
            {copied ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 10.5l3 3 7-7" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="7" y="7" width="9" height="9" rx="1" />
                <path d="M4 13V4a1 1 0 011-1h9" />
              </svg>
            )}
          </button>
        </div>
        <Link
          href="/library"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Back to Library
        </Link>
      </div>

      {/* Transcript */}
      <div className="space-y-0">
        {segments.map((seg, i) => (
          <div
            key={i}
            className={`flex gap-4 px-3 py-2 ${i % 2 === 0 ? "bg-gray-50" : ""} rounded`}
          >
            <span className="shrink-0 font-mono text-xs text-gray-400 leading-6">
              {formatTimestamp(seg.startMs)}
            </span>
            <span className="text-sm leading-6">{seg.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
