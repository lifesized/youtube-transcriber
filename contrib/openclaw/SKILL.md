---
name: youtube-transcriber
description: Capture transcripts from YouTube videos. Uses YouTube captions when available, falls back to local Whisper transcription.
emoji: 📝
---

# YouTube Transcriber

Capture transcripts from any YouTube video URL. The service fetches official YouTube captions when available, or transcribes locally using Whisper.

## When to Use

Use when the user wants to:
- Transcribe a YouTube video
- Get captions/transcript from a video
- Extract dialogue from a YouTube video
- Save what was said in a video
- Uses a shorthand like "s", "t", or "ts" followed by a YouTube URL (e.g. "ts https://youtube.com/watch?v=..." to transcribe and summarize)

## Prerequisites

### Check if the service is running

Before making any API calls, check if the service is available:

```bash
curl -s http://127.0.0.1:19720/api/health | jq -r '.status'
```

- If this returns `"healthy"` — you're ready to go, skip to the API section.
- If this returns `"unhealthy"` — check `.checks[]` for which component failed.
- If this returns connection refused — the service needs to be set up and started (see below).

### First-time setup

The service requires these system dependencies:
- **Node.js 18+** and npm
- **Python 3.8+**
- **yt-dlp** — YouTube audio download
- **ffmpeg** — Audio processing

Install system dependencies (macOS):
```bash
brew install yt-dlp ffmpeg
```

Install system dependencies (Ubuntu/Debian):
```bash
sudo apt install ffmpeg
pip install yt-dlp
```

Then clone and set up the service:
```bash
git clone https://github.com/lifesized/youtube-transcriber.git
cd youtube-transcriber
npm run setup   # Installs deps, creates Python venv with Whisper, initializes database
npm run dev     # Starts the service at http://127.0.0.1:19720
```

`npm run setup` handles everything: Node dependencies, Python virtual environment, Whisper installation, Prisma database initialization, and `.env` configuration.

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

## API

Base URL: `http://127.0.0.1:19720`

### Capture Transcript

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
  "transcript": "[{\"text\":\"Hello\",\"startMs\":0,\"durationMs\":1500}]",
  "source": "youtube_captions"
}
```

The `transcript` field is JSON. Parse it to get segments with `text`, `startMs`, and `durationMs`.

### List Transcripts

```bash
curl 'http://127.0.0.1:19720/api/transcripts'
```

### Search

```bash
curl 'http://127.0.0.1:19720/api/transcripts?q=QUERY'
```

### Get by ID

```bash
curl 'http://127.0.0.1:19720/api/transcripts/ID'
```

### Delete

```bash
curl -X DELETE 'http://127.0.0.1:19720/api/transcripts/ID'
```

## Format Timestamps

```python
def format_transcript(transcript_json):
    import json
    segments = json.loads(transcript_json)
    lines = []
    for seg in segments:
        ms = seg['startMs']
        mins, secs = ms // 60000, (ms % 60000) // 1000
        lines.append(f"[{mins}:{secs:02d}] {seg['text']}")
    return "\n".join(lines)
```

## Workflow

When user asks to transcribe a video:

1. Check the service is running: `curl -s http://127.0.0.1:19720/api/health | jq -r '.status'`
2. If not running, inform the user and provide setup instructions
3. POST the URL to `/api/transcripts`
4. Parse the response
5. Format and display the transcript with timestamps

```bash
RESP=$(curl -s -X POST 'http://127.0.0.1:19720/api/transcripts' \
  -H 'Content-Type: application/json' \
  -d '{"url": "USER_URL"}')

TITLE=$(echo "$RESP" | jq -r '.title')
echo "Captured: $TITLE"

echo "$RESP" | jq -r '.transcript' | python3 -c "
import json, sys
for s in json.load(sys.stdin):
    m, sec = s['startMs']//60000, (s['startMs']%60000)//1000
    print(f'[{m}:{sec:02d}] {s[\"text\"]}')
"
```

## Errors

| Error | Cause | Fix |
|---|---|---|
| Connection refused | Service not running | `cd youtube-transcriber && npm run dev` |
| 400 | Invalid URL format | Ask user for a valid youtube.com or youtu.be URL |
| 404 | Video not found | Video may be private or deleted |
| 429 | Rate limited | Wait 30–60 seconds and retry |
| 503 (health) | Dependency missing | Run `npm run test:setup` for diagnostics |

## Notes

- Duplicate URLs return existing transcript (no re-transcription)
- Videos without captions use Whisper (takes 1-5 minutes)
- Supports: youtube.com/watch, youtu.be, youtube.com/shorts
- The web UI is also available at http://127.0.0.1:19720 for browsing transcripts
