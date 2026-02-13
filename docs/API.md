# YouTube Transcriber API

Base URL: `http://127.0.0.1:3000`

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
curl -X POST 'http://127.0.0.1:3000/api/transcripts' \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://youtu.be/dQw4w9WgXcQ"}'

# List all
curl 'http://127.0.0.1:3000/api/transcripts'

# Search
curl 'http://127.0.0.1:3000/api/transcripts?q=rick+astley'

# Get by ID
curl 'http://127.0.0.1:3000/api/transcripts/cm5abc123def'

# Delete
curl -X DELETE 'http://127.0.0.1:3000/api/transcripts/cm5abc123def'

# Download markdown
curl 'http://127.0.0.1:3000/api/transcripts/cm5abc123def/download' -o transcript.md
```

### JavaScript

```javascript
// Create transcript
const response = await fetch('http://127.0.0.1:3000/api/transcripts', {
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
    'http://127.0.0.1:3000/api/transcripts',
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
