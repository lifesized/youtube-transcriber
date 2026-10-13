import { randomUUID } from "node:crypto";
import {
  cancelTranscriptionByTag,
  cancelTranscriptionForJob,
} from "./whisper";
import {
  jobContext,
  type JobTag,
} from "./job-context";

export type { JobTag } from "./job-context";

export type BeginServerJobOptions = {
  signal?: AbortSignal | null;
  jobId?: string | null;
  tag?: string | null;
};

type ServerJob = {
  id: string;
  tag: JobTag;
  controller: AbortController;
  refs: number;
};

const jobs = new Map<string, ServerJob>();

function jobKey(tag: JobTag, id: string): string {
  return `${tag}:${id}`;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return Boolean(
    value &&
      typeof value === "object" &&
      "aborted" in value &&
      typeof (value as AbortSignal).addEventListener === "function"
  );
}

export function normalizeJobId(raw?: string | null): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (/^[A-Za-z0-9._:-]{8,80}$/.test(value)) return value;
  return randomUUID();
}

export function normalizeJobTag(_raw?: string | null): JobTag {
  return "local";
}

export function beginServerJob(
  input?: AbortSignal | BeginServerJobOptions | null
): {
  signal: AbortSignal;
  jobId: string;
  tag: JobTag;
  run: <T>(fn: () => T) => T;
  finish: () => void;
} {
  const opts: BeginServerJobOptions = isAbortSignal(input)
    ? { signal: input }
    : input || {};
  const jobId = normalizeJobId(opts.jobId);
  const requestedTag = normalizeJobTag(opts.tag);
  const clientSignal = opts.signal ?? null;

  const key = jobKey(requestedTag, jobId);
  let job = jobs.get(key);
  if (!job) {
    job = {
      id: jobId,
      tag: requestedTag,
      controller: new AbortController(),
      refs: 0,
    };
    jobs.set(key, job);
  }
  job.refs += 1;

  const onClientAbort = () => {
    try {
      job.controller.abort();
    } catch {
      // already aborted
    }
  };
  if (clientSignal) {
    if (clientSignal.aborted) onClientAbort();
    else clientSignal.addEventListener("abort", onClientAbort, { once: true });
  }

  const ctx = {
    jobId,
    tag: job.tag,
    signal: job.controller.signal,
  };

  return {
    signal: job.controller.signal,
    jobId,
    tag: job.tag,
    run<T>(fn: () => T): T {
      return jobContext.run(ctx, fn);
    },
    finish() {
      if (clientSignal) {
        clientSignal.removeEventListener("abort", onClientAbort);
      }
      job.refs -= 1;
      if (job.refs <= 0) jobs.delete(jobKey(job.tag, job.id));
    },
  };
}

export function cancelJob(
  jobId: string,
  opts?: { tag?: string }
): { llm: number; whisper: number; ok: boolean } {
  const id = typeof jobId === "string" ? jobId.trim() : "";
  if (!id) return { llm: 0, whisper: 0, ok: false };

  const requiredTag = normalizeJobTag(opts?.tag);
  const job = jobs.get(jobKey(requiredTag, id));
  if (!job) {
    const whisper = cancelTranscriptionForJob(id, { tag: requiredTag });
    return { llm: 0, whisper, ok: whisper > 0 };
  }

  let llm = 0;
  if (job && !job.controller.signal.aborted) {
    try {
      job.controller.abort();
      llm = 1;
    } catch {
      // ignore
    }
  }

  const whisper = cancelTranscriptionForJob(
    id,
    requiredTag ? { tag: requiredTag } : undefined
  );
  return { llm, whisper, ok: llm > 0 || whisper > 0 };
}

export function cancelJobsByTag(tag: JobTag): { llm: number; whisper: number } {
  let llm = 0;
  for (const job of jobs.values()) {
    if (job.tag !== tag || job.controller.signal.aborted) continue;
    try {
      job.controller.abort();
      llm += 1;
    } catch {
      // ignore
    }
  }
  const whisper = cancelTranscriptionByTag(tag);
  return { llm, whisper };
}

