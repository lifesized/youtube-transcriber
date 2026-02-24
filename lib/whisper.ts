import { execFile, execSync } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { TranscriptSegment } from "./types";

export type ProgressCallback = (event: { stage: string; progress: number; statusText: string }) => void;

// Concurrency lock: only one transcription at a time to prevent memory exhaustion
let transcriptionInProgress = false;

const YTDLP_PATH = "/opt/homebrew/bin/yt-dlp";
// Avoid hard-referencing `.venv/*` so builds don't depend on local symlinks.
const PYTHON_BIN = process.env.WHISPER_PYTHON_BIN?.trim() || "python3";
const OPENAI_WHISPER_CLI = process.env.WHISPER_CLI?.trim() || "whisper";
const WHISPER_BACKEND_OVERRIDE = process.env.WHISPER_BACKEND?.trim().toLowerCase();
const WHISPER_DEVICE_OVERRIDE = process.env.WHISPER_DEVICE?.trim().toLowerCase();
const MLX_WHISPER_MODEL_OVERRIDE = process.env.MLX_WHISPER_MODEL?.trim();
const HF_TOKEN = process.env.HF_TOKEN?.trim();

type WhisperBackend = "mlx" | "openai";

interface DiarizationSegment {
  speaker: string;
  start: number;
  end: number;
}

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
    const child = execFile(cmd, args, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });

    const timeoutMs = options?.timeout ?? 300000;
    const timer = setTimeout(() => {
      console.log(`[whisper] Process timed out after ${timeoutMs}ms, sending SIGTERM...`);
      child.kill('SIGTERM');
      // Force kill after 5 seconds if still alive
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
          console.log('[whisper] Sent SIGKILL after SIGTERM timeout');
        } catch { /* already dead */ }
      }, 5000);
    }, timeoutMs);
  });
}

function cleanupOrphanedProcesses(): void {
  const patterns = ["mlx_whisper", "openai-whisper", "whisper.*--model", "yt-dlp.*youtube"];
  for (const pattern of patterns) {
    try {
      const pids = execSync(
        `pgrep -f "${pattern}" 2>/dev/null || true`,
        { encoding: "utf-8" }
      ).trim();
      if (pids) {
        const pidList = pids.split("\n").filter(Boolean);
        console.log(`[whisper] Found ${pidList.length} orphaned process(es) matching "${pattern}": ${pidList.join(", ")}`);
        for (const pid of pidList) {
          try {
            process.kill(parseInt(pid, 10), "SIGKILL");
            console.log(`[whisper] Killed orphaned process ${pid}`);
          } catch { /* already dead */ }
        }
      }
    } catch { /* pgrep not available or no matches */ }
  }
}

// Run cleanup on module load
cleanupOrphanedProcesses();

function getWhisperBackend(): WhisperBackend {
  if (WHISPER_BACKEND_OVERRIDE === "mlx" || WHISPER_BACKEND_OVERRIDE === "openai") {
    return WHISPER_BACKEND_OVERRIDE;
  }
  if (WHISPER_BACKEND_OVERRIDE && WHISPER_BACKEND_OVERRIDE !== "auto") {
    console.warn(
      `[whisper] Ignoring invalid WHISPER_BACKEND="${process.env.WHISPER_BACKEND}". Use "auto", "mlx", or "openai".`
    );
  }
  if (process.platform === "darwin" && os.arch() === "arm64") {
    return "mlx";
  }
  return "openai";
}

function getOpenAiWhisperDevice(): string {
  if (WHISPER_DEVICE_OVERRIDE === "cpu" || WHISPER_DEVICE_OVERRIDE === "mps") {
    return WHISPER_DEVICE_OVERRIDE;
  }
  if (WHISPER_DEVICE_OVERRIDE && WHISPER_DEVICE_OVERRIDE !== "auto") {
    console.warn(
      `[whisper] Ignoring invalid WHISPER_DEVICE="${process.env.WHISPER_DEVICE}". Use "auto", "cpu", or "mps".`
    );
  }
  if (process.platform === "darwin" && os.arch() === "arm64") {
    return "mps";
  }
  return "cpu";
}

function getWhisperTimeoutMs(): number {
  const raw = process.env.WHISPER_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 480_000;
}

async function isMlxWhisperAvailable(): Promise<boolean> {
  try {
    await execFileAsync(
      PYTHON_BIN,
      ["-c", "import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('mlx_whisper') else 1)"],
      { timeout: 5000 }
    );
    return true;
  } catch {
    return false;
  }
}

function expectedJsonPath(audioPath: string, outputDir: string): string {
  const baseName = path.basename(audioPath, path.extname(audioPath));
  return path.join(outputDir, `${baseName}.json`);
}

async function ensureExpectedOutput(audioPath: string, outputDir: string, label: string): Promise<void> {
  const jsonPath = expectedJsonPath(audioPath, outputDir);
  try {
    await fs.access(jsonPath);
  } catch {
    throw new Error(`${label} produced no output (expected ${jsonPath})`);
  }
}

/**
 * Run OpenAI Whisper CLI on an audio file with a specific device.
 * Throws if the expected JSON output is not produced (e.g., MPS silently skips on NaN).
 */
async function runOpenAiWhisperWithDevice(
  audioPath: string,
  outputDir: string,
  model: string,
  device: string,
  timeoutMs: number
): Promise<void> {
  const args = [
    audioPath,
    "--model", model,
    "--output_format", "json",
    "--output_dir", outputDir,
  ];
  if (device !== "cpu") {
    args.push("--device", device);
  }
  // MPS can produce unstable FP16 output on some systems/audio (NaNs -> empty output).
  // Force FP32 on MPS for consistency.
  if (device === "mps") {
    args.push("--fp16", "False");
  }
  await execFileAsync(OPENAI_WHISPER_CLI, args, { timeout: timeoutMs });
  await ensureExpectedOutput(audioPath, outputDir, `OpenAI Whisper (${device})`);
}

function getMlxModelCandidates(model: string): string[] {
  if (MLX_WHISPER_MODEL_OVERRIDE) {
    return [MLX_WHISPER_MODEL_OVERRIDE];
  }
  if (model.includes("/")) {
    return [model];
  }
  const candidates = [
    `mlx-community/whisper-${model}-mlx`,
    `mlx-community/whisper-${model}`,
  ];
  return [...new Set(candidates)];
}

async function runMlxWhisper(audioPath: string, outputDir: string, model: string, timeoutMs: number): Promise<void> {
  const jsonPath = expectedJsonPath(audioPath, outputDir);
  const candidates = getMlxModelCandidates(model);
  let lastError = "";

  for (const candidate of candidates) {
    try {
      // Use Python module API directly to avoid CLI drift and keep output shape stable.
      const script =
        "import json, sys;" +
        "from mlx_whisper import transcribe;" +
        "audio, model_name, out_path = sys.argv[1:4];" +
        "res = transcribe(audio, path_or_hf_repo=model_name);" +
        "f = open(out_path, 'w', encoding='utf-8');" +
        "json.dump({'segments': res.get('segments', [])}, f);" +
        "f.close()";
      await execFileAsync(PYTHON_BIN, ["-c", script, audioPath, candidate, jsonPath], {
        timeout: timeoutMs,
      });
      await ensureExpectedOutput(audioPath, outputDir, `MLX Whisper (${candidate})`);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.log(`[whisper] mlx candidate failed (${candidate}): ${lastError}`);
    }
  }

  throw new Error(`MLX backend failed for all model candidates: ${candidates.join(", ")} (${lastError})`);
}

/**
 * Download audio from a YouTube video using yt-dlp.
 * Returns the path to the downloaded MP3 file.
 */
export async function downloadAudio(videoId: string, outputDir: string, onProgress?: ProgressCallback): Promise<string> {
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

  onProgress?.({ stage: "transcribing", progress: 40, statusText: "Transcribing with Whisper..." });

  return audioPath;
}

/**
 * Run Whisper on an audio file and return parsed transcript segments.
 * On Apple Silicon, MLX is preferred when available; otherwise OpenAI Whisper is used.
 */
async function runWhisper(
  audioPath: string,
  outputDir: string,
  model: string = "base"
): Promise<TranscriptSegment[]> {
  await fs.mkdir(outputDir, { recursive: true });

  const requestedBackend = getWhisperBackend();
  const timeoutMs = getWhisperTimeoutMs();
  const openAiDevice = getOpenAiWhisperDevice();
  const mlxAvailable = await isMlxWhisperAvailable();
  const backend = requestedBackend === "mlx" && !mlxAvailable ? "openai" : requestedBackend;
  if (requestedBackend === "mlx" && !mlxAvailable) {
    if (WHISPER_BACKEND_OVERRIDE === "mlx") {
      throw new Error(
        'WHISPER_BACKEND=mlx was requested but Python module "mlx_whisper" is not installed. Install it (or set WHISPER_BACKEND=openai).'
      );
    }
    console.log('[whisper] MLX backend requested by auto-detect but "mlx_whisper" is missing; using OpenAI Whisper.');
  }
  console.log(
    `[whisper] Transcribing with model "${model}" (backend="${backend}", timeout=${timeoutMs}ms)...`
  );
  const startTime = Date.now();

  let usedBackend = backend;
  let usedDevice = backend === "mlx" ? "apple_silicon" : openAiDevice;
  let fallbackReason: string | null = null;

  try {
    if (backend === "mlx") {
      await runMlxWhisper(audioPath, outputDir, model, timeoutMs);
    } else {
      await runOpenAiWhisperWithDevice(audioPath, outputDir, model, openAiDevice, timeoutMs);
      usedDevice = openAiDevice;
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);

    if (backend === "mlx") {
      fallbackReason = reason;
      console.log(`[whisper] mlx failed (${reason}), falling back to OpenAI Whisper on CPU...`);
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
      await fs.mkdir(outputDir, { recursive: true });
      await runOpenAiWhisperWithDevice(audioPath, outputDir, model, "cpu", timeoutMs);
      usedBackend = "openai";
      usedDevice = "cpu";
    } else if (openAiDevice !== "cpu") {
      fallbackReason = reason;
      console.log(`[whisper] ${openAiDevice} failed (${reason}), falling back to CPU...`);
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
      await fs.mkdir(outputDir, { recursive: true });
      await runOpenAiWhisperWithDevice(audioPath, outputDir, model, "cpu", timeoutMs);
      usedDevice = "cpu";
    } else {
      throw err;
    }
  }

  const wallTime = ((Date.now() - startTime) / 1000).toFixed(1);

  const jsonPath = expectedJsonPath(audioPath, outputDir);

  const jsonContent = await fs.readFile(jsonPath, "utf-8");
  const whisperOutput: WhisperJsonOutput = JSON.parse(jsonContent);

  const segments: TranscriptSegment[] = whisperOutput.segments.map((seg) => ({
    text: seg.text.trim(),
    startMs: Math.round(seg.start * 1000),
    durationMs: Math.round((seg.end - seg.start) * 1000),
  }));

  console.log(
    `[whisper] Transcription complete: ${segments.length} segments, model=${model}, requested_backend=${requestedBackend}, used_backend=${usedBackend}, used_device=${usedDevice}, fallback_reason=${fallbackReason ?? "none"}, wall-clock=${wallTime}s`
  );

  return segments;
}

export function isTranscriptionInProgress(): boolean {
  return transcriptionInProgress;
}

/**
 * Run pyannote.audio speaker diarization on an audio file.
 * Requires HF_TOKEN and pyannote.audio to be installed.
 */
async function runDiarization(
  audioPath: string,
  hfToken: string,
  outDir: string
): Promise<DiarizationSegment[]> {
  const outputPath = path.join(outDir, "diarization.json");
  const timeoutMs = getWhisperTimeoutMs();

  const script =
    "import json, sys, os;" +
    "os.environ['HF_TOKEN'] = sys.argv[2];" +
    "from pyannote.audio import Pipeline;" +
    "pipeline = Pipeline.from_pretrained('pyannote/speaker-diarization-3.1', use_auth_token=sys.argv[2]);" +
    "diarization = pipeline(sys.argv[1]);" +
    "segments = [];" +
    "[segments.append({'speaker': speaker, 'start': turn.start, 'end': turn.end}) for turn, _, speaker in diarization.itertracks(yield_label=True)];" +
    "f = open(sys.argv[3], 'w', encoding='utf-8');" +
    "json.dump(segments, f);" +
    "f.close()";

  console.log("[whisper] Running speaker diarization with pyannote.audio...");
  await execFileAsync(PYTHON_BIN, ["-c", script, audioPath, hfToken, outputPath], {
    timeout: timeoutMs,
  });

  const jsonContent = await fs.readFile(outputPath, "utf-8");
  const segments: DiarizationSegment[] = JSON.parse(jsonContent);
  console.log(`[whisper] Diarization complete: ${segments.length} speaker segments found`);
  return segments;
}

/**
 * Merge Whisper transcript segments with diarization speaker labels.
 * Each transcript segment is assigned the speaker who overlaps most with it.
 * Raw labels (SPEAKER_00, SPEAKER_01) are renamed to Speaker 1, Speaker 2, etc.
 * in order of first appearance.
 */
function mergeSpeakers(
  segments: TranscriptSegment[],
  diarization: DiarizationSegment[]
): TranscriptSegment[] {
  if (diarization.length === 0) return segments;

  const speakerMap = new Map<string, string>();
  let speakerCount = 0;

  function getSpeakerLabel(raw: string): string {
    if (!speakerMap.has(raw)) {
      speakerCount++;
      speakerMap.set(raw, `Speaker ${speakerCount}`);
    }
    return speakerMap.get(raw)!;
  }

  return segments.map((seg) => {
    const segStartSec = seg.startMs / 1000;
    const segEndSec = (seg.startMs + seg.durationMs) / 1000;

    // Find the diarization segment with the most overlap
    let bestSpeaker = "";
    let bestOverlap = 0;

    for (const d of diarization) {
      const overlapStart = Math.max(segStartSec, d.start);
      const overlapEnd = Math.min(segEndSec, d.end);
      const overlap = overlapEnd - overlapStart;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSpeaker = d.speaker;
      }
    }

    return {
      ...seg,
      speaker: bestSpeaker ? getSpeakerLabel(bestSpeaker) : undefined,
    };
  });
}

/**
 * Transcribe a YouTube video using local Whisper.
 * Downloads audio via yt-dlp, runs Whisper CLI, parses output, cleans up temp files.
 * Only one transcription can run at a time to prevent memory exhaustion.
 */
export async function transcribeWithWhisper(
  videoId: string,
  model: string = "base",
  onProgress?: ProgressCallback
): Promise<TranscriptSegment[]> {
  if (transcriptionInProgress) {
    throw new Error("A transcription is already in progress. Please wait and try again.");
  }

  transcriptionInProgress = true;
  const audioDir = path.join("/tmp", "yt-audio");
  const whisperOutDir = path.join("/tmp", "whisper-out", videoId);

  console.log(`[whisper] Starting local transcription for video ${videoId}`);
  const overallStart = Date.now();

  try {
    const audioPath = await downloadAudio(videoId, audioDir, onProgress);
    const segments = await runWhisper(audioPath, whisperOutDir, model);

    // Speaker diarization (opt-in, requires HF_TOKEN)
    let finalSegments = segments;
    if (HF_TOKEN) {
      onProgress?.({ stage: "diarizing", progress: 85, statusText: "Identifying speakers..." });
      try {
        const diarization = await runDiarization(audioPath, HF_TOKEN, whisperOutDir);
        finalSegments = mergeSpeakers(segments, diarization);
      } catch (err) {
        console.log(`[whisper] Diarization failed, proceeding without speakers: ${err instanceof Error ? err.message : err}`);
      }
    }

    const totalTime = ((Date.now() - overallStart) / 1000).toFixed(1);
    console.log(
      `[whisper] Done: videoId=${videoId}, segments=${finalSegments.length}, model=${model}, total=${totalTime}s`
    );

    return finalSegments;
  } finally {
    transcriptionInProgress = false;
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
