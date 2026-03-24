import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { execFile } from "child_process";
import { promisify } from "util";
import { access, constants } from "fs/promises";
import path from "path";

const execFileAsync = promisify(execFile);

interface Check {
  name: string;
  status: "pass" | "fail" | "warn";
  detail?: string;
}

async function checkBinary(name: string): Promise<Check> {
  try {
    const { stdout } = await execFileAsync("which", [name]);
    return { name, status: "pass", detail: stdout.trim() };
  } catch {
    return { name, status: "fail", detail: `${name} not found in PATH` };
  }
}

async function checkDatabase(): Promise<Check> {
  try {
    const count = await prisma.video.count();
    return {
      name: "database",
      status: "pass",
      detail: `Connected, ${count} transcript(s)`,
    };
  } catch (e) {
    return {
      name: "database",
      status: "fail",
      detail: e instanceof Error ? e.message : "Cannot connect to database",
    };
  }
}

async function checkPython(): Promise<Check> {
  const pythonBin = process.env.WHISPER_PYTHON_BIN || ".venv/bin/python3";
  try {
    const { stdout } = await execFileAsync(pythonBin, ["--version"]);
    return { name: "python", status: "pass", detail: stdout.trim() };
  } catch {
    return {
      name: "python",
      status: "fail",
      detail: `Cannot execute ${pythonBin}`,
    };
  }
}

async function checkWhisper(): Promise<Check> {
  const whisperCli = process.env.WHISPER_CLI || ".venv/bin/whisper";
  try {
    await access(whisperCli, constants.X_OK);
    return { name: "whisper", status: "pass", detail: whisperCli };
  } catch {
    return {
      name: "whisper",
      status: "warn",
      detail: `Whisper CLI not found at ${whisperCli} (local transcription unavailable)`,
    };
  }
}

async function checkTmpDir(): Promise<Check> {
  const tmpDir = path.join(process.cwd(), "tmp");
  try {
    await access(tmpDir, constants.W_OK);
    return { name: "tmp_writable", status: "pass", detail: tmpDir };
  } catch {
    return {
      name: "tmp_writable",
      status: "fail",
      detail: `${tmpDir} is not writable`,
    };
  }
}

function checkEnvVars(): Check {
  const required = ["DATABASE_URL"];
  const recommended = ["WHISPER_CLI", "WHISPER_PYTHON_BIN"];
  const missing = required.filter((v) => !process.env[v]);
  const missingRecommended = recommended.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    return {
      name: "env_vars",
      status: "fail",
      detail: `Missing required: ${missing.join(", ")}`,
    };
  }
  if (missingRecommended.length > 0) {
    return {
      name: "env_vars",
      status: "warn",
      detail: `Missing recommended: ${missingRecommended.join(", ")}`,
    };
  }
  return { name: "env_vars", status: "pass" };
}

export async function GET() {
  const checks = await Promise.all([
    checkDatabase(),
    checkPython(),
    checkWhisper(),
    checkBinary("ffmpeg"),
    checkBinary("yt-dlp"),
    checkTmpDir(),
    Promise.resolve(checkEnvVars()),
  ]);

  const hasFail = checks.some((c) => c.status === "fail");
  const status = hasFail ? "unhealthy" : "healthy";

  return NextResponse.json(
    { status, checks, projectPath: process.cwd() },
    { status: hasFail ? 503 : 200 }
  );
}
