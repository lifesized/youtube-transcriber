# Electron Implementation — Technical Overview

**Beta branch:** `beta/electron-menubar`  
**Target:** macOS arm64, unsigned (ad-hoc signed), DMG distribution  
**Launch:** Friends beta Oct 24, 2026

---

## Architecture

### Key Design Decision: Use Electron's Node Binary

Following your override of the scope doc, we **do not bundle a separate Node.js binary**. Instead:

1. The **Next.js standalone server** runs via `process.execPath` (Electron's bundled Node) with `ELECTRON_RUN_AS_NODE=1`
2. The **native messaging host** wrapper script also uses `process.execPath` with `ELECTRON_RUN_AS_NODE=1`
3. **Native modules** (better-sqlite3) are rebuilt for Electron's ABI using `@electron/rebuild`
4. **Prisma engines** are included for darwin-arm64 (already in the standalone build)

This keeps the bundle smaller and ensures ABI compatibility across all components.

---

## File Structure

```
electron/
├── main.js                      # Electron main process entry point
├── server-manager.js            # Next.js server lifecycle manager
├── tray-manager.js              # Menu bar tray icon & menu
├── native-host-installer.js     # P1: Chrome/Brave/Arc/Edge manifest writer
├── utils.js                     # Helper functions (translocation detection)
├── entitlements.mac.plist       # macOS entitlements for ad-hoc signing
├── after-pack.js                # electron-builder hook: rebuild natives, codesign
├── after-sign.js                # electron-builder hook: (no-op for unsigned)
└── resources/
    ├── tray-icon-Template.png   # Menu bar icon (placeholder)
    ├── icon.icns                # App icon (placeholder)
    └── bin/                     # Bundled binaries (ffmpeg, yt-dlp) — empty until build

electron-builder.json             # Build config: arm64 DMG, unsigned
.github/workflows/
└── electron-build-macos.yml     # GitHub Actions: macOS arm64 runner, DMG artifact
docs/
├── beta-install-macos.md        # Friends beta install instructions
└── electron-implementation.md   # This file
tests/
└── electron-smoke.test.mjs      # Structure validation tests
```

---

## P0: Shell + Server + Tray

### `electron/main.js`

- **Single-instance lock**: `app.requestSingleInstanceLock()` prevents multiple instances
- **Power save blocker**: `powerSaveBlocker.start('prevent-app-suspension')` keeps CPU active while server runs
- **Translocation check**: Detects if app is running from `/private/var/folders/...` (Gatekeeper quarantine) and warns user
- **Lifecycle**:
  1. On `app.whenReady()`: create ServerManager + TrayManager
  2. Start server
  3. Update tray status based on server events
  4. On `before-quit`: stop server gracefully (SIGTERM, 5s timeout, then SIGKILL)

### `electron/server-manager.js`

- **Spawn**: Uses `process.execPath` (Electron's Node) with `ELECTRON_RUN_AS_NODE=1` to run `.next/standalone/server.js`
  - In dev: spawns `npm run dev` instead
  - Passes env: `TRANSCRIBER_LOCAL_TOKEN`, `DATABASE_URL` (SQLite in `~/Library/Application Support/Transcriber/`), `PATH` (includes bundled bin/)
- **Health check**: Polls `http://127.0.0.1:19720/api/health` until 200 OK (max 30s)
- **Port conflict detection**: Checks port before spawn; if occupied, sets status to `port-conflict` and shows error in tray
- **Auto-restart on crash**: Exponential backoff (2s, 4s, 8s), max 3 attempts
- **Graceful shutdown**: SIGTERM → 5s timeout → SIGKILL

### `electron/tray-manager.js`

- **Tray icon**: Template icon (monochrome, macOS auto-renders for light/dark mode)
- **Menu items**:
  - **Status line**: "● Running (2h)" / "● Starting..." / "✕ Port 19720 in use" / "○ Stopped"
  - **Open Transcriber**: `shell.openExternal("http://127.0.0.1:19720")` (opens in default browser)
  - **Start at Login**: Toggle via `app.setLoginItemSettings({ openAtLogin })`
  - **Reinstall Browser Connection**: Calls `NativeHostInstaller.install()` (P1)
  - **Quit Transcriber**: `app.quit()`

---

## P1: Native Host Installation

### `electron/native-host-installer.js`

- **On first launch** (and from tray menu): writes native messaging manifest for Chrome/Brave/Arc/Edge
- **Detection**: Checks if browser apps exist in `/Applications/`
- **Manifest path**:
  - Chrome: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.transcribed.host.json`
  - Brave: `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/...`
  - Arc: `~/Library/Application Support/Arc/NativeMessagingHosts/...`
  - Edge: `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/...`
- **Wrapper script**: Writes `~/Library/Application Support/Transcriber/transcriber-host.sh`:
  ```bash
  #!/bin/sh
  export ELECTRON_RUN_AS_NODE=1
  exec "/Applications/Transcriber.app/Contents/MacOS/Transcriber" \
    "/Applications/Transcriber.app/Contents/Resources/app.asar.unpacked/tools/native-host/transcriber-host.js" "$@"
  ```
  (Paths are absolute, resolved at install time — no PATH dependence)
- **Allowed extension IDs**: Currently placeholder `gkfnbcjjpkhoohpgdkmefjmmadcjbljb` — replace with actual LOCAL extension ID(s) from Chrome Web Store / dev builds
- **Translocation detection**: If app is in `/private/var/folders/...`, **refuses to install** and shows error: "Move Transcriber to Applications, then reopen it."

### Reusing Existing Native Host Script

The bundled `tools/native-host/transcriber-host.js` is unchanged. It:

- Receives Chrome native messaging stdin/stdout framed JSON
- Commands: `ping`, `probe`, `start`, `stop`, `status`, `getLocalToken`
- Spawns `npm run dev` as detached process (in standalone mode, this will be the already-running server, so `start` becomes a no-op / health check)
- Returns loopback API token for extension auth

**Important:** The host script now runs via Electron's Node (with `ELECTRON_RUN_AS_NODE=1`), so `process.execPath` inside the script still points to the Electron binary. The host's `spawn("npm", ["run", "dev"])` will work because npm is in the augmented PATH.

---

## Build System

### `electron-builder.json`

- **Target**: `dmg`, `arm64` only
- **Code signing**: `identity: null` (unsigned), `hardenedRuntime: false`, `gatekeeperAssess: false`
- **asar**: `true`, with `asarUnpack` for:
  - `better-sqlite3` (native module)
  - `@prisma` (native engines)
  - `.next/standalone` (server code)
  - `tools/` (native host script)
- **extraResources**: `electron/resources/bin/` → bundled binaries (ffmpeg, yt-dlp)
- **Hooks**:
  - `afterPack`: `electron/after-pack.js` — rebuilds better-sqlite3 for Electron ABI, ad-hoc codesigns all binaries
  - `afterSign`: `electron/after-sign.js` — no-op for unsigned (placeholder for future notarization)

### `electron/after-pack.js`

1. **Rebuild native modules**: `npx electron-rebuild --version=<electron-version> --module-dir=app.asar.unpacked`
   - Recompiles better-sqlite3 for Electron's Node ABI
   - Required because npm install builds for system Node, not Electron
2. **Ad-hoc codesign**: `codesign --sign - --force --deep --entitlements entitlements.mac.plist Transcriber.app`
   - macOS requires arm64 binaries to be at least ad-hoc signed to run
   - Also codesigns bundled ffmpeg/yt-dlp if present
   - **Note:** Ad-hoc signing is NOT notarization — users still see Gatekeeper "unidentified developer" on first launch

### `next.config.ts`

Added `output: "standalone"` — Next.js builds to `.next/standalone/` with only production dependencies, plus `.next/static/` and `public/` copied in.

### npm Scripts

```json
"electron:dev": "NODE_ENV=development electron .",
"electron:build": "npm run build && electron-builder --mac --arm64",
"electron:rebuild": "electron-rebuild --force"
```

---

## GitHub Actions Workflow

### `.github/workflows/electron-build-macos.yml`

- **Trigger**: `workflow_dispatch` (manual) + push to `beta/electron-menubar`
- **Runner**: `macos-14` (Apple Silicon arm64)
- **Steps**:
  1. Checkout code
  2. Setup Node 20
  3. `npm ci` (install deps)
  4. `npm run build` (Next.js standalone)
  5. **Download ffmpeg** (arm64 static build from evermeet.cx)
  6. **Download yt-dlp** (arm64 from GitHub Releases)
  7. `npm run electron:build` (electron-builder → DMG)
  8. Upload DMG as artifact (30-day retention)

**Output**: `Transcriber-0.1.0-arm64.dmg` in `dist-electron/`

**Limitation**: Linux VM can't build macOS DMGs, so this workflow MUST run on a macOS runner. The workflow is configured to do so.

---

## Testing

### `tests/electron-smoke.test.mjs`

Smoke tests verify:

- Electron file structure (main.js, config, entitlements)
- Modules load without errors (ServerManager, TrayManager, NativeHostInstaller)
- package.json has correct `main` field and scripts
- Next.js config has `output: "standalone"`
- GitHub Actions workflow exists
- Beta install docs exist

**Run**: `node --test tests/electron-smoke.test.mjs`

**Note:** These tests do NOT launch Electron (no display on Linux CI). Full integration testing requires macOS with a display.

---

## Installation Flow (Friends Beta)

1. **Download DMG** from link
2. **Drag to /Applications** BEFORE first open (avoids translocation)
3. **First launch blocked** by Gatekeeper:
   - System Settings → Privacy & Security → "Open Anyway"
   - On macOS Sequoia, right-click → Open no longer works — must use Settings
4. **App starts**, tray icon appears
5. **Install extension** (Chrome Web Store unlisted link)
6. **Reinstall browser connection** (tray menu) — writes native host manifests
7. **First transcription**: Python venv + Whisper install (~2 min one-time setup)

Detailed steps in `docs/beta-install-macos.md`.

---

## Remaining Gaps / Risks

### Icons

- **Placeholder icons**: `tray-icon-Template.png`, `icon.icns` are currently missing
- **Action needed**: Design or source proper icons before DMG build
  - Tray: 16x16 or 32x32 template PNG (monochrome)
  - App: 1024x1024 ICNS (multiple resolutions)

### Extension IDs

- **Hardcoded placeholder**: `gkfnbcjjpkhoohpgdkmefjmmadcjbljb` in `native-host-installer.js`
- **Action needed**: Replace with actual extension ID(s):
  - Chrome Web Store unlisted listing ID (James uploads)
  - Local unpacked dev builds (if any)
- **Alternative**: Add Settings UI to manually add/remove IDs

### Python/Whisper Setup

- **Not bundled**: First-launch venv install runs `python3 -m venv` + `pip install openai-whisper mlx-whisper`
- **Assumption**: macOS 12+ ships Python 3.9+
- **Risk**: If user has no Python or broken pip, transcription fails
- **Mitigation**: Clear error message in UI, install docs mention Python prerequisite
- **Future**: Bundle Python framework + wheels (~500 MB DMG) for zero-setup experience

### Unsigned Build Friction

- **Gatekeeper block on first launch**: Users must use System Settings → "Open Anyway"
- **Sequoia (15.x) stricter**: Right-click → Open no longer works
- **Risk**: Non-technical users may be confused or scared
- **Mitigation**: Very clear install docs, screenshots
- **Escalation path**: Move to signed build (Phase S) if too many users report issues

### Translocation

- **If app runs from DMG or Downloads**, macOS may translocate it to `/private/var/folders/...`
- **Effect**: Native host manifest has wrong absolute path, extension can't connect
- **Detection**: `checkIfTranslocated()` in utils.js
- **Warning**: Tray menu shows "Move to Applications" and refuses to install native host
- **Docs**: Install instructions emphasize dragging to Applications BEFORE first open

### Port 19720 Conflict

- **If dev server (`npm run dev`) is running**, Electron app can't bind to 19720
- **Detection**: Health check before spawn
- **Tray shows**: "✕ Port 19720 in use (dev server running?)"
- **User action**: Kill dev server, restart app

### macOS Arm64 Only

- **Beta is arm64 only** — Intel Macs not supported
- **If friends have Intel Macs**: Need to build universal binary (arm64+x64)
  - Increases DMG size ~30%
  - Requires separate ffmpeg/yt-dlp x64 binaries
  - electron-builder config: `arch: ["arm64", "x64"]`
- **Defer until needed** based on beta tester hardware

---

## Next Steps for James

### Before First DMG Build

1. **Replace placeholder icons**:
   - `electron/resources/tray-icon-Template.png` (16x16, monochrome)
   - `electron/resources/icon.icns` (1024x1024 ICNS)
2. **Update extension ID** in `electron/native-host-installer.js`:
   - Replace `gkfnbcjjpkhoohpgdkmefjmmadcjbljb` with actual Web Store ID
3. **Test on your Mac**:
   ```bash
   git checkout beta/electron-menubar
   npm install
   npm run build
   npm run electron:dev
   ```
   - Check tray icon appears
   - Click "Open Transcriber" → browser opens to localhost:19720
   - Click "Reinstall Browser Connection" → manifests written
   - Load extension, test transcription end-to-end

### GitHub Actions DMG Build

1. **Push branch** → workflow auto-triggers on push to `beta/electron-menubar`
2. **Or manually trigger**: GitHub Actions tab → "Build Electron macOS DMG" → Run workflow
3. **Download artifact**: Actions run page → Artifacts → `Transcriber-macOS-arm64.dmg`

### Distribution

1. **Upload DMG** to private link (S3, Dropbox, etc.)
2. **Upload extension** to Chrome Web Store (unlisted)
3. **Share links** with beta testers via Slack/email
4. **Include** `docs/beta-install-macos.md` link

### Monitoring

- **Collect feedback** on:
  - Gatekeeper friction (how many users hit "damaged" errors?)
  - First-launch Python setup (any timeouts or failures?)
  - Native host connection (extension "Server offline" reports)
  - Port conflicts (users running dev server accidentally)
- **Iterate** based on feedback
- **Escalate to Phase S** (signed builds) if Gatekeeper issues are widespread

---

## Code Quality Notes

- **ESM imports**: All Electron code uses CommonJS (`require()`) since Electron main process doesn't fully support ESM yet
- **Error handling**: All async operations in server-manager and native-host-installer have try/catch
- **Logging**: Console logs go to macOS Console.app (searchable by "Transcriber")
- **No lint errors**: Existing eslint config passes (all Electron code is .js, not .ts)

---

## Testing Checklist (On Mac)

Before shipping DMG to friends:

- [ ] App launches without crash
- [ ] Tray icon appears with menu
- [ ] "Open Transcriber" opens browser to localhost:19720
- [ ] Next.js UI loads successfully
- [ ] "Start at Login" toggle works (check System Settings → Login Items)
- [ ] "Reinstall Browser Connection" writes manifests (check `~/Library/Application Support/*/NativeMessagingHosts/`)
- [ ] Extension connects via native host (side panel shows "Server running")
- [ ] Extension can start server if stopped (via "Start Transcriber" button)
- [ ] Extension fetches loopback token successfully (`getLocalToken` command)
- [ ] Transcribe a YouTube video end-to-end
- [ ] First transcription triggers Python venv setup (progress visible?)
- [ ] Whisper model downloads on first use
- [ ] Quit app → server stops gracefully
- [ ] Reopen app → server restarts, database intact
- [ ] Translocation warning appears if app runs from DMG (before dragging to Applications)
- [ ] Port conflict detected if dev server is running

---

## Architecture Diagram (ASCII)

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron Main Process                    │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  main.js    │  │ TrayManager  │  │ ServerManager    │   │
│  │             │─→│   (menu,     │─→│ (spawn Next.js   │   │
│  │ Single inst.│  │   icon,      │  │  standalone,     │   │
│  │ Power block │  │   status)    │  │  health check,   │   │
│  └─────────────┘  └──────────────┘  │  restart)        │   │
│                          │           └──────────────────┘   │
│                          │                     │             │
│                          ↓                     ↓             │
│              ┌────────────────────┐  ┌──────────────────┐   │
│              │ NativeHostInstaller│  │ Next.js Server   │   │
│              │  (write manifests, │  │ (.next/standalone│   │
│              │   wrapper script)  │  │  + Prisma + DB)  │   │
│              └────────────────────┘  └──────────────────┘   │
│                          │                     │             │
└──────────────────────────│─────────────────────│─────────────┘
                           │                     │
                           ↓                     ↓
        ┌──────────────────────────┐   ┌─────────────────────┐
        │ Browser (Chrome/Brave/   │   │ http://127.0.0.1:   │
        │  Arc/Edge)               │   │ 19720               │
        │  ┌─────────────────────┐ │   │  ┌───────────────┐  │
        │  │ Extension           │─┼───┼─→│  Web UI       │  │
        │  │ (LOCAL, side panel) │ │   │  │  (Next.js)    │  │
        │  └─────────────────────┘ │   │  └───────────────┘  │
        │           ↕              │   │                     │
        │  ┌─────────────────────┐ │   │                     │
        │  │ Native Messaging    │ │   │                     │
        │  │ Host (stdio)        │←┼───┘                     │
        │  │ transcriber-host.js │ │                         │
        │  └─────────────────────┘ │                         │
        └──────────────────────────┘                         │
                                                              │
        ┌─────────────────────────────────────────────────────┘
        │
        ↓
┌─────────────────────────────────────────────────────────────┐
│  ~/Library/Application Support/Transcriber/                 │
│    ├── transcriber.db           (SQLite)                    │
│    ├── local-api.token          (loopback Bearer)           │
│    ├── transcriber-host.sh      (native host wrapper)       │
│    └── .venv/                   (Python + Whisper)          │
│                                                              │
│  ~/Library/Logs/Transcriber/                                │
│    └── native-host.log                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Summary

This implementation delivers **P0 (shell + server + tray)** and **P1 (native host install)** as specified:

✅ **Single-instance lock**  
✅ **Tray icon with status + menu**  
✅ **Next.js standalone server via Electron's Node (`ELECTRON_RUN_AS_NODE=1`)**  
✅ **Health check polling until ready**  
✅ **Auto-restart on crash with backoff**  
✅ **Port conflict detection**  
✅ **Data dir `~/Library/Application Support/Transcriber/`**  
✅ **Power save blocker**  
✅ **Native host installation for Chrome/Brave/Arc/Edge**  
✅ **Translocation detection + warning**  
✅ **GitHub Actions macOS arm64 DMG build**  
✅ **Friends beta install docs**  
✅ **Ad-hoc codesigning**  
✅ **No bundled Python** (Whisper setup on first transcription)  

**Not included** (deferred as specified):

- ffmpeg/yt-dlp binaries (GitHub Actions downloads them, but placeholder `bin/` in repo)
- Whisper Python bundling (first-launch venv install instead)
- Auto-update (manual DMG for beta)
- Signed/notarized builds (Phase S, later)

The branch is ready for James to test locally and trigger a CI build. Once icons and extension ID are added, the DMG is ready for friends beta on Oct 24.
