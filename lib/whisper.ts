import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import type { TranscriptSegment } from "./types";

const YTDLP_PATH = "/opt/homebrew/bin/yt-dlp";
const WHISPER_CLI = path.join(process.cwd(), ".venv/bin/whisper");

interface WhisperJsonSegment {
  start: number;
  end: number;
  text: string;
}

interface WhisperJsonOutput {
  segments: WhisperJsonSegment[];
}

function execFileAsync(
  cmd: string,
  args: string[],
  options?: { timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: options?.timeout ?? 300000 }, (err, stdout, stderr) => {
      if (err) {
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Download audio from a YouTube video using yt-dlp.
 * Returns the path to the downloaded MP3 file.
 */
async function downloadAudio(videoId: string, outputDir: string): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });

  const outputTemplate = path.join(outputDir, `${videoId}.%(ext)s`);

  console.log(`[whisper] Downloading audio for ${videoId}...`);
  const { stderr } = await execFileAsync(YTDLP_PATH, [
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "5",
    "-o", outputTemplate,
    "--no-playlist",
    `https://www.youtube.com/watch?v=${videoId}`,
  ], { timeout: 120000 });

  if (stderr) {
    console.log(`[whisper] yt-dlp stderr: ${stderr.slice(0, 500)}`);
  }

  const audioPath = path.join(outputDir, `${videoId}.mp3`);

  // Verify file exists
  await fs.access(audioPath);

  return audioPath;
}

/**
 * Run Whisper CLI on an audio file and return parsed transcript segments.
 */
async function runWhisper(
  audioPath: string,
  outputDir: string,
  model: string = "base"
): Promise<TranscriptSegment[]> {
  await fs.mkdir(outputDir, { recursive: true });

  console.log(`[whisper] Transcribing with model "${model}"...`);
  const startTime = Date.now();

  await execFileAsync(WHISPER_CLI, [
    audioPath,
    "--model", model,
    "--output_format", "json",
    "--output_dir", outputDir,
  ], { timeout: 600000 }); // 10 minutes max for transcription

  const wallTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Whisper outputs a JSON file named after the input file
  const baseName = path.basename(audioPath, path.extname(audioPath));
  const jsonPath = path.join(outputDir, `${baseName}.json`);

  const jsonContent = await fs.readFile(jsonPath, "utf-8");
  const whisperOutput: WhisperJsonOutput = JSON.parse(jsonContent);

  const segments: TranscriptSegment[] = whisperOutput.segments.map((seg) => ({
    text: seg.text.trim(),
    startMs: Math.round(seg.start * 1000),
    durationMs: Math.round((seg.end - seg.start) * 1000),
  }));

  console.log(
    `[whisper] Transcription complete: ${segments.length} segments, model=${model}, wall-clock=${wallTime}s`
  );

  return segments;
}

/**
 * Transcribe a YouTube video using local Whisper.
 * Downloads audio via yt-dlp, runs Whisper CLI, parses output, cleans up temp files.
 */
export async function transcribeWithWhisper(
  videoId: string,
  model: string = "base"
): Promise<TranscriptSegment[]> {
  const audioDir = path.join("/tmp", "yt-audio");
  const whisperOutDir = path.join("/tmp", "whisper-out", videoId);

  console.log(`[whisper] Starting local transcription for video ${videoId}`);
  const overallStart = Date.now();

  try {
    const audioPath = await downloadAudio(videoId, audioDir);
    const segments = await runWhisper(audioPath, whisperOutDir, model);

    const totalTime = ((Date.now() - overallStart) / 1000).toFixed(1);
    console.log(
      `[whisper] Done: videoId=${videoId}, segments=${segments.length}, model=${model}, total=${totalTime}s`
    );

    return segments;
  } finally {
    // Clean up temp files
    try {
      const audioFile = path.join(audioDir, `${videoId}.mp3`);
      await fs.unlink(audioFile).catch(() => {});
      await fs.rm(whisperOutDir, { recursive: true, force: true }).catch(() => {});
    } catch {
      // Ignore cleanup errors
    }
  }
}
