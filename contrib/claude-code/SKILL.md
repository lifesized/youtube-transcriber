# YouTube Transcriber

Capture transcripts from YouTube videos using a local transcription service. The service fetches official YouTube captions when available, or transcribes locally using Whisper.

## When to Use

Use this skill when the user wants to:
- Transcribe a YouTube video
- Get the transcript or captions from a video
- Extract what was said in a YouTube video
- Capture dialogue from a YouTube video for analysis
- Summarize a YouTube video

## Prerequisites

The YouTube Transcriber service must be running at `http://127.0.0.1:19720`.

To check if it's running:
```bash
curl -s http://127.0.0.1:19720/api/transcripts | head -c 100
```

If not running, the user needs to start it in their youtube-transcriber project directory:
```bash
npm run dev
```

## API Endpoints

Base URL: `http://127.0.0.1:19720`

### Capture a Transcript

```bash
curl -X POST 'http://127.0.0.1:19720/api/transcripts' \
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
curl 'http://127.0.0.1:19720/api/transcripts'
```

### Search Transcripts

```bash
curl 'http://127.0.0.1:19720/api/transcripts?q=SEARCH_TERM'
```

### Get Single Transcript

```bash
curl 'http://127.0.0.1:19720/api/transcripts/ID'
```

### Delete Transcript

```bash
curl -X DELETE 'http://127.0.0.1:19720/api/transcripts/ID'
```

## Default Behavior

After capturing a transcript, **always present a summary to the user** unless they explicitly asked for the full transcript. This is the expected workflow:

1. Capture the transcript via the API (saves it to the library)
2. Parse the transcript segments into plain text
3. Summarize the content directly — focus on key topics, insights, and takeaways
4. Present the summary with the video title and author

If the user asks for the full transcript, format it with timestamps instead of summarizing.

## Example Workflow

When user asks: "Transcribe this https://youtube.com/watch?v=abc123"

```bash
# 1. Capture the transcript
RESPONSE=$(curl -s -X POST 'http://127.0.0.1:19720/api/transcripts' \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://youtube.com/watch?v=abc123"}')

# 2. Check for errors
if echo "$RESPONSE" | grep -q '"error"'; then
  echo "Error: $(echo "$RESPONSE" | jq -r '.error')"
  exit 1
fi

# 3. Extract metadata and transcript text
echo "$RESPONSE" | python3 -c "
import json, sys
resp = json.load(sys.stdin)
print(f'Title: {resp[\"title\"]}')
print(f'Author: {resp[\"author\"]}')
print(f'Source: {resp.get(\"source\", \"unknown\")}')
print()
segments = json.loads(resp['transcript'])
for seg in segments:
    print(seg['text'], end=' ')
print()
"
```

Then summarize the transcript text and present the summary to the user.

## Formatting Full Transcripts

When the user asks for the full transcript, format timestamps as `[MM:SS]`:

```bash
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
- Always summarize by default — the full transcript is saved in the library for later
