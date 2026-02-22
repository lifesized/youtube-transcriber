import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env.YTT_API_URL || "http://127.0.0.1:19720";

// ---------------------------------------------------------------------------
// Types (mirrors lib/types.ts — kept inline to avoid cross-package imports)
// ---------------------------------------------------------------------------

interface TranscriptSegment {
  text: string;
  startMs: number;
  durationMs: number;
  speaker?: string;
}

interface Video {
  id: string;
  videoId: string;
  title: string;
  author: string;
  videoUrl: string;
  source?: string;
  transcript: string; // JSON string of TranscriptSegment[]
  createdAt: string;
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
      throw new Error(
        "YouTube Transcriber is not running. Start it with: npm run dev"
      );
    }
    throw err;
  }
}

async function apiJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    throw new Error((body.error as string) || `API error ${res.status}`);
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${String(hours).padStart(2, "0")}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

function formatTranscript(video: Video): string {
  const segments: TranscriptSegment[] = JSON.parse(video.transcript);
  const lines = [
    `Title: ${video.title}`,
    `Author: ${video.author}`,
    `URL: ${video.videoUrl}`,
    `Source: ${video.source || "unknown"}`,
    "",
  ];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const prev = segments[i - 1];
    const speakerChanged = seg.speaker && (!prev || prev.speaker !== seg.speaker);
    const prefix = speakerChanged ? `[${seg.speaker}] ` : "";
    lines.push(`[${formatTimestamp(seg.startMs)}] ${prefix}${seg.text}`);
  }
  return lines.join("\n");
}

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function errorText(s: string) {
  return { content: [{ type: "text" as const, text: s }], isError: true as const };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "youtube-transcriber",
  version: "1.0.0",
});

// --- Tools ----------------------------------------------------------------

server.tool(
  "transcribe",
  "Transcribe a YouTube video. Fetches captions or runs local Whisper. May take several minutes for videos without YouTube captions.",
  { url: z.string().describe("YouTube video URL") },
  async ({ url }) => {
    try {
      const video = await apiJSON<Video>("/api/transcripts", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      const segments: TranscriptSegment[] = JSON.parse(video.transcript);
      const preview = segments.slice(0, 10).map((s) => s.text).join(" ");
      return text(
        [
          `Transcribed: ${video.title}`,
          `Author: ${video.author}`,
          `Source: ${video.source}`,
          `ID: ${video.id}`,
          `Segments: ${segments.length}`,
          "",
          `Preview: ${preview}...`,
          "",
          `Use get_transcript with id "${video.id}" for the full timestamped text.`,
        ].join("\n")
      );
    } catch (err: unknown) {
      return errorText((err as Error).message);
    }
  }
);

server.tool(
  "list_transcripts",
  "List all saved transcripts in the library.",
  {},
  async () => {
    try {
      const videos = await apiJSON<Video[]>("/api/transcripts");
      if (videos.length === 0) return text("No transcripts in library.");
      const lines = videos.map(
        (v) => `- [${v.id}] ${v.title} by ${v.author} (${new Date(v.createdAt).toLocaleDateString()})`
      );
      return text(`${videos.length} transcript(s):\n\n${lines.join("\n")}`);
    } catch (err: unknown) {
      return errorText((err as Error).message);
    }
  }
);

server.tool(
  "search_transcripts",
  "Search transcripts by title or author.",
  { query: z.string().describe("Search term") },
  async ({ query }) => {
    try {
      const videos = await apiJSON<Video[]>(`/api/transcripts?q=${encodeURIComponent(query)}`);
      if (videos.length === 0) return text(`No results for "${query}".`);
      const lines = videos.map(
        (v) => `- [${v.id}] ${v.title} by ${v.author}`
      );
      return text(`${videos.length} result(s):\n\n${lines.join("\n")}`);
    } catch (err: unknown) {
      return errorText((err as Error).message);
    }
  }
);

server.tool(
  "get_transcript",
  "Get the full timestamped transcript for a video by ID.",
  { id: z.string().describe("Transcript ID (from list_transcripts)") },
  async ({ id }) => {
    try {
      const video = await apiJSON<Video>(`/api/transcripts/${encodeURIComponent(id)}`);
      return text(formatTranscript(video));
    } catch (err: unknown) {
      return errorText((err as Error).message);
    }
  }
);

server.tool(
  "delete_transcript",
  "Delete a transcript from the library.",
  { id: z.string().describe("Transcript ID to delete") },
  async ({ id }) => {
    try {
      // Fetch title first for confirmation message
      const video = await apiJSON<Video>(`/api/transcripts/${encodeURIComponent(id)}`);
      await apiFetch(`/api/transcripts/${encodeURIComponent(id)}`, { method: "DELETE" });
      return text(`Deleted: ${video.title}`);
    } catch (err: unknown) {
      return errorText((err as Error).message);
    }
  }
);

server.tool(
  "summarize_transcript",
  "Summarize a transcript using an LLM provider. Requires an API key for the chosen provider.",
  {
    id: z.string().describe("Transcript ID to summarize"),
    provider: z.enum(["openai", "anthropic"]).describe("LLM provider"),
    apiKey: z.string().describe("API key for the provider"),
    model: z.string().optional().describe("Model override (defaults: gpt-4o / claude-sonnet-4-5)"),
    format: z.enum(["markdown", "text", "bullets"]).optional().describe("Output format (default: markdown)"),
  },
  async ({ id, provider, apiKey, model, format }) => {
    try {
      const result = await apiJSON<{ summary: string; model_used: string }>(
        `/api/transcripts/${encodeURIComponent(id)}/summarize`,
        {
          method: "POST",
          body: JSON.stringify({ provider, apiKey, model, format }),
        }
      );
      return text(`Summary (${result.model_used}):\n\n${result.summary}`);
    } catch (err: unknown) {
      return errorText((err as Error).message);
    }
  }
);

// --- Resources ------------------------------------------------------------

server.resource(
  "transcript",
  new ResourceTemplate("transcript://{id}", { list: undefined }),
  async (uri, { id }) => {
    const video = await apiJSON<Video>(`/api/transcripts/${encodeURIComponent(id as string)}`);
    return {
      contents: [
        {
          uri: uri.href,
          text: formatTranscript(video),
          mimeType: "text/plain",
        },
      ],
    };
  }
);

// --- Start ----------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("YouTube Transcriber MCP server running on stdio");
