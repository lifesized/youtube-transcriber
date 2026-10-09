import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("falls back to progressive format 18 after an audio-only HTTP 403", async (t) => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "ytt-ytdlp-test-"));
  const outputDir = path.join(fixtureDir, "audio");
  const logPath = path.join(fixtureDir, "calls.log");
  const fakeYtdlpPath = path.join(fixtureDir, "yt-dlp.cjs");
  const previousYtdlpPath = process.env.YTDLP_PATH;
  const previousLogPath = process.env.YTDLP_TEST_LOG;

  t.after(async () => {
    if (previousYtdlpPath === undefined) delete process.env.YTDLP_PATH;
    else process.env.YTDLP_PATH = previousYtdlpPath;
    if (previousLogPath === undefined) delete process.env.YTDLP_TEST_LOG;
    else process.env.YTDLP_TEST_LOG = previousLogPath;
    await rm(fixtureDir, { recursive: true, force: true });
  });

  await writeFile(
    fakeYtdlpPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.YTDLP_TEST_LOG, JSON.stringify(args) + "\\n");
if (!args.includes("-f")) {
  console.error("ERROR: unable to download video data: HTTP Error 403: Forbidden");
  process.exit(1);
}
const outputTemplate = args[args.indexOf("-o") + 1];
const outputPath = outputTemplate.replace("%(ext)s", "mp3");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, "fake audio");
`,
  );
  await chmod(fakeYtdlpPath, 0o755);

  process.env.YTDLP_PATH = fakeYtdlpPath;
  process.env.YTDLP_TEST_LOG = logPath;
  const { downloadAudio } = await import("../lib/whisper.js");

  const audioPath = await downloadAudio("UIEzt1gGCmk", outputDir);

  assert.equal(audioPath, path.join(outputDir, "UIEzt1gGCmk.mp3"));
  const calls = (await readFile(logPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].includes("-f"), false);
  assert.deepEqual(calls[1].slice(0, 2), ["-f", "18"]);
});

test("Tusk-originated downloads skip the yt-dlp browser-cookie fallback", async (t) => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "ytt-ytdlp-tusk-"));
  const outputDir = path.join(fixtureDir, "audio");
  const logPath = path.join(fixtureDir, "calls.log");
  const fakeYtdlpPath = path.join(fixtureDir, "yt-dlp.cjs");
  const previousYtdlpPath = process.env.YTDLP_PATH;
  const previousLogPath = process.env.YTDLP_TEST_LOG;

  t.after(async () => {
    if (previousYtdlpPath === undefined) delete process.env.YTDLP_PATH;
    else process.env.YTDLP_PATH = previousYtdlpPath;
    if (previousLogPath === undefined) delete process.env.YTDLP_TEST_LOG;
    else process.env.YTDLP_TEST_LOG = previousLogPath;
    await rm(fixtureDir, { recursive: true, force: true });
  });

  await writeFile(
    fakeYtdlpPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.YTDLP_TEST_LOG, JSON.stringify(args) + "\\n");
if (args.includes("--cookies-from-browser")) {
  const outputTemplate = args[args.indexOf("-o") + 1];
  const outputPath = outputTemplate.replace("%(ext)s", "mp3");
  fs.mkdirSync(require("node:path").dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, "fake audio");
  process.exit(0);
}
console.error("ERROR: sign in to confirm your age");
process.exit(1);
`
  );
  await chmod(fakeYtdlpPath, 0o755);
  process.env.YTDLP_PATH = fakeYtdlpPath;
  process.env.YTDLP_TEST_LOG = logPath;

  const { downloadAudio } = await import("../lib/whisper.js");
  const { jobContext } = await import("../lib/job-context.js");

  await assert.rejects(
    () =>
      jobContext.run({ jobId: "tusk-job-cookies", tag: "tusk" }, () =>
        downloadAudio("dQw4w9WgXcQ", outputDir, undefined, {
          allowBrowserCookies: false,
        })
      ),
    /age-restricted|authentication|sign in/i
  );
  const tuskCalls = (await readFile(logPath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
  assert.ok(tuskCalls.length >= 1);
  assert.equal(
    tuskCalls.some((args) => args.includes("--cookies-from-browser")),
    false
  );

  await writeFile(logPath, "");
  const localPath = await downloadAudio("dQw4w9WgXcQ", outputDir, undefined, {
    allowBrowserCookies: true,
  });
  assert.equal(localPath, path.join(outputDir, "dQw4w9WgXcQ.mp3"));
  const localCalls = (await readFile(logPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  assert.equal(
    localCalls.some((args) => args.includes("--cookies-from-browser")),
    true
  );
});

test("dropped async context does not enable the browser-cookie fallback", async (t) => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "ytt-ytdlp-nocontext-"));
  const outputDir = path.join(fixtureDir, "audio");
  const logPath = path.join(fixtureDir, "calls.log");
  const fakeYtdlpPath = path.join(fixtureDir, "yt-dlp.cjs");
  const previousYtdlpPath = process.env.YTDLP_PATH;
  const previousLogPath = process.env.YTDLP_TEST_LOG;

  t.after(async () => {
    if (previousYtdlpPath === undefined) delete process.env.YTDLP_PATH;
    else process.env.YTDLP_PATH = previousYtdlpPath;
    if (previousLogPath === undefined) delete process.env.YTDLP_TEST_LOG;
    else process.env.YTDLP_TEST_LOG = previousLogPath;
    await rm(fixtureDir, { recursive: true, force: true });
  });

  await writeFile(
    fakeYtdlpPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.YTDLP_TEST_LOG, JSON.stringify(args) + "\\n");
if (args.includes("--cookies-from-browser")) {
  const outputTemplate = args[args.indexOf("-o") + 1];
  const outputPath = outputTemplate.replace("%(ext)s", "mp3");
  fs.mkdirSync(require("node:path").dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, "fake audio");
  process.exit(0);
}
console.error("ERROR: sign in to confirm your age");
process.exit(1);
`
  );
  await chmod(fakeYtdlpPath, 0o755);
  process.env.YTDLP_PATH = fakeYtdlpPath;
  process.env.YTDLP_TEST_LOG = logPath;

  const { downloadAudio } = await import("../lib/whisper.js");

  await assert.rejects(
    () =>
      downloadAudio("dQw4w9WgXcQ", outputDir, undefined, {
        allowBrowserCookies: false,
      }),
    /age-restricted|authentication|sign in/i
  );
  await assert.rejects(
    () => downloadAudio("oHg5SJYRHA0", outputDir),
    /age-restricted|authentication|sign in/i
  );
  const calls = (await readFile(logPath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
  assert.ok(calls.length >= 2);
  assert.equal(
    calls.some((args) => args.includes("--cookies-from-browser")),
    false
  );
});

test("transcripts route passes allowBrowserCookies from the job tag", () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../app/api/transcripts/route.ts"),
    "utf8"
  );
  assert.match(src, /allowBrowserCookies:\s*job\.tag !== "tusk"/);
});

test("whisper never pgrep-kills and does not clean up on import", () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../lib/whisper.ts"),
    "utf8"
  );
  assert.doesNotMatch(src, /pgrep\s+-f|execSync\([^)]*pgrep/);
  assert.doesNotMatch(src, /cleanupOrphanedProcesses/);
  assert.doesNotMatch(src, /\bexecSync\b/);
  assert.match(src, /cleanupTrackedWhisperProcesses\(\)/);
  const afterExport = src.split("export function cleanupTrackedWhisperProcesses")[1] || "";
  assert.match(afterExport, /downloadAudio[\s\S]*cleanupTrackedWhisperProcesses\(\)/);
});

test("cleanupTrackedWhisperProcesses kills only recorded PIDs", async (t) => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "ytt-whisper-pids-"));
  const previousStateDir = process.env.TRANSCRIBER_STATE_DIR;
  process.env.TRANSCRIBER_STATE_DIR = fixtureDir;

  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  const survivor = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  t.after(async () => {
    if (previousStateDir === undefined) delete process.env.TRANSCRIBER_STATE_DIR;
    else process.env.TRANSCRIBER_STATE_DIR = previousStateDir;
    try {
      child.kill("SIGKILL");
    } catch {
      /* already dead */
    }
    try {
      survivor.kill("SIGKILL");
    } catch {
      /* already dead */
    }
    await rm(fixtureDir, { recursive: true, force: true });
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(child.pid);
  assert.ok(survivor.pid);
  await writeFile(
    path.join(fixtureDir, "whisper-children.json"),
    `${JSON.stringify([child.pid])}\n`
  );

  const { cleanupTrackedWhisperProcesses } = await import("../lib/whisper.js");
  const killed = cleanupTrackedWhisperProcesses();
  assert.equal(killed, 1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.throws(() => process.kill(child.pid as number, 0));
  process.kill(survivor.pid as number, 0);
});
