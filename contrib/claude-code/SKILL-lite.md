# YouTube Transcriber (Lite)

Transcribe YouTube videos with zero setup. Uses `yt-dlp` for subtitle extraction — no server required. Automatically upgrades to the full YouTube Transcriber service when available (Whisper, diarization, persistent library).

## When to Use

Use this skill when the user:
- Pastes a YouTube URL (with or without a verb like "transcribe", "summarize", "watch")
- Says "transcribe", "summarize", or "caption" followed by a YouTube URL
- Uses a shorthand like "s", "t", or "ts" followed by a YouTube URL
- Asks to extract, capture, or get what was said in a YouTube video
- Sends just a YouTube URL with no other context

## Prerequisites

**Minimum (lite mode):** `yt-dlp` installed (`brew install yt-dlp` / `pip install yt-dlp`)

**Full mode (optional):** YouTube Transcriber service running at `http://127.0.0.1:19720`

## How It Works

This skill operates in two modes, detected automatically:

### Mode Detection

```bash
# Check if full service is available
if curl -s --max-time 2 http://127.0.0.1:19720/api/transcripts > /dev/null 2>&1; then
  echo "FULL_MODE"  # Use service API (Whisper fallback, diarization, library)
else
  echo "LITE_MODE"  # Use yt-dlp directly (subtitles only)
fi
```

---

## Full Mode (service running)

When the YouTube Transcriber service is detected, use the full API for transcription. This gives you Whisper fallback, speaker diarization, a persistent library, and richer metadata.

### Capture a Transcript

```bash
RESPONSE=$(curl -s -X POST 'http://127.0.0.1:19720/api/transcripts' \
  -H 'Content-Type: application/json' \
  -d '{"url": "YOUTUBE_URL"}')
```

### Extract Text from Response

```bash
echo "$RESPONSE" | python3 -c "
import json, sys
resp = json.load(sys.stdin)
print(f'Title: {resp[\"title\"]}')
print(f'Author: {resp[\"author\"]}')
print(f'Source: {resp.get(\"source\", \"unknown\")}')
print()
segments = json.loads(resp['transcript'])
for seg in segments:
    speaker = seg.get('speaker', '')
    prefix = f'[{speaker}] ' if speaker else ''
    print(f'{prefix}{seg[\"text\"]}', end=' ')
print()
"
```

### Other API Endpoints

- `GET /api/transcripts` — List all saved transcripts
- `GET /api/transcripts?q=TERM` — Search by title/author
- `GET /api/transcripts/ID` — Get single transcript
- `DELETE /api/transcripts/ID` — Remove from library

---

## Lite Mode (no service, yt-dlp only)

When the service is not running, extract subtitles directly with `yt-dlp`. This is fast and free but only works for videos that have captions/subtitles.

### Step 1: Get Video Title

```bash
TITLE=$(yt-dlp --get-title "YOUTUBE_URL" 2>/dev/null)
UPLOADER=$(yt-dlp --get-filename -o "%(uploader)s" "YOUTUBE_URL" 2>/dev/null)
```

### Step 2: Extract Subtitles

```bash
# Create temp directory
TMPDIR=$(mktemp -d)

# Try manual subtitles first, then auto-generated
yt-dlp --skip-download \
  --write-sub --write-auto-sub \
  --sub-lang "en,en-orig,zh-Hans,zh-Hant,es,fr,de,ja,ko,pt" \
  --sub-format "vtt/srt/best" \
  --convert-subs vtt \
  -o "$TMPDIR/%(id)s" \
  "YOUTUBE_URL" 2>/dev/null

# Find the subtitle file
SUB_FILE=$(ls "$TMPDIR"/*.vtt 2>/dev/null | head -1)
```

### Step 3: Parse VTT to Plain Text

```bash
if [ -n "$SUB_FILE" ]; then
  # Extract text from VTT, removing timestamps and metadata
  python3 -c "
import re, sys

text_lines = []
seen = set()
with open(sys.argv[1]) as f:
    for line in f:
        line = line.strip()
        # Skip VTT headers, timestamps, and empty lines
        if not line or line == 'WEBVTT' or '-->' in line or line.startswith('Kind:') or line.startswith('Language:') or re.match(r'^\d+$', line) or line.startswith('NOTE'):
            continue
        # Remove VTT tags like <c> </c> <00:00:01.000>
        clean = re.sub(r'<[^>]+>', '', line)
        # Deduplicate (VTT often repeats lines across cues)
        if clean and clean not in seen:
            seen.add(clean)
            text_lines.append(clean)

print(f'Title: $TITLE')
print(f'Author: $UPLOADER')
print(f'Source: youtube_subtitles (lite mode)')
print()
print(' '.join(text_lines))
" "$SUB_FILE"
else
  echo "ERROR: No subtitles available for this video."
  echo "To transcribe videos without captions, start the YouTube Transcriber service:"
  echo "  cd <youtube-transcriber-dir> && npm run dev"
fi

# Cleanup
rm -rf "$TMPDIR"
```

### Step 4: Save to File (optional)

If the user wants to save the transcript:

```bash
# Save as text file in current directory
SAFE_TITLE=$(echo "$TITLE" | sed 's/[^a-zA-Z0-9 _-]//g' | head -c 100)
python3 -c "
import re, sys

text_lines = []
seen = set()
with open(sys.argv[1]) as f:
    for line in f:
        line = line.strip()
        if not line or line == 'WEBVTT' or '-->' in line or line.startswith('Kind:') or line.startswith('Language:') or re.match(r'^\d+$', line) or line.startswith('NOTE'):
            continue
        clean = re.sub(r'<[^>]+>', '', line)
        if clean and clean not in seen:
            seen.add(clean)
            text_lines.append(clean)

print(' '.join(text_lines))
" "$SUB_FILE" > "${SAFE_TITLE}.txt"
echo "Saved to: ${SAFE_TITLE}.txt"
```

---

## Default Behavior

- **"ts URL"** or **"s URL"** or just **URL** → Transcribe and summarize. In full mode, use the API. In lite mode, extract subtitles with yt-dlp, then summarize the text directly.
- **"t URL"** → Return the full transcript with timestamps.
- Always summarize by default unless the user explicitly asks for the full transcript.

## Summarization

After obtaining the transcript text (from either mode), summarize it directly:
- Focus on key topics, main insights, and actionable takeaways
- Format as Markdown with headings and bullet points
- Include the video title and author at the top

## Formatting Full Transcripts

When the user asks for the full transcript with timestamps:

**Full mode:**
```bash
echo "$RESPONSE" | jq -r '.transcript' | python3 -c "
import json, sys
for seg in json.load(sys.stdin):
    ms = seg['startMs']
    print(f'[{ms//60000}:{(ms%60000)//1000:02d}] {seg[\"text\"]}')
"
```

**Lite mode:** VTT files already contain timestamps — parse and reformat:
```bash
python3 -c "
import re, sys

with open(sys.argv[1]) as f:
    for line in f:
        line = line.strip()
        if '-->' in line:
            ts = line.split(' --> ')[0]
            # Convert HH:MM:SS.mmm to MM:SS
            parts = ts.split(':')
            if len(parts) == 3:
                h, m, s = int(parts[0]), int(parts[1]), float(parts[2])
                total_min = h * 60 + m
                print(f'[{total_min}:{int(s):02d}] ', end='')
        elif line and line != 'WEBVTT' and not line.startswith('Kind:') and not line.startswith('Language:') and not re.match(r'^\d+$', line) and not line.startswith('NOTE'):
            clean = re.sub(r'<[^>]+>', '', line)
            if clean:
                print(clean)
" "$SUB_FILE"
```

## Error Handling

| Situation | Action |
|-----------|--------|
| Service running | Use full API (all features available) |
| Service not running + yt-dlp installed | Use lite mode (subtitles only) |
| No subtitles available (lite mode) | Tell user to start the service for Whisper transcription |
| yt-dlp not installed | Tell user: `brew install yt-dlp` or `pip install yt-dlp` |
| Rate limited (429) | Wait 1-2 minutes, retry |

## Supported URL Formats

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`
- URLs with additional parameters (playlists, timestamps)

## Installation

Copy this file to your Claude Code skills directory:
```bash
cp SKILL-lite.md ~/.claude/skills/youtube-transcriber.md
```

Or install from the repo:
```bash
npx skills add <repo-url> --skill youtube-transcriber-lite
```

## Lite vs Full Comparison

| Feature | Lite (yt-dlp only) | Full (service running) |
|---------|:------------------:|:---------------------:|
| YouTube captions | Yes | Yes |
| Auto-generated subtitles | Yes | Yes |
| Whisper transcription | - | Yes (GPU accelerated) |
| Speaker diarization | - | Yes |
| Persistent library | - | Yes (SQLite) |
| Search & manage | - | Yes |
| Duplicate detection | - | Yes |
| Multi-language subtitles | Yes | Yes |
| Summarization | Yes (LLM direct) | Yes (LLM direct or API) |
| Setup required | `yt-dlp` only | Node.js + Python + service |
