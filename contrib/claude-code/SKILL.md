# YouTube Transcriber

Capture transcripts from YouTube videos using a local transcription service. The service fetches official YouTube captions when available, or transcribes locally using Whisper.

## When to Use

Use this skill when the user wants to:
- Transcribe a YouTube video
- Get the transcript or captions from a video
- Extract what was said in a YouTube video
- Capture dialogue from a YouTube video for analysis

## Prerequisites

The YouTube Transcriber service must be running at `http://127.0.0.1:3000`.

To check if it's running:
```bash
curl -s http://127.0.0.1:3000/api/transcripts | head -c 100
```

If not running, the user needs to start it in their youtube-transcriber project directory:
```bash
npm run dev
```

## API Endpoints

Base URL: `http://127.0.0.1:3000`

### Capture a Transcript

```bash
curl -X POST 'http://127.0.0.1:3000/api/transcripts' \
  -H 'Content-Type: application/json' \
  -d '{"url": "YOUTUBE_URL"}'
```

**Response:**
```json
{
  "id": "abc123",
  "videoId": "dQw4w9WgXcQ",
  "title": "Video Title",
  "author": "Channel Name",
  "videoUrl": "https://youtube.com/watch?v=dQw4w9WgXcQ",
  "transcript": "[{\"text\":\"Hello\",\"startMs\":0,\"durationMs\":1500}]",
  "source": "youtube_captions",
  "createdAt": "2025-01-15T10:30:00.000Z"
}
```

The `transcript` field is a JSON string. Parse it to get an array of segments:
- `text`: The spoken words
- `startMs`: Start time in milliseconds
- `durationMs`: Duration in milliseconds

The `source` field indicates:
- `youtube_captions`: Fetched from YouTube (fast)
- `whisper_local`: Transcribed with Whisper (slower, 1-5 min)

### List All Transcripts

```bash
curl 'http://127.0.0.1:3000/api/transcripts'
```

### Search Transcripts

```bash
curl 'http://127.0.0.1:3000/api/transcripts?q=SEARCH_TERM'
```

### Get Single Transcript

```bash
curl 'http://127.0.0.1:3000/api/transcripts/ID'
```

### Delete Transcript

```bash
curl -X DELETE 'http://127.0.0.1:3000/api/transcripts/ID'
```

## Formatting Transcripts

When displaying transcripts, format timestamps as `[MM:SS]`:

```python
import json

def format_transcript(transcript_json: str) -> str:
    segments = json.loads(transcript_json)
    lines = []
    for seg in segments:
        ms = seg['startMs']
        minutes = ms // 60000
        seconds = (ms % 60000) // 1000
        lines.append(f"[{minutes}:{seconds:02d}] {seg['text']}")
    return "\n".join(lines)
```

Or in bash:
```bash
echo "$TRANSCRIPT_JSON" | python3 -c "
import json, sys
for seg in json.load(sys.stdin):
    ms = seg['startMs']
    print(f'[{ms//60000}:{(ms%60000)//1000:02d}] {seg[\"text\"]}')
"
```

## Example Workflow

When user asks: "Transcribe https://youtube.com/watch?v=abc123"

```bash
# 1. Capture the transcript
RESPONSE=$(curl -s -X POST 'http://127.0.0.1:3000/api/transcripts' \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://youtube.com/watch?v=abc123"}')

# 2. Check for errors
if echo "$RESPONSE" | grep -q '"error"'; then
  echo "Error: $(echo "$RESPONSE" | jq -r '.error')"
  exit 1
fi

# 3. Extract metadata
TITLE=$(echo "$RESPONSE" | jq -r '.title')
AUTHOR=$(echo "$RESPONSE" | jq -r '.author')
SOURCE=$(echo "$RESPONSE" | jq -r '.source')
ID=$(echo "$RESPONSE" | jq -r '.id')

echo "✓ Captured: $TITLE"
echo "  Author: $AUTHOR"
echo "  Source: $SOURCE"
echo "  ID: $ID"

# 4. Format and display transcript
echo ""
echo "Transcript:"
echo "$RESPONSE" | jq -r '.transcript' | python3 -c "
import json, sys
for seg in json.load(sys.stdin):
    ms = seg['startMs']
    print(f'[{ms//60000}:{(ms%60000)//1000:02d}] {seg[\"text\"]}')
"
```

## Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| 200/201 | Success | Process response |
| 400 | Invalid URL | Check URL format |
| 404 | Video not found | Verify URL is correct |
| 429 | Rate limited | Wait 1-2 minutes, retry |
| 500 | Server error | Check if service is running |
| Connection refused | Service not running | User needs to run `npm run dev` |

## Supported URL Formats

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`
- URLs with additional parameters (playlists, timestamps)

## Notes

- Submitting a duplicate URL returns the existing transcript (no re-processing)
- Videos without captions use local Whisper transcription (can take several minutes)
- Transcripts are stored locally in SQLite and persist across sessions
