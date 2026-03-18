# YouTube Transcriber

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

**YouTube to LLM-ready transcript in one click. Runs locally, costs nothing.**


https://github.com/user-attachments/assets/32491284-5c78-4a74-a580-ff3a8c256243




## Hosted Version (Coming Soon)

Don't want to run it locally? A hosted version is in progress — no install, no Python, no local Whisper. Just sign up and go.

**[Join the waitlist →](http://localhost:19720/waitlist)**

## Get Running in 60 Seconds

```bash
git clone https://github.com/lifesized/youtube-transcriber.git
cd youtube-transcriber
npm run setup
npm run dev
```

Open [http://localhost:19720](http://localhost:19720) — paste a YouTube URL, hit Extract, done.

> `npm run setup` installs all dependencies (yt-dlp, ffmpeg, Whisper, MLX on Apple Silicon) and configures everything automatically. Requires Node.js 18+, Python 3.8+, and a package manager (Homebrew / apt / dnf / pacman).

## Chrome Extension
<img width="375" height="565" alt="CleanShot 2026-03-17 at 22 53 31@2x" src="https://github.com/user-attachments/assets/d4bccf92-9941-46cc-b4f4-b7bbc3454ff7" />

Transcribe any YouTube video directly from your browser without leaving the page. The extension opens as a persistent side panel — it stays open as you navigate between videos and detects each one automatically.

> **Note:** The extension is not yet on the Chrome Web Store. Install it manually in a few steps while we go through the review process.

### Install

1. Make sure the service is running (`npm run dev`)
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle, top right)
4. Click **Load unpacked**
5. Select the `extension/` folder inside this repo
6. Click the YouTube Transcriber icon in your toolbar to open the side panel

### Usage

Navigate to any YouTube video, open the side panel, and click **Transcribe**. The extension uses the same transcription pipeline as the web app — captions first, Whisper fallback, cloud providers if configured.

Transcripts open directly in the web app at `http://localhost:19720` where you can search, copy, export, or send to an LLM.

> A Chrome Web Store listing is coming soon — once published, installation will be one click.

---

## Use as a Skill

Two options — pick the one that fits your setup:

### Full Skill (all features, requires running service)



https://github.com/user-attachments/assets/73a62192-746c-4ec0-b1d5-b46608441bdd



```bash
# Claude Code
cp -r contrib/claude-code ~/.claude/skills/youtube-transcriber

# OpenClaw
cp -r contrib/openclaw ~/.openclaw/skills/youtube-transcriber
```

Requires the app running at `localhost:19720` (`npm run dev`). Gives you Whisper fallback, speaker diarization, persistent library, and all API features.


### Lite Skill (zero setup, just yt-dlp)

```bash
cp contrib/claude-code/SKILL-lite.md ~/.claude/skills/youtube-transcriber/SKILL.md
```

Works with just `yt-dlp` installed — no server needed. Extracts YouTube subtitles directly. **Automatically upgrades to the full service when it detects it running.**

| | Lite | Full |
|--|:---:|:----:|
| YouTube captions | Yes | Yes |
| Auto-generated subs | Yes | Yes |
| Whisper transcription | — | Yes |
| Speaker diarization | — | Yes |
| Persistent library | — | Yes |
| Setup | `yt-dlp` only | Node + Python + service |

### Triggers

> *"summarize https://youtube.com/watch?v=..."*
> *"transcribe https://youtube.com/watch?v=..."*
> *"s https://youtube.com/watch?v=..."* / *"t https://youtube.com/watch?v=..."* / *"ts https://youtube.com/watch?v=..."*

Or just paste a YouTube URL — the skill auto-activates.

## Use as an MCP Server

Works with Claude Desktop, Cursor, and any MCP-compatible client. During `npm run setup`, choose "yes" when prompted to install the MCP server.

```bash
npm run mcp:config   # prints config with your absolute path
```

Add the output to your client config ([full setup guide](./docs/MCP.md)):

| Client | Config file |
|--------|-------------|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Code | `.claude/mcp.json` or `claude mcp add` |
| Cursor | `.cursor/mcp.json` |

**Available tools:** `transcribe`, `transcribe_and_summarize`, `list_transcripts`, `search_transcripts`, `get_transcript`, `delete_transcript`, `summarize_transcript`

### Usage Examples

Once configured, just type naturally in Claude Desktop:

| You type | What happens |
|----------|-------------|
| `transcribe https://youtube.com/watch?v=...` | Fetches and returns the full transcript |
| `transcribe and summarize https://youtube.com/watch?v=...` | Fetches transcript, then Claude summarizes it |
| `t https://youtube.com/watch?v=...` | Shorthand for transcribe |
| `s https://youtube.com/watch?v=...` | Shorthand for summarize |
| `ts https://youtube.com/watch?v=...` | Shorthand for transcribe + summarize |

You can also just paste a YouTube URL — Claude will offer to transcribe it.

---

## How It Works

Paste a URL. The app grabs the transcript using the fastest method available on your system:

1. **YouTube Captions** — fetches official captions when they exist (< 5 sec)
2. **Cloud Whisper** — optional Groq, OpenRouter, or custom API with your own key (10-30 sec for 10 min)
3. **MLX Whisper** — local GPU transcription on Apple Silicon (30-60 sec for 10 min)
4. **OpenAI Whisper** — local CPU fallback that works everywhere (2-5 min for 10 min)

Works fully offline by default. Cloud Whisper is optional — bring your own API key to enable it.

## Features

- **Local + cloud transcription** — free local Whisper by default, optional cloud providers (Groq, OpenRouter, or custom endpoint) for faster results with your own API key
- **Chrome extension** — persistent side panel that transcribes from your browser as you watch
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

Built by [lifesized](https://github.com/lifesized).

**Built with:** [Intent by Augment](https://www.augmentcode.com/intent), [Cursor](https://cursor.sh), [Codex](https://openai.com/index/openai-codex/), [Claude Code](https://github.com/anthropics/claude-code), and [Ghostty](https://ghostty.org).
