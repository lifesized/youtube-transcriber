# YouTube Transcriber

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

**YouTube & Spotify podcast to LLM-ready transcript in one click. Runs locally, costs nothing.**


https://github.com/user-attachments/assets/32491284-5c78-4a74-a580-ff3a8c256243




**Don't want to install anything?** A hosted version is coming soon — no setup required. **[Join the waitlist →](https://waitlist-site-alpha.vercel.app)**

## Get Running in 60 Seconds

```bash
git clone https://github.com/lifesized/youtube-transcriber.git
cd youtube-transcriber
npm run setup
npm run dev
```

Open [http://localhost:19720](http://localhost:19720) — paste a YouTube or Spotify podcast URL, hit Transcribe, done.

> `npm run setup` installs all dependencies (yt-dlp, ffmpeg, Whisper, MLX on Apple Silicon) and configures everything automatically. Requires Node.js 18+, Python 3.8+, and a package manager (Homebrew / apt / dnf / pacman).

## Chrome Extension
<img width="375" height="565" alt="CleanShot 2026-03-17 at 22 53 31@2x" src="https://github.com/user-attachments/assets/d4bccf92-9941-46cc-b4f4-b7bbc3454ff7" />

Transcribe any YouTube video or Spotify podcast episode directly from your browser without leaving the page. The extension opens as a persistent side panel — it stays open as you navigate between videos and detects each one automatically.

The extension works in two modes:

- **Cloud** (default) — transcribe via [transcribed.dev](https://www.transcribed.dev). Create a free account, enter your API key in extension settings, and go. No local setup needed.
- **Self-hosted** — connect to your local instance at `localhost:19720`. Switch to "Self-hosted" in extension settings.

### Install from Chrome Web Store

> **Note:** The extension is not yet on the Chrome Web Store. Install it manually in a few steps while we go through the review process.

### Install from source (for self-hosted or development)

1. Make sure the local service is running (`npm run dev`)
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle, top right)
4. Click **Load unpacked**
5. Select the `extension/` folder inside this repo
6. Open extension settings and switch mode to **Self-hosted**
7. Click the YouTube Transcriber icon in your toolbar to open the side panel

### Usage

Navigate to any YouTube video or Spotify episode, open the side panel, and click **Transcribe**. In cloud mode, transcripts are available at [transcribed.dev](https://www.transcribed.dev). In self-hosted mode, they open in the local web app at `http://localhost:19720`.

---

## Use with Claude Code, Claude Desktop & Cursor

Three ways to use this with AI assistants — pick the one that fits:

### MCP Server (recommended)

The MCP server gives you tools like `transcribe_and_summarize` directly in your AI client. Requires the service running (`npm run dev`).

**Claude Code** — already configured. Clone the repo and the `.claude/mcp.json` is included:

```bash
git clone https://github.com/lifesized/youtube-transcriber.git
cd youtube-transcriber
npm run setup && npm run dev
# Open in Claude Code — MCP tools are ready to use
```

**Claude Desktop / Cursor** — run `npm run mcp:config` and add the output to your client config ([full setup guide](./docs/MCP.md)):

| Client | Config file |
|--------|-------------|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | `.cursor/mcp.json` |

### Skill (no server needed)



https://github.com/user-attachments/assets/73a62192-746c-4ec0-b1d5-b46608441bdd



Install as a Claude Code or OpenClaw skill. Two flavors: **Lite** (zero setup, just `yt-dlp`, YouTube subtitles only) or **Full** (requires the service running, adds Whisper fallback, diarization, and persistent library).

```bash
# Lite skill (yt-dlp only, no server)
cp contrib/claude-code/SKILL-lite.md ~/.claude/skills/youtube-transcriber/SKILL.md

# Full skill (requires service running)
cp -r contrib/claude-code ~/.claude/skills/youtube-transcriber
```

| | Lite Skill | Full Skill / MCP |
|--|:---:|:----:|
| YouTube captions | Yes | Yes |
| Auto-generated subs | Yes | Yes |
| Whisper transcription | — | Yes |
| Speaker diarization | — | Yes |
| Persistent library | — | Yes |
| Requires server | No | Yes |

### Triggers

Once set up (MCP or skill), just type naturally:

> *"summarize https://youtube.com/watch?v=..."*
> *"ts https://youtube.com/watch?v=..."* (transcribe + summarize)
> *"t https://youtube.com/watch?v=..."* (transcript only)

Or just paste a YouTube URL — it auto-activates.

---

## How It Works

Paste a URL. The app grabs the transcript using the fastest method available on your system:

**YouTube:**
1. **YouTube Captions** — fetches official captions when they exist (< 5 sec)
2. **Cloud Whisper** — optional Groq, OpenRouter, or custom API with your own key (10-30 sec for 10 min)
3. **MLX Whisper** — local GPU transcription on Apple Silicon (30-60 sec for 10 min)
4. **OpenAI Whisper** — local CPU fallback that works everywhere (2-5 min for 10 min)

**Spotify Podcasts:**
1. Fetches episode metadata from Spotify's official API
2. Discovers the podcast's public RSS feed via iTunes
3. Downloads full episode audio from the podcast CDN
4. Transcribes via Cloud Whisper or local Whisper

> Spotify support requires `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `.env` (free from [developer.spotify.com](https://developer.spotify.com/dashboard)). Spotify-exclusive podcasts without a public RSS feed are not supported.

Works fully offline by default for YouTube. Cloud Whisper is optional — bring your own API key to enable it.

## Features

- **YouTube + Spotify** — paste a YouTube video URL or Spotify podcast episode URL
- **Local + cloud transcription** — free local Whisper by default, optional cloud providers (Groq, OpenRouter, or custom endpoint) for faster results with your own API key
- **Chrome extension** — persistent side panel that transcribes YouTube videos and Spotify episodes from your browser
- **Multi-language captions** — request captions in any language YouTube supports (see [Language Preference](#language-preference) below)
- **Summarize with LLM** — send any transcript straight to ChatGPT or Claude. ChatGPT opens with the prompt pre-filled; Claude copies it to your clipboard so you can paste (⌘V) into a new chat
- **Queue system** — batch-process multiple videos
- **Search & filter** your transcript library
- **Export as Markdown** or copy to clipboard with timestamps
- **Duplicate detection** — same video won't be saved twice
- **Speaker diarization** — optional speaker identification with pyannote.audio
- **SQLite storage** — all data stays on your machine
- **Fully offline-capable** after initial setup

Full REST API docs: [`docs/API.md`](./docs/API.md) | OpenAPI spec: [`docs/openapi.yaml`](./docs/openapi.yaml)

## Cloud Transcription Providers
<img width="1824" height="1175" alt="CleanShot 2026-03-17 at 22 50 27" src="https://github.com/user-attachments/assets/4a413c9b-965c-44d0-a264-2b1ae9ed12d5" />

Add one or more cloud providers in **Settings** (gear icon, bottom-left). Drag to reorder priority — the app tries each enabled provider in order, then falls back to local Whisper.

### Groq (Free)

The fastest option — uses Groq's free Whisper API. No credit card required.

1. Sign up at [console.groq.com](https://console.groq.com)
2. Go to **API Keys** → **Create API Key**
3. Paste the key in Settings

**Free tier limits:** 14,400 audio-seconds per day (~4 hours). The Settings page shows a usage meter so you can track your quota.

### OpenRouter

Access dozens of transcription models through a single API key, including Gemini 2.5 Flash.

1. Sign up at [openrouter.ai/keys](https://openrouter.ai/keys)
2. Create an API key
3. Paste the key in Settings — pick your model from the dropdown

### Custom Endpoint

Point to any OpenAI-compatible transcription API by providing a base URL, API key, and model name.

## Language Preference

By default, the app fetches English captions. You can change this per-request or globally.

**Per-request** — pass `lang` in the API body:
```bash
curl -X POST http://localhost:19720/api/transcripts \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://youtube.com/watch?v=...", "lang": "es"}'
```

**Multi-language priority** — tries each language in order, falls back to first available:
```bash
-d '{"url": "...", "lang": "ja,en"}'   # Japanese preferred, English fallback
```

**Global default** — set in `.env`:
```env
YTT_CAPTION_LANGS="zh-Hans,zh-Hant,en"
```

The MCP tools (`transcribe`, `transcribe_and_summarize`) also accept an optional `lang` parameter.

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

# Optional — local Whisper
# WHISPER_BACKEND="auto"    # auto, mlx, or openai
# WHISPER_DEVICE="auto"     # auto, cpu, mps
# WHISPER_TIMEOUT_MS="480000"

# Optional — cloud providers are configured in Settings (UI)
# Legacy env var still works for a single Groq key:
# WHISPER_CLOUD_API_KEY="gsk_..."
```

**Windows paths:**
```env
WHISPER_CLI="C:\\Users\\YourName\\project\\.venv\\Scripts\\whisper.exe"
WHISPER_PYTHON_BIN="C:\\Users\\YourName\\project\\.venv\\Scripts\\python.exe"
```

</details>

## Verifying Your Setup

After setup, verify everything is wired up correctly:

```bash
npm run test:setup
```

This checks Node.js, Python, ffmpeg, yt-dlp, Whisper, database, and environment configuration. Each check prints pass/fail with actionable fix messages. It runs automatically at the end of `npm run setup`.

For a running instance, hit the health endpoint:

```bash
curl http://localhost:19720/api/health
```

Returns JSON with per-check pass/fail — useful for Docker health checks or debugging. See [docs/TESTING.md](./docs/TESTING.md) for the full test protocol.

## Troubleshooting

<details>
<summary>"spawn whisper ENOENT" error</summary>

- Check that `WHISPER_CLI` and `WHISPER_PYTHON_BIN` paths in `.env` are correct
- Use absolute paths, not relative paths
- Restart the dev server after updating `.env`
</details>

<details>
<summary>Slow transcription</summary>

- Enable cloud Whisper for the fastest option: set `WHISPER_CLOUD_API_KEY` in `.env` (Groq free tier available)
- On Apple Silicon, install `mlx-whisper` for 3-5x local speedup
- Use smaller Whisper models (`tiny`, `base`) for faster local results
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

If this saves you time, a ⭐ on GitHub helps others find it.

## License

[GNU Affero General Public License v3.0](LICENSE)

## Credits

Designed and built by [lifesized](https://github.com/lifesized).

**Built with:** [Intent by Augment](https://www.augmentcode.com/intent), [Cursor](https://cursor.sh), [Codex](https://openai.com/index/openai-codex/), [Claude Code](https://github.com/anthropics/claude-code), and [Ghostty](https://ghostty.org).
