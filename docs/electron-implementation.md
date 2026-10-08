# Electron Implementation — Technical Overview

**Branch**: `beta/electron-menubar`  
**Target**: macOS arm64, unsigned (ad-hoc signed), DMG  
**Launch**: Friends beta Oct 24, 2026

---

## Architecture

**Key Decision**: Use Electron's own Node binary (no separate bundle).

1. **Next.js standalone server**: Spawned via `process.execPath` (Electron's Node) with `ELECTRON_RUN_AS_NODE=1`
2. **Native messaging host**: Wrapper script also uses `process.execPath` + `ELECTRON_RUN_AS_NODE=1`
3. **Native modules**: better-sqlite3 rebuilt for Electron's ABI via `@electron/rebuild`
4. **Prisma engines**: darwin-arm64 engines bundled in standalone build

Keeps bundle smaller, ensures ABI compatibility across all components.

---

## Components

### Electron Main Process (`electron/main.js`)
- Single-instance lock
- Power save blocker (keep server running)
- Creates ServerManager + TrayManager
- Graceful shutdown on quit (SIGTERM → 5s → SIGKILL)

### ServerManager (`electron/server-manager.js`)
- Spawns standalone server: `ELECTRON_RUN_AS_NODE=1 $electronBinary .next/standalone/server.js`
- Health check polling (30s timeout)
- Port conflict detection (packaged app listens on 19721 so a checkout on 19720 can stay up)
- Auto-restart on crash (exponential backoff, max 3 attempts)
- Sets `DATABASE_URL`, `TRANSCRIBER_LOCAL_TOKEN`, `PATH` with bundled bins

### TrayManager (`electron/tray-manager.js`)
- Menu bar icon with status indicator
- Menu: Status line, Open Transcriber, Start at Login, Reinstall Browser Connection, Quit
- Displays uptime, error messages

### NativeHostInstaller (`electron/native-host-installer.js`)
- Detects installed browsers (Chrome, Brave, Arc, Edge)
- Writes native messaging manifests to each browser's `NativeMessagingHosts/` dir
- Creates wrapper script: `~/Library/Application Support/Transcriber App/transcriber-app-host.sh`
  - Uses Electron binary with `ELECTRON_RUN_AS_NODE=1` to run host script
  - Absolute paths (no PATH dependence)
  - Host name `com.transcribed.app.host` (checkout host stays `com.transcribed.host`)
- Extension IDs loaded from `~/Library/Application Support/Transcriber App/extension-ids.json`
- Checks for translocation (refuses install if app not in /Applications)

---

## Build System

### `electron-builder.json`
- **Target**: DMG, arm64 only
- **Code signing**: `identity: null` (unsigned), ad-hoc signed in after-pack
- **asar**: Enabled, with unpacked native modules + standalone server
- **extraResources**: `electron/resources/bin/` → bundled binaries (ffmpeg, yt-dlp)

### `electron/after-pack.js`
- Ad-hoc codesigns app + bundled binaries with entitlements
- Note: electron-builder already rebuilds better-sqlite3 before this hook

### `next.config.ts`
- Added `output: "standalone"` — builds to `.next/standalone/` with only prod deps

### npm Scripts
```json
"electron:dev": "NODE_ENV=development electron .",
"electron:build": "npm run build && electron-builder --mac --arm64"
```

---

## GitHub Actions (`electron-build-macos.yml`)

**Trigger**: `workflow_dispatch` + push to `beta/electron-menubar`  
**Runner**: `macos-14` (arm64)

**Steps**:
1. Checkout, setup Node 20, `npm ci`
2. `npm run build` (Next.js standalone)
3. **Download ffmpeg** (via Homebrew, verifies arm64 with `file` + `lipo`)
4. **Download yt-dlp** (arm64 from GitHub Releases)
5. `npm run electron:build` (electron-builder → DMG)
6. **Smoke test**: Run packaged server via `ELECTRON_RUN_AS_NODE=1`, hit health endpoint, verify better-sqlite3 loads
7. Upload DMG as artifact (30-day retention)

**Output**: `Transcriber-0.1.0-arm64.dmg`

---

## Data Directory

Packaged app (macOS): `~/Library/Application Support/Transcriber App/`  
Checkout `npm run dev`: `~/Library/Application Support/Transcriber/`

App contents:
- `transcriber.db` — SQLite database (Prisma)
- `local-api.token` — Loopback Bearer token
- `transcriber-app-host.sh` — Native messaging wrapper script
- `extension-ids.json` — User-configured extension IDs (optional)
- `electron-secrets.json` — Encrypted LLM/Notion settings
- `backups/` — Import library backups
- `native-host-state.json` — Native-host runtime state

Logs: `~/Library/Logs/Transcriber App/` (checkout host: `~/Library/Logs/Transcriber/`)

---

## Installation Flow (Friends Beta)

1. Download DMG
2. **Drag to /Applications BEFORE first open** (avoids translocation)
3. Open → Gatekeeper blocks → System Settings → Privacy & Security → "Open Anyway"
4. App launches, tray icon appears
5. Install extension (Chrome Web Store unlisted)
6. Create `~/Library/Application Support/Transcriber App/extension-ids.json` with extension ID
7. Tray menu → "Reinstall Browser Connection" → manifests written
8. Extension connects, transcribe videos

---

## Gaps / TODO

### Icons
- **Tray**: `tray-icon-Template.png` + @2x (16x16, 32x32 monochrome)
- **App**: `icon.icns` (1024x1024 ICNS)
- **Status**: Using Electron defaults (visible but generic)
- **Priority**: Low for beta (design will replace later)

### Extension IDs
- **Current**: User must create `extension-ids.json` manually
- **Action needed**: Document actual Chrome Web Store ID once James uploads
- **Alternative**: Add Settings UI to manage IDs

### Python/Whisper
- **Not bundled**: Beta is captions-first
- **If captions unavailable and no Python/Whisper**: Clear error message ("This video has no captions; audio transcription isn't available in this beta yet")
- **Never triggers**: macOS Command Line Tools prompt (checked in transcript library)

### Intel Macs
- **Current**: arm64 only
- **If needed**: Build universal binary (arm64 + x64), adds ~30% to DMG size

---

## Testing Checklist

Before shipping DMG:
- [ ] App launches, tray icon visible
- [ ] "Open Transcriber" opens browser to localhost:19721
- [ ] Web UI loads
- [ ] "Start at Login" toggle works
- [ ] Create `extension-ids.json`, install manifests
- [ ] Extension connects, transcribes video end-to-end
- [ ] Quit → server stops gracefully
- [ ] Reopen → server restarts, DB intact

---

## File Inventory

**Added** (12 files):
- `electron/` — 7 core files (main, managers, installer, utils, hooks)
- `.github/workflows/electron-build-macos.yml` — CI build
- `electron-builder.json` — Build config
- `docs/beta-install-macos.md` — Install guide
- `docs/electron-implementation.md` — This file
- `tests/electron-smoke.test.mjs` — Structure tests

**Modified** (2 files):
- `package.json` — Electron deps, main entry, scripts
- `next.config.ts` — Added standalone output
