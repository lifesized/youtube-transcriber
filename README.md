# YouTube Transcriber

**YouTube to LLM-ready transcript in one click. Runs locally, costs nothing.**



https://github.com/user-attachments/assets/a87f2be7-09cf-4dbe-a861-65582d9b5753



## Get Running in 60 Seconds

```bash
git clone https://github.com/lifesized/youtube-transcriber.git
cd youtube-transcriber
npm run setup
npm run dev
```

Open [http://localhost:19720](http://localhost:19720) — paste a YouTube URL, hit Extract, done.

> `npm run setup` installs all dependencies (yt-dlp, ffmpeg, Whisper, MLX on Apple Silicon) and configures everything automatically. Requires Node.js 18+, Python 3.8+, and a package manager (Homebrew / apt / dnf / pacman).

## Use as a Skill

Install the included skill for your agent, then ask it in natural language:

**Claude Code:**
```bash
cp -r contrib/claude-code ~/.claude/skills/youtube-transcriber
```

**OpenClaw:**
```bash
cp -r contrib/openclaw ~/.openclaw/skills/youtube-transcriber
```

> *"summarize https://youtube.com/watch?v=..."*
> *"transcribe https://youtube.com/watch?v=..."*
> *"s https://youtube.com/watch?v=..."* / *"t https://youtube.com/watch?v=..."*

Or just paste a YouTube URL — the skill auto-activates.

The app must be running (`npm run dev`) for the agent to use it.

---

## How It Works

Paste a URL. The app grabs the transcript using the fastest method available on your system:

1. **YouTube Captions** — fetches official captions when they exist (< 5 sec)
2. **MLX Whisper** — local GPU transcription on Apple Silicon (30-60 sec for 10 min)
3. **OpenAI Whisper** — CPU fallback that works everywhere (2-5 min for 10 min)

No API keys needed. Everything runs on your machine.

## Features

- **Zero-cost transcription** — local Whisper models, no API fees
- **Summarize with LLM** — send any transcript straight to ChatGPT or Claude. ChatGPT opens with the prompt pre-filled; Claude copies it to your clipboard so you can paste (⌘V) into a new chat
- **Queue system** — batch-process multiple videos
- **Search & filter** your transcript library
- **Export as Markdown** or copy to clipboard with timestamps
- **Duplicate detection** — same video won't be saved twice
- **SQLite storage** — all data stays on your machine
- **Fully offline-capable** after initial setup

Full REST API docs: [`docs/API.md`](./docs/API.md) | OpenAPI spec: [`docs/openapi.yaml`](./docs/openapi.yaml)

---

## Manual Installation

If the automated setup doesn't work or you prefer to do it yourself:

<details>
<summary>Expand manual steps</summary>

```bash
git clone https://github.com/lifesized/youtube-transcriber.git
cd youtube-transcriber

# Install Node dependencies
npm install

# Set up Python virtual environment
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install Whisper
pip install openai-whisper

# Optional: MLX Whisper for Apple Silicon
pip install mlx-whisper

# Configure environment
cp .env.example .env
# Edit .env with your paths
```

**Environment variables (`.env`):**

```env
DATABASE_URL="file:./dev.db"
WHISPER_CLI="/path/to/your/.venv/bin/whisper"
WHISPER_PYTHON_BIN="/path/to/your/.venv/bin/python3"

# Optional
# WHISPER_BACKEND="auto"    # auto, mlx, or openai
# WHISPER_DEVICE="auto"     # auto, cpu, mps
# WHISPER_TIMEOUT_MS="480000"
```

**Windows paths:**
```env
WHISPER_CLI="C:\\Users\\YourName\\project\\.venv\\Scripts\\whisper.exe"
WHISPER_PYTHON_BIN="C:\\Users\\YourName\\project\\.venv\\Scripts\\python.exe"
```

</details>

## Troubleshooting

<details>
<summary>"spawn whisper ENOENT" error</summary>

- Check that `WHISPER_CLI` and `WHISPER_PYTHON_BIN` paths in `.env` are correct
- Use absolute paths, not relative paths
- Restart the dev server after updating `.env`
</details>

<details>
<summary>Slow transcription</summary>

- On Apple Silicon, install `mlx-whisper` for 3-5x speedup
- Use smaller Whisper models (`tiny`, `base`) for faster results
- Set `WHISPER_BACKEND="mlx"` in `.env` to force MLX
</details>

<details>
<summary>Rate limiting / bot detection</summary>

- The app automatically tries multiple InnerTube clients
- Wait a few minutes and retry if YouTube blocks requests
- Disable VPN if you're getting consistent 403 errors
</details>

## Contributing

Contributions welcome — feel free to submit issues or pull requests.

## License

MIT

## Credits

Built by [lifesized](https://github.com/lifesized).

**Built with:** [Intent by Augment](https://www.augmentcode.com/intent), [Cursor](https://cursor.sh), [Codex](https://openai.com/index/openai-codex/), [Claude Code](https://github.com/anthropics/claude-code), and [Ghostty](https://ghostty.org).
