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

> **Mac/Linux only for auto-setup.** Windows: use WSL or follow the [Manual Installation](#manual-installation) section.

> `npm run setup` installs all dependencies (yt-dlp, ffmpeg, Whisper, MLX on Apple Silicon) and configures everything automatically. Requires Node.js 18+, Python 3.8+, and a package manager (Homebrew / apt / dnf / pacman).

## Chrome Extension

<img width="375" height="565" alt="CleanShot 2026-03-17 at 22 53 31@2x" src="https://github.com/user-attachments/assets/d4bccf92-9941-46cc-b4f4-b7bbc3454ff7" />

https://github.com/user-attachments/assets/081c8d90-a6e1-4b4d-b6cd-bc8787bc0a3b

Transcribe any YouTube video or Spotify podcast episode directly from your browser without leaving the page. The extension opens as a persistent side panel — it stays open as you navigate between videos and detects each one automatically.

The extension works in two modes:

- **Cloud** (default) — hosted transcription for private beta users. Enter your API key in extension settings and go. No local setup needed.
- **Self-hosted** — connect to your local instance at `localhost:19720`. Switch to "Self-hosted" in extension settings.

### Install from Chrome Web Store

> **Note:** The extension is not yet on the Chrome Web Store. Install it manually in a few steps while we go through the review process.

### Install from source (for self-hosted or development)

1. Make sure the local service is running (`npm run dev`)
2. Build the unpacked extension (`npm run build:ext:dev`)
3. Open Chrome and go to `chrome://extensions`
4. Enable **Developer mode** (toggle, top right)
5. Click **Load unpacked**
6. Select the `extension/dist/` folder inside this repo
7. Open extension settings and switch mode to **Self-hosted**
8. Click the YouTube Transcriber icon in your toolbar to open the side panel

`Load unpacked` is a one-time step. After another `npm run build:ext:dev`, use
the existing Transcriber card's **Reload** button in `chrome://extensions`
instead of loading the folder again. The build prints the stable development
extension ID; keep the card with that ID.

### Usage

Navigate to any YouTube video or Spotify episode, open the side panel, and click **Transcribe**. In cloud mode, transcripts open in the hosted app. In self-hosted mode, they open in the local web app at `http://localhost:19720`.

### Connectors — send transcripts to Obsidian or Notion

Each transcript row's `⋯` menu can push the result to an external app. Connect once in **Settings → Connectors**, then use the menu on any recent transcript.

**Obsidian** — works in both cloud and self-hosted mode. Stateless: the extension builds an `obsidian://new?...` URL on your machine and hands it to the desktop app. Nothing transcript-related leaves the device.

1. Install [Obsidian](https://obsidian.md) and open your vault.
2. In the extension panel: gear icon → **Connectors** → toggle **Obsidian** on.
3. Type your vault name **exactly** as it appears in Obsidian's sidebar (case-sensitive).
4. (Recommended for long transcripts) Install the [Advanced URI](https://github.com/Vinzent03/obsidian-advanced-uri) community plugin in Obsidian, then expand **More** under the vault field and check **Use Advanced URI plugin**. Stock `obsidian://new` has a URL length cap that truncates long videos; Advanced URI handles them reliably.
5. From any recent transcript, click `⋯` → **Send to Obsidian**. Allow the protocol handler the first time Chrome prompts you.

**Notion** — cloud mode only. Uses OAuth; tokens are stored encrypted by the hosted service. Toggle **Notion** on in Connectors, authorize from the side panel, and share at least one page or database (a dedicated database works best) with the integration. Setup docs will ship with the hosted version.

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

| Client         | Config file                                                       |
| -------------- | ----------------------------------------------------------------- |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor         | `.cursor/mcp.json`                                                |

### Skill (no server needed)

https://github.com/user-attachments/assets/73a62192-746c-4ec0-b1d5-b46608441bdd

Install as a Claude Code or OpenClaw skill. Two flavors: **Lite** (zero setup, just `yt-dlp`, YouTube subtitles only) or **Full** (requires the service running, adds Whisper fallback, diarization, and persistent library).

```bash
# Lite skill (yt-dlp only, no server)
cp contrib/claude-code/SKILL-lite.md ~/.claude/skills/youtube-transcriber/SKILL.md

# Full skill (requires service running)
cp -r contrib/claude-code ~/.claude/skills/youtube-transcriber
```

|                       | Lite Skill | Full Skill / MCP |
| --------------------- | :--------: | :--------------: |
| YouTube captions      |    Yes     |       Yes        |
| Auto-generated subs   |    Yes     |       Yes        |
| Whisper transcription |     —      |       Yes        |
| Speaker diarization   |     —      |       Yes        |
| Persistent library    |     —      |       Yes        |
| Requires server       |     No     |       Yes        |

### Triggers

Once set up (MCP or skill), just type naturally:

> _"summarize https://youtube.com/watch?v=..."_
> _"ts https://youtube.com/watch?v=..."_ (transcribe + summarize)
> _"t https://youtube.com/watch?v=..."_ (transcript only)

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

**Private Google Drive videos (self-hosted extension):**

1. Opens Google's Picker and requests the narrow `drive.file` scope for the selected file
2. Downloads that file to a temporary folder on the local machine
3. Transcribes with local Whisper only; configured cloud transcription providers are not used
4. Deletes the temporary media file whether transcription succeeds or fails

The OAuth access token is kept only in memory for the active import. It is not written to the database, extension storage, URLs, or logs. Summarizing with Claude or ChatGPT remains a separate, explicit handoff of transcript text.

Works fully offline by default for YouTube. Cloud Whisper is optional — bring your own API key to enable it.

## Features

- **YouTube + Spotify** — paste a YouTube video URL or Spotify podcast episode URL
- **Local + cloud transcription** — free local Whisper by default, optional cloud providers (Groq, OpenRouter, or custom endpoint) for faster results with your own API key
- **Chrome extension** — persistent side panel that transcribes YouTube videos and Spotify episodes from your browser
- **Private Google Drive import** — per-file consent and temporary local-only processing in self-hosted mode
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

# Optional — private Google Drive files in the self-hosted Chrome extension.
# Enable the Google Drive API and Google Picker API in your Google Cloud project,
# create an OAuth 2.0 Web application client, and register the redirect URI below.
# GOOGLE_DRIVE_CLIENT_ID="...apps.googleusercontent.com"
# GOOGLE_DRIVE_CLIENT_SECRET="..."
# GOOGLE_DRIVE_REDIRECT_URI="http://127.0.0.1:19720/api/drive/oauth/callback"
# GOOGLE_DRIVE_EXTENSION_IDS="abcdefghijklmnopqrstuvwxyzabcdef" # chrome://extensions ID
# GOOGLE_DRIVE_MAX_BYTES="5368709120" # default: 5 GiB
```

`GOOGLE_DRIVE_EXTENSION_IDS` is required for local private-Drive imports. The
server rejects every extension caller when the list is empty. See
[Google Drive import diagnosis](./docs/GOOGLE-DRIVE-IMPORT-DIAGNOSIS.md) for the
verified failure mode and recovery steps.

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
<summary>The unpacked extension disappeared, is duplicated, or opens a blank panel</summary>

1. Run `npm run build:ext:dev` and note the printed **Stable dev extension ID**.
2. Open `chrome://extensions` with **Developer mode** enabled.
3. If that ID already exists, click **Reload** on its card. Do not click **Load unpacked** again.
4. If two Transcriber cards point to the same `extension/dist` folder, confirm the stable-ID card opens and retains the expected settings, then remove only the other card.
5. For self-hosted mode, verify the local service separately with `curl http://127.0.0.1:19720/api/health`; start it with `npm run dev` if it is unavailable.
6. Close and reopen the side panel after reloading the extension.

Development builds publish staged files into the existing `extension/dist`
directory without deleting that directory or replacing byte-identical files.
This matters because Chrome runs an unpacked extension directly from the
selected folder: removing the loaded path can unregister it, while replacing an
unchanged live panel resource can leave the persistent side panel blank until
the extension is reloaded.

The panel should show a **Loading Transcriber…** shell immediately. If the
shell remains for an unusually long time, inspect the side panel console for
the `[ytt-popup] startup shell replaced` timing entry; `scriptReadyMs` measures
when the application script became available and `uiReadyMs` measures its DOM
update. Neither value proves that Chrome painted the panel at that moment.
If the Chrome panel container is visible without that shell, reload the
extension: the service worker now configures `popup.html` before handling
toolbar clicks, and the click calls Chrome's programmatic open API directly.
The toolbar action is open-only; use the panel header's × to close it.
</details>

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
