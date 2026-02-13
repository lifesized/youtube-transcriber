# OpenClaw Integration

This folder contains an [OpenClaw](https://openclaw.ai/) skill for the YouTube Transcriber. Install the skill to let your OpenClaw agent transcribe YouTube videos using your local service.

## Setup

### 1. Start the Transcription Service

```bash
# In the project root
npm run dev
# Running at http://127.0.0.1:3000
```

### 2. Install the Skill

```bash
# From the project root
cp -r contrib/openclaw ~/.openclaw/skills/youtube-transcriber
```

Or symlink (changes reflect immediately):
```bash
ln -s "$(pwd)/contrib/openclaw" ~/.openclaw/skills/youtube-transcriber
```

### 3. Use It

Ask your OpenClaw agent:

> "Transcribe this YouTube video: https://www.youtube.com/watch?v=dQw4w9WgXcQ"

That's it! The agent will capture the transcript and return it with timestamps.

## Other Commands

- "List my saved transcripts"
- "Search transcripts for [topic]"  
- "Delete transcript [ID]"

## Troubleshooting

**"Connection refused"** → Start the service: `npm run dev`

**Slow transcription** → Videos without captions use local Whisper (can take a few minutes)
