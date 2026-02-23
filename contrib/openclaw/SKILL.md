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

1. POST the URL to `/api/transcripts`
2. Parse the response
3. Format and display the transcript with timestamps

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

- **Connection refused**: Service not running. Start with `npm run dev`
- **400**: Invalid URL format
- **404**: Video not found
- **429**: Rate limited, wait and retry

## Notes

- Duplicate URLs return existing transcript (no re-transcription)
- Videos without captions use Whisper (takes 1-5 minutes)
- Supports: youtube.com/watch, youtu.be, youtube.com/shorts
