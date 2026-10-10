import { AsyncLocalStorage } from "node:async_hooks";

export type JobTag = "local";

export type JobContext = {
  jobId: string;
  tag: JobTag;
  signal?: AbortSignal;
};

export const jobContext = new AsyncLocalStorage<JobContext>();

export function currentJobContext(): JobContext | null {
  return jobContext.getStore() ?? null;
}
