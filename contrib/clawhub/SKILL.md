---
name: youtube-transcriber
description: Get clean, LLM-ready transcripts from any YouTube video. No timestamps, no clutter — just the text, ready to paste into any AI workflow. Falls back to local Whisper when captions aren't available.
emoji: 📝
---

# YouTube Transcriber

Fetch clean, LLM-ready transcripts from any YouTube video. Uses official YouTube captions when available; falls back to local Whisper transcription when they're not. Output is plain text — no timestamps, no formatting noise — ready to drop straight into any AI prompt or workflow.

## When to Use

Activate when the user wants to:
- Transcribe a YouTube video
- Get the full text of what was said in a video
- Feed a video's content into an LLM (summarize, analyze, Q&A, translate, etc.)
- Extract dialogue, quotes, or research material from a video
- Use shorthand like `t`, `ts`, or `transcribe` followed by a YouTube URL

## Prerequisites

### Check if the service is running

Before making any API calls, check if the service is available:

```bash
curl -s http://127.0.0.1:19720/api/health | jq -r '.status'
```

- If this returns `"healthy"` — you're ready to go, skip to the API section.
- If this returns `"unhealthy"` — check `.checks[]` for which component failed.
- If this returns connection refused — the service needs to be set up and started (see below).

### System dependencies

The service requires:
- **Node.js 18+** and npm
- **Python 3.8+**
- **yt-dlp** — YouTube audio download
- **ffmpeg** — Audio processing

Install on macOS:
```bash
brew install yt-dlp ffmpeg
```

Install on Ubuntu/Debian:
```bash
sudo apt install ffmpeg
pip install yt-dlp
```

### First-time setup

```bash
git clone https://github.com/lifesized/youtube-transcriber.git
cd youtube-transcriber
npm run setup   # Installs all deps, creates Python venv with Whisper, initializes database
npm run dev     # Starts the service at http://127.0.0.1:19720
```

`npm run setup` handles everything: Node dependencies, Python virtual environment, Whisper installation, Prisma database initialization, and `.env` configuration. No manual steps needed.

### Starting the service (already set up)

If the service was previously set up but isn't running:
```bash
cd youtube-transcriber
npm run dev
```

### Verify setup

After starting, confirm everything is working:
```bash
curl -s http://127.0.0.1:19720/api/health | jq .
```

All checks should show `"status": "pass"`. If any show `"fail"`, run `npm run test:setup` for detailed diagnostics.

No external MCP servers to clone. No third-party repos to audit. Just a local Next.js service with a clean REST API.

## API

Base URL: `http://127.0.0.1:19720`

### Transcribe a Video

```bash
curl -X POST 'http://127.0.0.1:19720/api/transcripts' \
  -H 'Content-Type: application/json' \
  -d '{"url": "YOUTUBE_URL"}'
```

**Response:**
```json
{
  "id": "abc123",
  "title": "Video Title",
  "author": "Channel Name",
  "videoUrl": "https://youtube.com/watch?v=...",
  "transcript": "[{\"text\":\"Hello world\",\"startMs\":0,\"durationMs\":1500}]",
  "source": "youtube_captions"
}
```

The `transcript` field is a JSON string. Parse it to get segments with `text`, `startMs`, and `durationMs`.

### Get Clean Text (LLM-Ready)

To extract plain text with no timestamps:

```bash
RESP=$(curl -s -X POST 'http://127.0.0.1:19720/api/transcripts' \
  -H 'Content-Type: application/json' \
  -d '{"url": "USER_URL"}')

echo "$RESP" | jq -r '.transcript' | python3 -c "
import json, sys
segments = json.load(sys.stdin)
print(' '.join(s['text'] for s in segments))
"
```

This is the primary output format — clean, continuous text ready for any LLM.

### Get Text with Timestamps (optional)

If the user specifically wants timestamps:

```bash
echo "$RESP" | jq -r '.transcript' | python3 -c "
import json, sys
for s in json.load(sys.stdin):
    m, sec = s['startMs']//60000, (s['startMs']%60000)//1000
    print(f'[{m}:{sec:02d}] {s[\"text\"]}')
"
```

### List Saved Transcripts

```bash
curl 'http://127.0.0.1:19720/api/transcripts'
```

### Search Transcripts

```bash
curl 'http://127.0.0.1:19720/api/transcripts?q=SEARCH_TERM'
```

### Get by ID

```bash
curl 'http://127.0.0.1:19720/api/transcripts/ID'
```

### Delete

```bash
curl -X DELETE 'http://127.0.0.1:19720/api/transcripts/ID'
```

## Recommended Workflow

When a user shares a YouTube URL and wants the transcript:

1. Check the service is running: `curl -s http://127.0.0.1:19720/api/health | jq -r '.status'`
2. If not running, inform the user and provide setup instructions from the Prerequisites section
3. POST the URL to `/api/transcripts`
4. Parse the response
5. Extract clean text (no timestamps) using the snippet above
6. Return the clean text directly — it's ready to use

```bash
RESP=$(curl -s -X POST 'http://127.0.0.1:19720/api/transcripts' \
  -H 'Content-Type: application/json' \
  -d '{"url": "USER_URL"}')

TITLE=$(echo "$RESP" | jq -r '.title')
AUTHOR=$(echo "$RESP" | jq -r '.author')
TEXT=$(echo "$RESP" | jq -r '.transcript' | python3 -c "
import json, sys
segments = json.load(sys.stdin)
print(' '.join(s['text'] for s in segments))
")

echo "📹 $TITLE — $AUTHOR"
echo ""
echo "$TEXT"
```

## Error Handling

| Error | Cause | Fix |
|---|---|---|
| Connection refused | Service not running | `cd youtube-transcriber && npm run dev` |
| 400 | Invalid or unsupported URL | Ask user for a valid youtube.com or youtu.be URL |
| 404 | Video not found or unavailable | Inform user the video may be private or deleted |
| 429 | Rate limited | Wait 30–60 seconds and retry |
| 503 (health) | Dependency missing | Run `npm run test:setup` for diagnostics |

## Notes

- Submitting the same URL twice returns the cached transcript — no re-transcription
- Videos without captions fall back to local Whisper (may take 1–5 minutes depending on video length and hardware)
- `source` in the response will be `"youtube_captions"` or `"whisper"` — useful for informing the user
- Supported URL formats: `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`
- Each user runs their own local instance — transcripts stay on your machine
- The web UI is also available at http://127.0.0.1:19720 for browsing transcripts
