export interface TranscriptSegment {
  text: string;
  startMs: number;
  durationMs: number;
  speaker?: string;
}

export interface VideoMetadata {
  videoId: string;
  title: string;
  author: string;
  channelUrl: string;
  thumbnailUrl: string;
}

export interface VideoTranscriptResult extends VideoMetadata {
  transcript: TranscriptSegment[];
}
