/**
 * Server accepts linkedin: video IDs end to end: POST /api/transcripts →
 * LinkedIn source → yt-dlp → Whisper → SQLite, then the list and the cache.
 *
 * Runs against a scratch SQLite DB (prisma migrate deploy on a temp file)
 * with fake yt-dlp and Whisper CLIs, so nothing touches the network.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytt-linkedin-"));
const ytdlpLog = path.join(dir, "yt-dlp.log");

const EVENT_URL = "https://www.linkedin.com/events/7512647010907250689/";
const POST_URL =
  "https://www.linkedin.com/posts/jane-doe_local-first-activity-7151241570371948544-4Gu7";
const POST_CANONICAL = "https://www.linkedin.com/feed/update/urn:li:activity:7151241570371948544/";
const media = (sig) =>
  `https://dms.licdn.com/playlist/vid/v2/D4E10AQ_EVENT/mp4-360p-30fp-crf28/B4EZ_EVENT/0/1759251600000?e=1760000000&v=beta&t=${sig}`;

function writeScript(name, source) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/usr/bin/env node\n${source}`);
  fs.chmodSync(file, 0o755);
  return file;
}

// Fake yt-dlp: logs each call; --dump-json prints info, -x writes the mp3.
const fakeYtdlp = writeScript(
  "yt-dlp",
  `const fs = require("fs");
const args = process.argv.slice(2);
const url = args[args.length - 1];
fs.appendFileSync(${JSON.stringify(ytdlpLog)}, JSON.stringify(args) + "\\n");
if (url.includes("EXPIRED")) {
  process.stderr.write("ERROR: [generic] Unable to download webpage: HTTP Error 403: Forbidden\\n");
  process.exit(1);
}
if (args.includes("--dump-json")) {
  const page = url.startsWith("https://www.linkedin.com/");
  process.stdout.write(JSON.stringify(page
    ? { id: "7151241570371948544", extractor: "linkedin", extractor_key: "LinkedIn", title: "Jane Doe on LinkedIn: Local-first is back", uploader: "Jane Doe" }
    : { id: "1759251600000", extractor: "generic", extractor_key: "Generic", title: "1759251600000" }));
  process.exit(0);
}
const out = args[args.indexOf("-o") + 1].replace("%(ext)s", "mp3");
fs.writeFileSync(out, "ID3 fake audio");
`
);

// Fake Whisper CLI: writes <output_dir>/<audio basename>.json.
const fakeWhisper = writeScript(
  "whisper",
  `const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
const outDir = args[args.indexOf("--output_dir") + 1];
const base = path.basename(args[0], path.extname(args[0]));
fs.writeFileSync(path.join(outDir, base + ".json"), JSON.stringify({
  segments: [{ start: 0, end: 2.5, text: " Hello from LinkedIn." }],
}));
`
);

const LOCAL_TOKEN = "c".repeat(64);

Object.assign(process.env, {
  DATABASE_URL: `file:${path.join(dir, "linkedin.db")}`,
  YTDLP_PATH: fakeYtdlp,
  WHISPER_CLI: fakeWhisper,
  WHISPER_BACKEND: "openai",
  WHISPER_DEVICE: "cpu",
  WHISPER_PYTHON_BIN: path.join(dir, "no-python"),
  TRANSCRIBER_LOCAL_TOKEN: LOCAL_TOKEN,
});

let POST;
let GET;

before(async () => {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "pipe",
  });
  ({ POST, GET } = await import("../app/api/transcripts/route.ts"));
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

function ytdlpCalls() {
  if (!fs.existsSync(ytdlpLog)) return [];
  return fs.readFileSync(ytdlpLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function post(body) {
  const res = await POST(
    new Request("http://127.0.0.1:19720/api/transcripts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${LOCAL_TOKEN}`,
      },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, data: await res.json() };
}

test("event with an extension-supplied media URL is stored as linkedin:event-<id>", async () => {
  const { status, data } = await post({
    url: EVENT_URL,
    mediaUrl: media("SIG_ONE"),
    title: "Building local-first apps",
  });
  assert.equal(status, 201, JSON.stringify(data));
  assert.equal(data.videoId, "linkedin:event-7512647010907250689");
  assert.equal(data.platform, "linkedin");
  assert.equal(data.videoUrl, EVENT_URL);
  assert.equal(data.title, "Building local-first apps");
  assert.equal(data.author, "LinkedIn");
  assert.equal(data.thumbnailUrl, "");
  assert.deepEqual(JSON.parse(data.transcript), [
    { text: "Hello from LinkedIn.", startMs: 0, durationMs: 2500 },
  ]);
  assert.match(data.source, /^linkedin_/);

  const calls = ytdlpCalls();
  assert.ok(calls.length >= 2);
  for (const args of calls) assert.equal(args[args.length - 1], media("SIG_ONE"));
});

test("the same event again is a cache hit, even with a fresh signed URL", async () => {
  const before = ytdlpCalls().length;
  const first = await post({ url: EVENT_URL, mediaUrl: media("SIG_ONE") });
  const again = await post({
    url: "https://www.linkedin.com/events/7512647010907250689/comments/",
    mediaUrl: media("SIG_TWO"),
  });
  assert.equal(again.data.id, first.data.id);
  assert.equal(again.data.videoId, "linkedin:event-7512647010907250689");
  assert.equal(ytdlpCalls().length, before);
});

test("event without a media URL gets a clear 422 and never runs yt-dlp", async () => {
  const before = ytdlpCalls().length;
  const { status, data } = await post({ url: "https://www.linkedin.com/events/7084656651378536448/" });
  assert.equal(status, 422);
  assert.match(data.error, /signed-in browser/);
  assert.equal(ytdlpCalls().length, before);
});

test("media URLs outside LinkedIn's https CDN are rejected", async () => {
  for (const mediaUrl of [
    "https://evil.example/a.mp4",
    "http://dms.licdn.com/playlist/vid/v2/X/mp4-360p/Y",
    "https://dms.licdn.com.evil.example/a.mp4",
    "file:///etc/passwd",
    42,
  ]) {
    const { status } = await post({ url: "https://www.linkedin.com/events/7084656651378536448/", mediaUrl });
    assert.equal(status, 400, String(mediaUrl));
  }
});

test("media URLs that aren't already in URL-parser form are rejected before yt-dlp", async () => {
  const before = ytdlpCalls().length;
  for (const mediaUrl of [
    // Node reads host dms.licdn.com; yt-dlp connects to 127.0.0.1:8443.
    "https://dms.licdn.com\\@127.0.0.1:8443/x.mp4",
    "https://dms.licdn\u3002com/x.mp4",
    "https://dms.\u217Cicdn.com/x.mp4",
    " https://dms.licdn.com/x.mp4",
    "https://dms.licdn.com/x.mp4 ",
  ]) {
    const { status } = await post({ url: "https://www.linkedin.com/events/7000000000000000002/", mediaUrl });
    assert.equal(status, 400, JSON.stringify(mediaUrl));
  }
  assert.equal(ytdlpCalls().length, before);
});

test("an expired media URL maps to a fixed message, not yt-dlp output", async () => {
  const { status, data } = await post({
    url: "https://www.linkedin.com/events/7084656651378536448/",
    mediaUrl: media("EXPIRED"),
  });
  assert.equal(status, 422);
  assert.match(data.error, /expired/);
  assert.doesNotMatch(data.error, /licdn|yt-dlp|Forbidden/);
});

test("public post without media URL goes through yt-dlp's LinkedIn page extractor", async () => {
  const { status, data } = await post({ url: POST_URL });
  assert.equal(status, 201, JSON.stringify(data));
  assert.equal(data.videoId, "linkedin:7151241570371948544");
  assert.equal(data.videoUrl, POST_CANONICAL);
  assert.equal(data.title, "Jane Doe on LinkedIn: Local-first is back");
  assert.equal(data.author, "Jane Doe");
  const last = ytdlpCalls().at(-1);
  assert.equal(last[last.length - 1], POST_URL);
});

test("a pasted post URL reaches yt-dlp only in parsed form and is stored by its canonical URL", async () => {
  const { status, data } = await post({
    url: " https://www.linkedin.com\\@127.0.0.1:8443/?highlightedUpdateUrn=urn%3Ali%3Aactivity%3A7200000000000000001 ",
  });
  assert.equal(status, 201, JSON.stringify(data));
  assert.equal(data.videoUrl, "https://www.linkedin.com/feed/update/urn:li:activity:7200000000000000001/");
  assert.equal(
    ytdlpCalls().at(-1).at(-1),
    "https://www.linkedin.com/@127.0.0.1:8443/?highlightedUpdateUrn=urn%3Ali%3Aactivity%3A7200000000000000001"
  );
});

test("the library list shows LinkedIn entries with their page URLs", async () => {
  const res = await GET({ nextUrl: new URL("http://127.0.0.1:19720/api/transcripts") });
  const list = await res.json();
  const byId = Object.fromEntries(list.map((video) => [video.videoId, video]));
  assert.equal(byId["linkedin:event-7512647010907250689"].videoUrl, EVENT_URL);
  assert.equal(byId["linkedin:event-7512647010907250689"].title, "Building local-first apps");
  assert.equal(byId["linkedin:7151241570371948544"].videoUrl, POST_CANONICAL);
});

test("both yt-dlp calls (info and download) put -- right before the URL", () => {
  const calls = ytdlpCalls();
  assert.ok(calls.some((args) => args.includes("--dump-json")));
  assert.ok(calls.some((args) => args.includes("-x")));
  for (const args of calls) assert.equal(args.at(-2), "--", JSON.stringify(args));
});
