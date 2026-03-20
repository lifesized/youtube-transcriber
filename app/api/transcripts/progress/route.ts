import { transcriptionProgress, type ProgressEvent } from "@/lib/progress";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      function onProgress(data: ProgressEvent) {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Stream already closed
          transcriptionProgress.removeListener("progress", onProgress);
        }
        if (data.stage === "done" || data.stage === "error") {
          transcriptionProgress.removeListener("progress", onProgress);
          try { controller.close(); } catch { /* already closed */ }
        }
      }

      transcriptionProgress.on("progress", onProgress);

      // Heartbeat so client knows connection is alive
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ stage: "connected", progress: 0, statusText: "Waiting for transcription..." })}\n\n`)
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
