# YouTube Transcriber API

Base URL: `http://127.0.0.1:19720`

## Authentication

Every `/api/*` route requires the local loopback token:

```
Authorization: Bearer <token>
```

The token is created on first run and stored at mode `0600`:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Transcriber/local-api.token` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/transcriber/local-api.token` |
| Windows | `%APPDATA%\Transcriber\local-api.token` |

From the repo root, print the path (not the token):

```bash
node lib/local-api-token.js --path
```

Unauthenticated requests return **401**. The server does not log the token. `GET /api/health` is included; its response no longer includes `projectPath`. A 401 from this app still sends `X-Transcriber-Service: 1` so local probes can tell it apart from another process on the port.

Set `TRANSCRIBER_LOCAL_TOKEN` to override the file. On startup the file is rewritten to match. The extension reads the token through the native messaging host (`getLocalToken`) and does not store it. The MCP server reads the same file.

### Rotate the token

1. Stop the app, the MCP client, and reload the extension.
2. Delete the token file, or set `TRANSCRIBER_LOCAL_TOKEN` to a new single-line value with no spaces.
3. Start the app again. A missing file is replaced with a new token; an env override is written back to the file.
4. Restart MCP clients and reload the extension so they re-read it.

Do not paste the token into shell history, logs, URLs, or extension storage. From the repo root, curl reads it straight into the header:

```bash
curl -H "Authorization: Bearer $(node -e 'process.stdout.write(require("./lib/local-api-token.js").ensureLocalApiToken())')" \
  http://127.0.0.1:19720/api/health
```

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

### Summarize Transcript

Summarize a transcript using an LLM provider. The API key is passed per-request and never stored.

```
POST /api/transcripts/{id}/summarize
```

**Request:**
```json
{
  "provider": "openai",
  "apiKey": "sk-...",
  "model": "gpt-4o",
  "prompt": "Optional custom prompt. Transcript is appended automatically.",
  "format": "markdown"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `provider` | Yes | `"openai"` or `"anthropic"` |
| `apiKey` | Yes | Your API key for the chosen provider (never stored) |
| `model` | No | Model override. Defaults to `gpt-4o` (OpenAI) or `claude-sonnet-4-5-20250929` (Anthropic) |
| `prompt` | No | Custom prompt. If omitted, a default summarization prompt is used |
| `format` | No | `"markdown"` (default), `"text"`, or `"bullets"` |

**Response:**
```json
{
  "summary": "## Key Points\n\n- Point one...\n- Point two...",
  "model_used": "gpt-4o-2024-08-06",
  "provider": "openai",
  "format": "markdown",
  "token_count": {
    "prompt_tokens": 1250,
    "completion_tokens": 340
  },
  "video": {
    "id": "cm5abc123def",
    "title": "Rick Astley - Never Gonna Give You Up",
    "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  }
}
```

| Status | Description |
|--------|-------------|
| 200 | Summary generated |
| 400 | Invalid request (missing provider, apiKey, empty transcript) |
| 404 | Transcript not found |
| 502 | LLM provider returned an error |

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
# From the repo root. The token is not printed.
AUTH=( -H "Authorization: Bearer $(node -e 'process.stdout.write(require("./lib/local-api-token.js").ensureLocalApiToken())')" )

# Create transcript
curl "${AUTH[@]}" -X POST 'http://127.0.0.1:19720/api/transcripts' \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://youtu.be/dQw4w9WgXcQ"}'

# List all
curl "${AUTH[@]}" 'http://127.0.0.1:19720/api/transcripts'

# Search
curl "${AUTH[@]}" 'http://127.0.0.1:19720/api/transcripts?q=rick+astley'

# Get by ID
curl "${AUTH[@]}" 'http://127.0.0.1:19720/api/transcripts/cm5abc123def'

# Delete
curl "${AUTH[@]}" -X DELETE 'http://127.0.0.1:19720/api/transcripts/cm5abc123def'

# Download markdown
curl "${AUTH[@]}" 'http://127.0.0.1:19720/api/transcripts/cm5abc123def/download' -o transcript.md

# Summarize with OpenAI
curl "${AUTH[@]}" -X POST 'http://127.0.0.1:19720/api/transcripts/cm5abc123def/summarize' \
  -H 'Content-Type: application/json' \
  -d '{"provider": "openai", "apiKey": "sk-...", "format": "bullets"}'

# Summarize with Anthropic
curl "${AUTH[@]}" -X POST 'http://127.0.0.1:19720/api/transcripts/cm5abc123def/summarize' \
  -H 'Content-Type: application/json' \
  -d '{"provider": "anthropic", "apiKey": "sk-ant-...", "model": "claude-sonnet-4-5-20250929"}'
```

### JavaScript

```javascript
// Create transcript
const token = require('fs').readFileSync(
  require('./lib/local-api-token').tokenFilePath(),
  'utf8'
).trim();
const response = await fetch('http://127.0.0.1:19720/api/transcripts', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
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
from pathlib import Path

token = Path.home().joinpath(
    "Library", "Application Support", "Transcriber", "local-api.token"
).read_text().strip()  # Linux: ~/.config/transcriber/local-api.token

# Create transcript
response = requests.post(
    'http://127.0.0.1:19720/api/transcripts',
    headers={'Authorization': f'Bearer {token}'},
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
