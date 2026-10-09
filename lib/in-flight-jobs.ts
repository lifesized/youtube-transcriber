import { cancelTranscription } from "./whisper";

const llmControllers = new Set<AbortController>();

export function beginServerJob(clientSignal?: AbortSignal | null): {
  signal: AbortSignal;
  finish: () => void;
} {
  const controller = new AbortController();
  llmControllers.add(controller);
  const onClientAbort = () => {
    try {
      controller.abort();
    } catch {
      // already aborted
    }
  };
  if (clientSignal) {
    if (clientSignal.aborted) onClientAbort();
    else clientSignal.addEventListener("abort", onClientAbort, { once: true });
  }
  return {
    signal: controller.signal,
    finish() {
      llmControllers.delete(controller);
      if (clientSignal) {
        clientSignal.removeEventListener("abort", onClientAbort);
      }
    },
  };
}

export function cancelInFlightJobs(): { llm: number; whisper: number } {
  let llm = 0;
  for (const controller of llmControllers) {
    try {
      controller.abort();
      llm += 1;
    } catch {
      // ignore
    }
  }
  llmControllers.clear();
  const whisper = cancelTranscription();
  return { llm, whisper };
}
