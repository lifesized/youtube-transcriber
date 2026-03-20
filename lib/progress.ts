import { EventEmitter } from "events";

export interface ProgressEvent {
  stage: "fetching_captions" | "downloading" | "transcribing" | "diarizing" | "done" | "error";
  progress: number; // 0-100
  statusText: string;
  videoId?: string;
}

export const transcriptionProgress = new EventEmitter<{
  progress: [ProgressEvent];
}>();
