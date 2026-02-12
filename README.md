# YouTube Transcript Capture

A local-first web app to capture, store, and browse transcripts from YouTube videos. No API keys, no cloud services — everything runs on your machine.

## Features

- Paste any YouTube URL to capture its transcript
- Automatic fallback to local Whisper transcription for videos without captions
- Time-coded transcript display with timestamps
- Video metadata (title, author, thumbnail, channel link)
- Transcript library with search
- Download transcripts as Markdown files
- Copy transcript text to clipboard (formatted with timestamps)
- Duplicate detection (same video won't be saved twice)
- Local SQLite storage — zero cost, fully offline-capable

## How It Works

Transcripts come from two sources:

**1. YouTube Captions** — The app fetches captions directly from YouTube's InnerTube API (auto-generated or manually uploaded). No API key is needed. The fallback chain for caption fetching is:

1. Try the ANDROID InnerTube client
2. If rate-limited or bot-detected, try the WEB InnerTube client
3. If still blocked, try a WEB page scrape

**2. Local Whisper Transcription** — If a video has no captions at all, the app falls back to transcribing locally using OpenAI's open-source Whisper model. It downloads the audio via `yt-dlp` and runs Whisper on your machine. This is 100% free and runs entirely on-device.

## Tech Stack

- Next.js 16 (App Router, TypeScript)
- Tailwind CSS v4
- Prisma ORM with SQLite
- Geist font
- No external API keys required

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
git clone https://github.com/lifesized/youtube-transcriber.git
cd youtube-transcriber
npm install
npx prisma migrate dev
```

### Running

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Paste a YouTube URL on the home page to capture a transcript. Browse saved transcripts in the library.

## Whisper Transcription (Captionless Videos)

For videos that have no captions on YouTube, the app can transcribe audio locally using OpenAI's Whisper. This is optional — the app works without it, but videos without captions will fail to produce a transcript.

### Prerequisites

- Python 3
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — downloads audio from YouTube
- [ffmpeg](https://ffmpeg.org/) — audio processing (required by both yt-dlp and Whisper)
- [openai-whisper](https://github.com/openai/whisper) — speech-to-text model

### Setup

Install `yt-dlp` and `ffmpeg`, then set up Whisper in a Python virtual environment:

```bash
# macOS (Homebrew)
brew install yt-dlp ffmpeg

# Create a Python venv and install Whisper
python3 -m venv .venv
source .venv/bin/activate
pip install openai-whisper
```

The first transcription will download the Whisper `base` model (~150MB).

### Performance

Whisper transcription speed depends on your hardware:

| Setup | Speed | Example (35-min video) |
|-------|-------|------------------------|
| CPU only | ~1x real-time | ~35 minutes |
| NVIDIA GPU (CUDA) | ~5-10x real-time | ~4-7 minutes |
| Apple Silicon GPU (MPS) | ~3-5x real-time | ~7-12 minutes |

The app uses the `base` model by default. The smaller `tiny` model is faster but less accurate.

### Backend and device selection

On Apple Silicon, the app now defaults to the MLX backend for more consistent GPU acceleration.

```bash
# Auto-select backend (default): MLX on Apple Silicon, OpenAI Whisper elsewhere
WHISPER_BACKEND=auto

# Force a specific backend
WHISPER_BACKEND=mlx
WHISPER_BACKEND=openai

# OpenAI backend device selection only
WHISPER_DEVICE=auto
WHISPER_DEVICE=cpu
WHISPER_DEVICE=mps

# Optional: override MLX model repo/name
MLX_WHISPER_MODEL=mlx-community/whisper-base-mlx

# Optional: per-transcription timeout in milliseconds (default: 480000)
WHISPER_TIMEOUT_MS=480000
```

Fallback behavior:

- If MLX fails, the app falls back to OpenAI Whisper on CPU.
- If OpenAI MPS fails, the app falls back to OpenAI CPU.

## Platform Notes

### macOS

macOS is the primary development platform. All features work out of the box with Homebrew.

```bash
brew install yt-dlp ffmpeg
```

Python 3 is usually pre-installed on macOS. The `yt-dlp` binary path is hardcoded to `/opt/homebrew/bin/yt-dlp` (the default Homebrew path on Apple Silicon). If you're on Intel macOS, Homebrew installs to `/usr/local/bin` instead — you'll need to update the path in `lib/whisper.ts`.

### Linux

Install dependencies via your package manager:

```bash
# Debian/Ubuntu
sudo apt install yt-dlp ffmpeg python3 python3-venv

# Fedora
sudo dnf install yt-dlp ffmpeg python3
```

**Important:** The `yt-dlp` path in `lib/whisper.ts` is hardcoded to `/opt/homebrew/bin/yt-dlp`. On Linux, update this to your actual path (e.g., `/usr/bin/yt-dlp`). You can find it with `which yt-dlp`.

NVIDIA GPU users can get significantly faster Whisper transcription with CUDA support. Install the CUDA version of PyTorch before installing Whisper.

### Windows

Windows support requires some additional setup:

- **Recommended:** Use WSL2 and follow the Linux instructions
- **Native:** Install Node.js, then install `yt-dlp` via pip, scoop, or winget. Install `ffmpeg` via scoop or chocolatey.

**Important:** The current code has macOS-specific paths hardcoded in `lib/whisper.ts`. Windows users will need to update the `yt-dlp` path to match their installation.

## Project Structure

```
app/
  page.tsx                          # Home — URL input form
  library/page.tsx                  # Library — saved transcript grid
  transcripts/[id]/page.tsx         # Transcript detail viewer
  api/transcripts/
    route.ts                        # POST (capture) / GET (list)
    [id]/route.ts                   # GET / DELETE single transcript
    [id]/download/route.ts          # GET markdown download
lib/
  transcript.ts                     # Transcript + metadata fetching (fallback chain)
  whisper.ts                        # Local Whisper transcription (yt-dlp + Whisper CLI)
  youtube.ts                        # YouTube URL parsing / video ID extraction
  types.ts                          # Shared TypeScript types
  prisma.ts                         # Prisma client singleton
prisma/
  schema.prisma                     # Database schema (Video model)
```

## License

ISC
