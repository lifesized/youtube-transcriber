import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
