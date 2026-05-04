import { EventEmitter } from "events";

export type ProgressStage =
  | "fetching_captions"
  | "downloading"
  | "transcribing"
  | "diarizing"
  | "done"
  | "error";

export interface ProgressEvent {
  stage: ProgressStage;
  progress: number; // 0-100
  statusText: string;
  videoId?: string;
}

export const transcriptionProgress = new EventEmitter<{
  progress: [ProgressEvent];
}>();
