# Claude Code Integration

This folder contains a skill for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that enables transcribing YouTube videos using your local transcription service.

## Setup

### 1. Start the Transcription Service

```bash
# In the project root
npm run dev
# Running at http://127.0.0.1:3000
```

### 2. Install the Skill

Copy to Claude Code's user skills directory:

```bash
cp -r contrib/claude-code ~/.claude/skills/youtube-transcriber
```

Or if using the container-based setup:
```bash
# The skill path depends on your Claude Code configuration
cp -r contrib/claude-code /path/to/skills/user/youtube-transcriber
```

### 3. Use It

Ask Claude Code:

> "Transcribe this YouTube video: https://www.youtube.com/watch?v=dQw4w9WgXcQ"

Claude will call the local API and return the formatted transcript.

## How It Works

The skill teaches Claude Code how to interact with the YouTube Transcriber REST API. When you ask to transcribe a video, Claude will:

1. POST the URL to `http://127.0.0.1:3000/api/transcripts`
2. Parse the response
3. Format the transcript with timestamps
4. Display the result

## Troubleshooting

**"Connection refused"** → The service isn't running. Start it with `npm run dev`

**Slow transcription** → Videos without YouTube captions are transcribed locally with Whisper (takes 1-5 minutes depending on length)
