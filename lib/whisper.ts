import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { TranscriptSegment } from "./types";

const YTDLP_PATH = "/opt/homebrew/bin/yt-dlp";
const PYTHON_BIN = path.join(process.cwd(), ".venv/bin/python");
const OPENAI_WHISPER_CLI = path.join(process.cwd(), ".venv/bin/whisper");
const WHISPER_BACKEND_OVERRIDE = process.env.WHISPER_BACKEND?.trim().toLowerCase();
const WHISPER_DEVICE_OVERRIDE = process.env.WHISPER_DEVICE?.trim().toLowerCase();
const MLX_WHISPER_MODEL_OVERRIDE = process.env.MLX_WHISPER_MODEL?.trim();

type WhisperBackend = "mlx" | "openai";

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
        'WHISPER_BACKEND=mlx was requested but Python module "mlx_whisper" is not installed in .venv.'
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
