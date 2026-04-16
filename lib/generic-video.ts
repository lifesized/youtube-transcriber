import path from "path";
import { promises as fs } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import type { TranscriptSegment, VideoMetadata, VideoTranscriptResult } from "./types";
import { transcriptionProgress } from "./progress";
import { isWhisperEnabled, getWhisperPriority, getEnabledProviders, transcribeWithProvider } from "./providers";
import { transcribeAudioFileWithWhisper, getYtdlpPath } from "./whisper";

const execFileAsync = promisify(execFile);
const FFMPEG_PATH = process.env.FFMPEG_PATH?.trim() || "ffmpeg";

// Groq/OpenAI Whisper APIs cap uploads at 25MB. Re-encode anything larger.
const CLOUD_UPLOAD_LIMIT_BYTES = 24 * 1024 * 1024;

interface YtDlpInfo {
  id: string;
  extractor: string;
  extractor_key?: string;
  title?: string;
  uploader?: string;
  uploader_id?: string;
  channel?: string;
  channel_url?: string;
  webpage_url?: string;
  thumbnail?: string;
  duration?: number;
}

async function fetchVideoInfo(url: string): Promise<YtDlpInfo> {
  const ytdlp = getYtdlpPath();
  const { stdout } = await execFileAsync(
    ytdlp,
    ["--dump-json", "--no-download", "--no-playlist", url],
    { timeout: 60_000, maxBuffer: 50 * 1024 * 1024 }
  );
  const info = JSON.parse(stdout) as YtDlpInfo;
  if (!info.id) {
    throw new Error(`yt-dlp could not extract an id for ${url}`);
  }
  return info;
}

function metadataFromInfo(info: YtDlpInfo, platform: string): VideoMetadata & { videoId: string } {
  return {
    videoId: `${platform}:${info.id}`,
    title: info.title ?? "Untitled",
    author: info.uploader ?? info.channel ?? info.extractor ?? "Unknown",
    channelUrl: info.channel_url ?? info.webpage_url ?? "",
    thumbnailUrl: info.thumbnail ?? "",
  };
}

function platformFromInfo(info: YtDlpInfo): string {
  const raw = (info.extractor_key || info.extractor || "generic").toLowerCase();
  // yt-dlp extractor keys: "Twitch", "TwitchVod", "Vimeo", "TikTok", "Twitter", "Dailymotion", etc.
  if (raw.startsWith("twitch")) return "twitch";
  if (raw.startsWith("vimeo")) return "vimeo";
  if (raw.startsWith("tiktok")) return "tiktok";
  if (raw.startsWith("twitter") || raw === "x") return "twitter";
  if (raw.startsWith("dailymotion")) return "dailymotion";
  if (raw.startsWith("reddit")) return "reddit";
  if (raw.startsWith("instagram")) return "instagram";
  if (raw.startsWith("facebook")) return "facebook";
  if (raw.startsWith("rumble")) return "rumble";
  if (raw.startsWith("bilibili")) return "bilibili";
  if (raw.startsWith("odysee")) return "odysee";
  if (raw.startsWith("streamable")) return "streamable";
  return raw;
}

async function downloadGenericAudio(url: string, outputId: string): Promise<string> {
  const audioDir = path.join("/tmp", "generic-audio");
  await fs.mkdir(audioDir, { recursive: true });

  const outputTemplate = path.join(audioDir, `${outputId}.%(ext)s`);
  const ytdlp = getYtdlpPath();

  console.log(`[generic] Downloading audio from ${url}...`);
  await execFileAsync(
    ytdlp,
    [
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "9",
      "-o", outputTemplate,
      "--no-playlist",
      url,
    ],
    { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 }
  );

  const audioPath = path.join(audioDir, `${outputId}.mp3`);
  await fs.access(audioPath);
  const { size } = await fs.stat(audioPath);
  console.log(`[generic] Downloaded ${(size / 1024 / 1024).toFixed(1)} MB to ${audioPath}`);
  return audioPath;
}

async function reencodeForCloud(inputPath: string, outputId: string): Promise<string> {
  const outputPath = path.join(path.dirname(inputPath), `${outputId}.compressed.mp3`);
  await fs.unlink(outputPath).catch(() => {});

  console.log(`[generic] Re-encoding audio to 48kbps mono for cloud upload...`);
  await execFileAsync(FFMPEG_PATH, [
    "-y",
    "-i", inputPath,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-b:a", "48k",
    "-f", "mp3",
    outputPath,
  ], { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 });

  const { size } = await fs.stat(outputPath);
  console.log(`[generic] Re-encoded to ${(size / 1024 / 1024).toFixed(1)} MB`);
  return outputPath;
}

async function transcribeAudio(
  audioPath: string,
  videoId: string
): Promise<{ segments: TranscriptSegment[]; source: string }> {
  const [whisperEnabled, whisperPriority, providers] = await Promise.all([
    isWhisperEnabled(),
    getWhisperPriority(),
    getEnabledProviders(),
  ]);

  type Step = { type: "local" } | { type: "cloud"; index: number };
  const steps: Step[] = [];
  for (let i = 0; i < providers.length; i++) steps.push({ type: "cloud", index: i });
  if (whisperEnabled) steps.push({ type: "local" });

  steps.sort((a, b) => {
    const pa = a.type === "local" ? whisperPriority : a.index;
    const pb = b.type === "local" ? whisperPriority : b.index;
    return pa - pb;
  });

  if (steps.length === 0) {
    throw new Error("No transcription services enabled. Turn on at least one provider in Settings.");
  }

  const errors: string[] = [];
  let reencodedPath: string | null = null;

  try {
    for (const step of steps) {
      if (step.type === "cloud") {
        const config = providers[step.index];
        try {
          transcriptionProgress.emit("progress", {
            stage: "transcribing",
            progress: 50,
            statusText: `Transcribing with ${config.provider}...`,
            videoId,
          });

          let uploadPath = audioPath;
          const { size } = await fs.stat(audioPath);
          if (size > CLOUD_UPLOAD_LIMIT_BYTES) {
            if (!reencodedPath) {
              reencodedPath = await reencodeForCloud(audioPath, videoId.replace(/[^a-zA-Z0-9]/g, "_"));
            }
            uploadPath = reencodedPath;
          }

          return await transcribeWithProvider(uploadPath, config);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`[generic] ${config.provider} failed: ${msg}`);
          errors.push(`${config.provider}: ${msg}`);
        }
      } else {
        try {
          console.log(`[generic] Trying local Whisper for ${videoId}...`);
          const segments = await transcribeAudioFileWithWhisper(audioPath, "base", (evt) => {
            transcriptionProgress.emit("progress", {
              stage: evt.stage,
              progress: evt.progress,
              statusText: evt.statusText,
              videoId,
            });
          });
          return { segments, source: "local_whisper" };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`[generic] local Whisper failed: ${msg}`);
          errors.push(`local-whisper: ${msg}`);
        }
      }
    }

    throw new Error(
      `All transcription methods failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  } finally {
    if (reencodedPath) await fs.unlink(reencodedPath).catch(() => {});
  }
}

export async function getGenericTranscript(
  url: string
): Promise<VideoTranscriptResult & { source: string; platform: string; videoUrl: string }> {
  transcriptionProgress.emit("progress", {
    stage: "fetching_captions",
    progress: 5,
    statusText: "Looking up video info...",
    videoId: url,
  });

  const info = await fetchVideoInfo(url);
  const platform = platformFromInfo(info);
  const metadata = metadataFromInfo(info, platform);

  console.log(`[generic] Platform=${platform} id=${info.id} title="${metadata.title}"`);

  transcriptionProgress.emit("progress", {
    stage: "downloading",
    progress: 15,
    statusText: `Downloading audio from ${platform}...`,
    videoId: metadata.videoId,
  });

  const safeOutputId = metadata.videoId.replace(/[^a-zA-Z0-9]/g, "_");
  const audioPath = await downloadGenericAudio(url, safeOutputId);

  try {
    const { segments, source } = await transcribeAudio(audioPath, metadata.videoId);

    transcriptionProgress.emit("progress", {
      stage: "done",
      progress: 100,
      statusText: "Transcription complete",
      videoId: metadata.videoId,
    });

    return {
      ...metadata,
      transcript: segments,
      source: `${platform}_${source}`,
      platform,
      videoUrl: url,
    };
  } finally {
    await fs.unlink(audioPath).catch(() => {});
  }
}
