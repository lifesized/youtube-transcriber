# YouTube Transcriber API

Base URL: `http://127.0.0.1:19720`

## Endpoints

### Create Transcript

Capture a transcript from a YouTube video.

```
POST /api/transcripts
```

**Request:**
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

**Response:**
```json
{
  "id": "cm5abc123def",
  "videoId": "dQw4w9WgXcQ",
  "title": "Rick Astley - Never Gonna Give You Up",
  "author": "Rick Astley",
  "channelUrl": "https://www.youtube.com/@RickAstleyYT",
  "thumbnailUrl": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "transcript": "[{\"text\":\"We're no strangers to love\",\"startMs\":18000,\"durationMs\":3500}]",
  "source": "youtube_captions",
  "createdAt": "2025-01-15T10:30:00.000Z",
  "updatedAt": "2025-01-15T10:30:00.000Z"
}
```

| Status | Description |
|--------|-------------|
| 201 | Transcript created |
| 200 | Duplicate URL, existing transcript returned |
| 400 | Invalid URL format |
| 404 | Video not found |
| 429 | Rate limited |
| 500 | Transcription failed |

---

### List Transcripts

Get all saved transcripts.

```
GET /api/transcripts
GET /api/transcripts?q=search+term
```

**Response:**
```json
[
  {
    "id": "cm5abc123def",
    "videoId": "dQw4w9WgXcQ",
    "title": "Rick Astley - Never Gonna Give You Up",
    "author": "Rick Astley",
    "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "createdAt": "2025-01-15T10:30:00.000Z"
  }
]
```

---

### Get Transcript

Get a single transcript by ID.

```
GET /api/transcripts/{id}
```

**Response:** Same as Create Transcript response.

| Status | Description |
|--------|-------------|
| 200 | Success |
| 404 | Not found |

---

### Delete Transcript

```
DELETE /api/transcripts/{id}
```

**Response:**
```json
{
  "success": true
}
```

---

### Download as Markdown

```
GET /api/transcripts/{id}/download
```

Returns a `.md` file with the formatted transcript.

---

### Summarize Transcript (built-in)

Summarize with the **server-held** OpenRouter key (`OPENROUTER_API_KEY` or an OpenRouter row in Settings). **Client-supplied `apiKey` is rejected (HTTP 400)** — this endpoint is not an LLM proxy (YTT-436).

Preferred path:

```
GET  /api/summaries          → { available, model }
POST /api/summaries
```

**Request:**
```json
{
  "transcriptId": "cm5abc123def",
  "promptOverride": "Optional custom prompt"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `transcriptId` | Yes | Library transcript id |
| `promptOverride` | No | Custom prompt (transcript appended server-side) |
| `apiKey` | **Forbidden** | Always rejected |

**Response:**
```json
{
  "summary_md": "## TL;DR\n...",
  "model": "google/gemini-2.5-flash-lite",
  "cached": false,
  "cost_usd": 0.0001,
  "prompt_hash": "…"
}
```

| Status | Description |
|--------|-------------|
| 200 | Summary generated |
| 400 | Invalid body or client `apiKey` supplied |
| 404 | Transcript not found |
| 503 | No OpenRouter key configured on the server |
| 502 | OpenRouter returned an error |

Legacy alias (same server key rules — no client `apiKey`):

```
POST /api/transcripts/{id}/summarize
```

Optional body fields: `prompt`, `format` (`markdown`|`text`|`bullets`). Response keeps the older `{ summary, model_used, provider, … }` shape for compatibility. Prefer `/api/summaries` for new clients.

**Examples:**
```bash
TOKEN=$(cat "$HOME/Library/Application Support/Transcriber/local-api.token")

# Preferred
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"transcriptId":"cm5abc123def"}' \
  http://127.0.0.1:19720/api/summaries

# Rejected (400)
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"transcriptId":"cm5abc123def","apiKey":"sk-attacker"}' \
  http://127.0.0.1:19720/api/summaries
```

---

## Data Types

### Transcript Segment

The `transcript` field contains a JSON-encoded array of segments:

```typescript
interface TranscriptSegment {
  text: string;      // Spoken words
  startMs: number;   // Start time in milliseconds
  durationMs: number; // Duration in milliseconds
}
```

**Example:**
```json
[
  {"text": "We're no strangers to love", "startMs": 18000, "durationMs": 3500},
  {"text": "You know the rules and so do I", "startMs": 21500, "durationMs": 3200}
]
```

### Health Check

Check that all dependencies and services are operational.

```
GET /api/health
```

**Response (200 — healthy):**
```json
{
  "status": "healthy",
  "checks": [
    { "name": "database", "status": "pass", "detail": "Connected, 42 transcript(s)" },
    { "name": "python", "status": "pass", "detail": "Python 3.14.0" },
    { "name": "whisper", "status": "pass", "detail": ".venv/bin/whisper" },
    { "name": "ffmpeg", "status": "pass", "detail": "/opt/homebrew/bin/ffmpeg" },
    { "name": "yt-dlp", "status": "pass", "detail": "/opt/homebrew/bin/yt-dlp" },
    { "name": "tmp_writable", "status": "pass", "detail": "/path/to/tmp" },
    { "name": "env_vars", "status": "pass" }
  ]
}
```

Returns **503** with `"status": "unhealthy"` when any check fails. Individual checks report `"pass"`, `"fail"`, or `"warn"`.

---

### Source Types

| Value | Description |
|-------|-------------|
| `youtube_captions` | Fetched from YouTube's caption system (fast) |
| `whisper_local` | Transcribed locally with Whisper (1-5 minutes) |

---

## Supported URL Formats

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`
- URLs with additional parameters (playlists, timestamps, etc.)

---

## Examples

### cURL

```bash
# Create transcript
curl -X POST 'http://127.0.0.1:19720/api/transcripts' \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://youtu.be/dQw4w9WgXcQ"}'

# List all
curl 'http://127.0.0.1:19720/api/transcripts'

# Search
curl 'http://127.0.0.1:19720/api/transcripts?q=rick+astley'

# Get by ID
curl 'http://127.0.0.1:19720/api/transcripts/cm5abc123def'

# Delete
curl -X DELETE 'http://127.0.0.1:19720/api/transcripts/cm5abc123def'

# Download markdown
curl 'http://127.0.0.1:19720/api/transcripts/cm5abc123def/download' -o transcript.md

# Summarize with OpenAI
# Summarize with Anthropic
```

### JavaScript

```javascript
// Create transcript
const response = await fetch('http://127.0.0.1:19720/api/transcripts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' })
});
const video = await response.json();

// Parse transcript segments
const segments = JSON.parse(video.transcript);
for (const seg of segments) {
  const mins = Math.floor(seg.startMs / 60000);
  const secs = Math.floor((seg.startMs % 60000) / 1000);
  console.log(`[${mins}:${secs.toString().padStart(2, '0')}] ${seg.text}`);
}
```

### Python

```python
import requests
import json

# Create transcript
response = requests.post(
    'http://127.0.0.1:19720/api/transcripts',
    json={'url': 'https://youtu.be/dQw4w9WgXcQ'}
)
video = response.json()

# Parse and format transcript
segments = json.loads(video['transcript'])
for seg in segments:
    mins = seg['startMs'] // 60000
    secs = (seg['startMs'] % 60000) // 1000
    print(f"[{mins}:{secs:02d}] {seg['text']}")
```
