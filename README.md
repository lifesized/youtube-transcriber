# YouTube Transcriber

**Paste a YouTube URL. Capture once. Reuse forever.**

A self-hosted web application for capturing and archiving YouTube video transcripts without quota limits or API costs. Uses local Whisper transcription when captions aren't available.

## Why This Exists

**Transcription services are expensive.** I burned through my allowed transcriptions in under a week and needed a solution that wouldn't break the bank. This tool uses **local transcription** with OpenAI Whisper, which means unlimited transcriptions at zero marginal cost. No API keys, no cloud services — everything runs on your machine.

## Features

- 🎯 **Zero-cost transcription** using local Whisper models
- 🚀 **Fast transcription** on Apple Silicon (3-5x faster with MLX)
- 📦 **Queue system** for batch processing multiple videos
- ⚡ **Auto-cleanup** - completed items removed after 2.5 seconds
- 💾 **SQLite storage** - all transcripts saved locally
- 🔍 **Search & filter** your transcript library
- 🎨 **Vintage sepia aesthetic** with dark mode design
- 📱 **Single-page responsive UI** with tiles/list views
- ⬇️ **Export transcripts** as Markdown with timestamps
- 📋 **Copy to clipboard** with formatted timestamps
- 🔁 **Duplicate detection** - same video won't be saved twice
- 🌐 **No API keys required** - fully offline-capable

## How It Works

### Transcription Priority Chain

The app automatically selects the best available method for your system:

1. **YouTube Captions** (fastest) - Fetches official captions when available
2. **MLX Whisper** (Mac only, Apple Silicon) - 3-5x faster than CPU transcription
3. **OpenAI Whisper on MPS** (Mac only, Apple Silicon) - GPU-accelerated fallback
4. **OpenAI Whisper on CPU** (all platforms) - Final fallback, works everywhere

For caption fetching, the app tries multiple InnerTube clients (ANDROID → WEB → page scrape) to avoid rate limits and bot detection.

## Tech Stack

- **Next.js 15** - React framework with App Router
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **Prisma** - Database ORM
- **SQLite** - Local database
- **OpenAI Whisper** - Speech recognition
- **MLX Whisper** - Apple Silicon optimization
- **yt-dlp** - YouTube audio downloader
- **Geist fonts** - Sans, Mono, and Pixel variants

## Evolution & Changelog

This project has evolved through several phases:

### Phase 1: Foundation
- Built initial Next.js app with Prisma and SQLite
- Integrated YouTube caption fetching
- Added local Whisper transcription as fallback
- Implemented transcript storage and search

### Phase 2: Performance & Reliability
- Added MLX backend for 3-5x faster transcription on Apple Silicon
- Implemented automatic fallback chain (captions → MLX → OpenAI CPU)
- Added memory safety guards and process cleanup
- Built queue system for batch processing

### Phase 3: UI/UX Redesign
- Redesigned with single-page layout (capture + library + viewer)
- Refined greyscale aesthetic with vintage sepia tones
- Added tiles/list view toggle for library
- Implemented auto-cleanup of completed queue items
- Polished hover states and transitions throughout

### Phase 4: Open Source
- Prepared for public release
- Added comprehensive documentation
- Made available on GitHub for the community

## Getting Started

### Prerequisites

- **Node.js** 18+ or **Bun** runtime
- **Python** 3.8+ (for Whisper transcription)
- **yt-dlp** (for downloading audio from YouTube)
- **FFmpeg** (required by Whisper for audio processing)

### Installation

```bash
# Clone the repository
git clone https://github.com/lifesized/youtube-transcriber.git
cd youtube-transcriber

# Install dependencies
npm install  # or: bun install

# Set up Python virtual environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install Whisper
pip install openai-whisper

# Optional: Install MLX Whisper (macOS Apple Silicon only)
pip install mlx-whisper

# Configure environment variables (see next section)
cp .env.example .env
# Edit .env with your paths

# Initialize database
npx prisma generate
npx prisma db push
```

### Environment Variables

Create a `.env` file in the project root:

```env
DATABASE_URL="file:./dev.db"

# Whisper configuration (adjust paths to match your setup)
WHISPER_CLI="/path/to/your/.venv/bin/whisper"
WHISPER_PYTHON_BIN="/path/to/your/.venv/bin/python3"

# Optional: Force specific backend (auto, mlx, or openai)
# WHISPER_BACKEND="auto"

# Optional: Force specific device for OpenAI Whisper (auto, cpu, or mps)
# WHISPER_DEVICE="auto"

# Optional: Transcription timeout in milliseconds (default: 480000)
# WHISPER_TIMEOUT_MS="480000"
```

**Windows paths example:**
```env
WHISPER_CLI="C:\\Users\\YourName\\project\\.venv\\Scripts\\whisper.exe"
WHISPER_PYTHON_BIN="C:\\Users\\YourName\\project\\.venv\\Scripts\\python.exe"
```

### Running the App

**Important:** This is a **local desktop application** that runs on your machine. It requires local access to:
- Python environment with Whisper installed
- yt-dlp command-line tool
- FFmpeg for audio processing
- SQLite database (file-based, not hosted)

**Do not deploy to hosting services** like Vercel, Netlify, or similar platforms - they don't support these dependencies and the app won't function properly.

```bash
# Development mode (recommended) - includes hot reload and better debugging
npm run dev  # or: bun dev

# Production mode - hides dev indicator, but requires rebuild for every change
npm run build && npm start
```

Open [http://localhost:19720](http://localhost:19720) in your browser.

**Note:** Development mode shows a small Next.js indicator in the bottom corner. Use production mode (`npm start`) to hide it, but you'll lose hot reload and need to rebuild for every code change.

**Usage:**
1. Paste a YouTube URL into the input field
2. Click "Capture" to add it to the queue
3. Wait for transcription (progress shown in real-time)
4. View transcript by clicking any completed video
5. Use the transcripts as context to feed to your LLMs to your heart's content
6. Search & filter your transcript library
7. Export transcripts as Markdown files

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

## Performance Benchmarks

Transcription speed for a typical 10-minute video:

| Method | Platform | Speed |
|--------|----------|-------|
| YouTube Captions | All | < 5 seconds |
| MLX Whisper | Apple Silicon | 30-60 seconds |
| OpenAI Whisper (MPS) | Apple Silicon | 1-2 minutes |
| OpenAI Whisper (CPU) | All | 2-5 minutes |
| OpenAI Whisper (CUDA) | NVIDIA GPU | 30-90 seconds |

The app uses the `base` model by default (good balance of speed and accuracy). You can use smaller models (`tiny`, `small`) for faster transcription or larger models (`medium`, `large`) for better accuracy.

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

## Platform-Specific Notes

### macOS (Apple Silicon - Recommended)

**Best performance** with M1/M2/M3/M4 chips using MLX backend.

```bash
# Install dependencies
brew install yt-dlp ffmpeg

# Python virtual environment
python3 -m venv .venv
source .venv/bin/activate
pip install openai-whisper mlx-whisper
```

**Performance:** MLX Whisper provides 3-5x faster transcription than CPU (typical 10-min video: ~30-60 seconds vs 2-5 minutes).

**Auto-detection:** The app automatically uses MLX on Apple Silicon and falls back to OpenAI Whisper if needed.

### macOS (Intel)

```bash
brew install yt-dlp ffmpeg
python3 -m venv .venv
source .venv/bin/activate
pip install openai-whisper
```

Uses OpenAI Whisper on CPU (slower but reliable). Typical 10-min video: 2-5 minutes.

### Windows

**Option 1: WSL2 (Recommended)**
```bash
# Inside WSL2, follow Linux instructions below
```

**Option 2: Native Windows**
```powershell
# Install yt-dlp and ffmpeg
scoop install yt-dlp ffmpeg

# Or use chocolatey
choco install yt-dlp ffmpeg

# Python virtual environment
python -m venv .venv
.venv\Scripts\activate
pip install openai-whisper
```

**Important:** Update `.env` with Windows-style paths:
```env
WHISPER_CLI="C:\\Users\\YourName\\project\\.venv\\Scripts\\whisper.exe"
WHISPER_PYTHON_BIN="C:\\Users\\YourName\\project\\.venv\\Scripts\\python.exe"
```

### Linux

```bash
# Debian/Ubuntu
sudo apt install yt-dlp ffmpeg python3 python3-venv

# Fedora/RHEL
sudo dnf install yt-dlp ffmpeg python3

# Arch
sudo pacman -S yt-dlp ffmpeg python

# Python environment
python3 -m venv .venv
source .venv/bin/activate
pip install openai-whisper
```

**NVIDIA GPU users:** Install CUDA-enabled PyTorch before Whisper for 5-10x faster transcription.

**Note:** The `yt-dlp` path is hardcoded to `/opt/homebrew/bin/yt-dlp` in `lib/whisper.ts`. Find your path with `which yt-dlp` and update if needed.

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

## Troubleshooting

### "spawn whisper ENOENT" error
- Check that `WHISPER_CLI` and `WHISPER_PYTHON_BIN` paths in `.env` are correct
- Verify the virtual environment is activated when installing Whisper
- Use absolute paths, not relative paths
- Restart the dev server after updating `.env`

### Slow transcription
- On Mac with Apple Silicon, install `mlx-whisper` for 3-5x speedup
- Use smaller Whisper models (`tiny`, `base`, `small`) for faster transcription
- Set `WHISPER_BACKEND="mlx"` in `.env` to force MLX usage

### Memory issues
- The app processes one video at a time to prevent memory exhaustion
- For very long videos (>2 hours), transcription may fail on low-RAM systems
- Consider using a smaller Whisper model or increasing available RAM

### Rate limiting / bot detection
- The app automatically tries multiple InnerTube clients
- If YouTube blocks requests, wait a few minutes before retrying
- Try disabling VPN if you're getting consistent 403 errors

## AI Agent Integration

This transcription service can be used by AI agents like **OpenClaw**, **Claude Code**, and other LLM-powered assistants. A skill file is included that teaches agents how to interact with the REST API.

### OpenClaw Setup

1. **Start the transcription service:**
   ```bash
   npm run dev
   # Running at http://127.0.0.1:19720
   ```

2. **Install the skill:**
   ```bash
   cp -r contrib/openclaw ~/.openclaw/skills/youtube-transcriber
   ```

3. **Use it!** Ask your OpenClaw agent:
   > "Transcribe this YouTube video: https://www.youtube.com/watch?v=dQw4w9WgXcQ"

### Claude Code Setup

```bash
cp -r contrib/claude-code ~/.claude/skills/youtube-transcriber
```

Then ask Claude Code to transcribe a video.

### REST API

Full API documentation: [`docs/API.md`](./docs/API.md)

OpenAPI spec: [`docs/openapi.yaml`](./docs/openapi.yaml)

**Quick example:**
```bash
curl -X POST 'http://127.0.0.1:19720/api/transcripts' \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://www.youtube.com/watch?v=VIDEO_ID"}'
```

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT License - feel free to use, modify, and distribute.

## Credits

Built by [lifesized](https://github.com/lifesized) out of necessity and frustration with expensive transcription services.

**Development time:** ~7 hours from concept to production-ready application.

**Built with:** Testing [Intent by Augment](https://www.augmentcode.com/intent), [Cursor](https://cursor.sh), [Codex](https://openai.com/index/openai-codex/), [Claude Code](https://github.com/anthropics/claude-code), and [Ghostty](https://ghostty.org).

## Related Projects

- [OpenAI Whisper](https://github.com/openai/whisper)
- [MLX Whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
