# YouTube Transcriber

Get clean, LLM-ready transcripts from any YouTube video — no timestamps, no formatting noise, just the text.

## Two for the price of one

Installing youtube-transcriber gives you two things at once — a full web app and an agent skill — from a single `npm install`.

Most OpenClaw Whisper setups require you to manually install Python, Whisper, yt-dlp, and ffmpeg, manage a virtual environment, handle audio extraction, and wire everything together yourself. That's a significant DIY effort, and at the end you still only have transcription — no UI, no library, no search.

With this skill, all of that is handled inside youtube-transcriber. Your agent calls the REST API and gets clean transcripts back immediately. But you also get the full web app running at `http://127.0.0.1:19720` — browse your transcript library, search across everything you've transcribed, copy or export in one click.

One install. Two completely different ways to use it.

## Why This Instead of Other Tools

- **No DIY Whisper setup** — no Python venv, no yt-dlp, no ffmpeg to wrangle yourself
- **No third-party repos to clone or audit** — just one local service with a clean REST API
- **Works without captions** — local Whisper fallback handles videos that caption-scraping tools fail on
- **Output is LLM-ready by default** — no timestamp stripping, no post-processing needed
- **Your transcripts stay on your machine** — each user runs their own instance, nothing sent to a cloud service
- **Timestamps available if you want them** — raw segment data includes `startMs` and `durationMs` if your workflow needs it

## What It Does

Most YouTube transcript tools give you a wall of timestamped fragments. This tool gives you something different: **plain, continuous text** that you can paste directly into any LLM prompt without any cleanup.

Submit a YouTube URL → get back a clean transcript. That's it.

Under the hood, it tries YouTube's official captions first. If a video doesn't have captions, it falls back to **local Whisper transcription** running on your machine. Either way, the output is the same: clean text, ready to use.

## Setup

```bash
git clone https://github.com/lifesized/youtube-transcriber.git
cd youtube-transcriber
npm install
npm run dev
# Running at http://127.0.0.1:19720
```

Then install this skill and you're ready.

## Usage

Just give your agent a YouTube URL:

> "Transcribe this: https://www.youtube.com/watch?v=dQw4w9WgXcQ"

Or use shorthand:

> "ts https://youtu.be/dQw4w9WgXcQ"

The agent will return clean transcript text. You can then ask it to summarize, translate, extract key points, answer questions — whatever your workflow needs.

## Other Commands

- "List my saved transcripts"
- "Search my transcripts for [topic]"
- "Delete transcript [ID]"

## Skip the setup — hosted version coming soon

A cloud version is in the works — no install, no Python, no local Whisper. Just sign up and go.

[Join the waitlist →](http://localhost:19720/waitlist)

## Stack

Built on Next.js + Prisma. Whisper transcription runs as a local Python subprocess. Transcript data is stored locally in a SQLite database.

## Source

[github.com/lifesized/youtube-transcriber](https://github.com/lifesized/youtube-transcriber) — open source, AGPL-3.0 licensed.

---

If this saves you time, a ⭐ on GitHub helps others find it.
