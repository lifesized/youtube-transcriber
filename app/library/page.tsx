"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface VideoSummary {
  id: string;
  videoId: string;
  title: string;
  author: string;
  channelUrl: string | null;
  thumbnailUrl: string | null;
  videoUrl: string;
  createdAt: string;
  updatedAt: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function LibraryPage() {
  const [transcripts, setTranscripts] = useState<VideoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTranscripts = useCallback(async (query: string) => {
    try {
      const url = query
        ? `/api/transcripts?q=${encodeURIComponent(query)}`
        : "/api/transcripts";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setTranscripts(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchTranscripts("");
  }, [fetchTranscripts]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      fetchTranscripts(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, fetchTranscripts]);

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/transcripts/${deleteId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setTranscripts((prev) => prev.filter((t) => t.id !== deleteId));
      }
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Transcript Library</h1>
      </div>

      {/* Search bar */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search by title or author..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-lg border border-gray-200 p-4"
            >
              <div className="mb-3 h-36 rounded bg-gray-200" />
              <div className="mb-2 h-4 w-3/4 rounded bg-gray-200" />
              <div className="mb-2 h-3 w-1/2 rounded bg-gray-200" />
              <div className="h-3 w-1/3 rounded bg-gray-200" />
            </div>
          ))}
        </div>
      ) : transcripts.length === 0 ? (
        /* Empty state */
        <div className="py-16 text-center">
          <p className="mb-2 text-lg text-gray-500">
            {search ? "No transcripts match your search." : "No transcripts yet."}
          </p>
          {!search && (
            <Link
              href="/"
              className="text-sm text-blue-600 hover:underline"
            >
              Capture your first transcript
            </Link>
          )}
        </div>
      ) : (
        /* Transcript grid */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {transcripts.map((t) => (
            <div
              key={t.id}
              className="group rounded-lg border border-gray-200 shadow-sm transition-shadow hover:shadow-md"
            >
              {/* Thumbnail */}
              <Link href={`/transcripts/${t.id}`}>
                {t.thumbnailUrl ? (
                  <img
                    src={t.thumbnailUrl}
                    alt={t.title}
                    className="h-40 w-full rounded-t-lg object-cover"
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center rounded-t-lg bg-gray-100 text-gray-400">
                    No thumbnail
                  </div>
                )}
              </Link>

              <div className="p-4">
                {/* Title */}
                <Link
                  href={`/transcripts/${t.id}`}
                  className="mb-1 line-clamp-2 text-sm font-semibold hover:text-blue-600"
                >
                  {t.title}
                </Link>

                {/* Author */}
                <p className="mb-2 text-xs text-gray-500">{t.author}</p>

                {/* Date */}
                <p className="mb-3 text-xs text-gray-400">
                  {formatDate(t.createdAt)}
                </p>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <a
                    href={`/api/transcripts/${t.id}/download`}
                    className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    Download
                  </a>
                  <button
                    onClick={() => setDeleteId(t.id)}
                    className="rounded border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h2 className="mb-2 text-lg font-semibold">Delete transcript?</h2>
            <p className="mb-4 text-sm text-gray-500">
              Are you sure you want to delete this transcript? This action cannot
              be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteId(null)}
                disabled={deleting}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
