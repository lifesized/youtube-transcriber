# Beta Electron Menu-Bar App — Unsigned Build Scope

**Target**: Friends/design partners beta (macOS only, unsigned, direct download)  
**Approach**: Unsigned DMG distribution first; signing/notarization deferred to optional Phase S

---

## What the LOCAL Server Is Today

- **Framework**: Next.js 16 production server (`next start`), runs on loopback `127.0.0.1:19720`
- **Database**: SQLite via Prisma (`better-sqlite3` native module, requires rebuild per Node version)
- **Start scripts**: `npm run dev` (Next.js dev) or `npm run start` (production build via `next build` → standalone output at `.next/standalone/`)
- **Dependencies**: Node 20.19+/22.12+/24+, Python 3.8+ (for Whisper), yt-dlp, ffmpeg
- **Transcription backends**: 
  - yt-dlp (download YouTube audio)
  - openai-whisper (Python CLI, CPU fallback)
  - mlx-whisper (Python module, Apple Silicon GPU via MLX, ~10x faster than CPU)
  - Optional pyannote.audio (speaker diarization, requires HF_TOKEN)
- **Native host**: `tools/native-host/transcriber-host.js` — Chrome native messaging host that spawns `npm run dev` as detached process, manages loopback token

---

## What Must Be Bundled

### Core Runtime
- **Node.js binary** (~100 MB arm64+x64 universal): embed Node runtime to avoid PATH/shell dependence. Use `ELECTRON_RUN_AS_NODE=1` for subprocess or bundle standalone Node binary.
- **Next.js standalone build** (~40 MB): `next build` produces `.next/standalone/` with only production dependencies. Include this + `.next/static/` + `public/`.
- **better-sqlite3 native module**: Prisma uses this; must be compiled for Electron's Node ABI. Rebuild with `electron-rebuild` post-install.
- **Prisma engines** (~20 MB): `libquery_engine-darwin-arm64.dylib.node` and x64 variant. Universal binary requires both.

### External Binaries
- **yt-dlp** (~15 MB): single Python zipapp, frequently updated. Bundle current version; consider separate update channel (GitHub Releases, check-on-launch).
- **ffmpeg** (~60 MB arm64+x64 universal or ~30 MB single-arch): static build from [evermeet.cx/ffmpeg](https://evermeet.cx/ffmpeg/) or Homebrew universal bottle. Must be executable.
- **Whisper models** (not bundled): `~/.cache/whisper/` (openai-whisper) and `~/.cache/huggingface/hub/` (mlx-whisper). Downloaded on first transcription. Base model ~150 MB, large-v3 ~3 GB. Ship with **no models**; download on first use to keep DMG small.

### Python Environment
- **Python 3 + venv**: Do NOT bundle a full Python. Require user's system Python 3.8+ (macOS ships 3.9+ since Monterey). On first launch, create `.venv` in `~/Library/Application Support/Transcriber/` and `pip install openai-whisper mlx-whisper pyannote.audio`. Electron app runs `python3 -m venv` at startup if venv missing. Store venv path in app state, pass via `WHISPER_PYTHON_BIN`/`WHISPER_CLI` env vars to Next.js server.
- **Alternative (heavier, stabler)**: Bundle Python framework (~50 MB) + pre-built wheels (~200 MB). Increases DMG to ~500 MB but avoids first-launch install step. **Recommend lightweight approach for beta**.

### Estimated Download Size
- Unsigned DMG (lightweight): **~250 MB** (Node + Next.js standalone + ffmpeg + yt-dlp + Electron app shell + native modules)
- With bundled Python + wheels: **~500 MB**
- Models fetched separately, not counted.

---

## Approach: Production Next.js Inside Electron

**Start Flow**:
1. Electron main process boots, checks if Next.js server is running via `http://127.0.0.1:19720/api/health`
2. If down, spawn `node .next/standalone/server.js -p 19720 --hostname 127.0.0.1` as child process (not via npm, direct Node)
3. BrowserWindow loads `http://127.0.0.1:19720` once health check passes
4. On quit, send SIGTERM to Next.js child, wait 5s, SIGKILL if hung

**Native Host**:
- Reuse `tools/native-host/transcriber-host.js` but point `path` in manifest to **bundled Node inside app**. Use absolute path like `/Applications/Transcriber.app/Contents/Resources/app.asar.unpacked/node/bin/node`.
- Extension must install native host on first run (user clicks "Enable Extension" in app Settings). App writes manifest with bundled Node path + extension IDs to `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.transcribed.host.json`.
- Support Chrome, Brave, Arc, Edge (`~/Library/Application Support/{Google/Chrome, BraveSoftware/Brave-Browser, Arc, Microsoft Edge}/NativeMessagingHosts/`).

**Loopback Security**:
- Keep existing `TRANSCRIBER_LOCAL_TOKEN` (Bearer token in `~/Library/Application Support/Transcriber/local-api.token`). Middleware validates Origin + token on loopback requests.
- Extension fetches token via native host `getLocalToken` command, never stores it.

---

## Menu-Bar App UI

**Tray Icon** (template image, monochrome):
- Idle: app icon
- Server running: green dot badge
- Transcribing: animated dots or progress indicator

**Menu**:
- **Open Transcriber** → brings app window to front (or opens `http://127.0.0.1:19720` in default browser if headless mode)
- **Server Status** → shows "Running" / "Stopped" + uptime
- **Start Server** / **Stop Server** (conditional, grayed when already in that state)
- ────────
- **Settings...** → opens Settings in app window (or `/settings` route in browser)
- **Check for Updates** (Phase P3 manual flow)
- ────────
- **Quit Transcriber** → stops server gracefully, quits app

**Login Item**: Use `app.setLoginItemSettings({ openAtLogin: true })` (macOS 10.13+, no helper). Checkbox in Settings.

---

## Chrome Extension Pairing

**Web Store Unlisted Listing**:
- James uploads LOCAL extension build to Chrome Web Store as **unlisted** (visibility: "Private — only you can access it via link").
- Share link with beta users via email/Slack. No public listing; avoids review delays for beta iteration.
- **Alternative**: Distribute extension as signed CRX or zip for manual install (users must enable Developer mode, less friendly).

**Extension ID Allowlist**:
- Native host manifest `allowed_origins` must include extension IDs for:
  - Unlisted Store version (ID changes with each upload — James pins one beta ID)
  - Local unpacked dev builds (ID is deterministic from manifest `key` field or random if no key)
- App Settings UI: "Add Extension ID" field to manually add IDs without reinstalling host.

**First-Run Setup**:
1. User installs extension from unlisted link
2. Extension detects no native host, shows error: "Native host not installed"
3. User opens Transcriber app → Settings → Extensions → "Install Native Host"
4. App writes manifest for all supported browsers with bundled Node path
5. User reloads extension, clicks "Test Connection" → success toast

---

## Phase Breakdown (Unsigned Build)

### Phase 0: Shell + Server + Tray (P0)
**Goal**: Boot Next.js server inside Electron, tray icon with Start/Stop/Open/Quit  
**Tasks**:
- Scaffold Electron main process: `electron-builder` config, DMG build
- Embed Node binary (extract from Electron or bundle standalone)
- `next build` → standalone mode, bundle `.next/standalone/` + static assets in app
- Rebuild `better-sqlite3` for Electron ABI (`electron-rebuild`)
- Health-check loop: spawn `node .next/standalone/server.js` on boot
- Tray menu: Open (opens localhost in default browser or BrowserWindow), Start/Stop, Quit
- Auto-start server on app launch (default on)
- Ad-hoc codesign (`codesign -s -`) for arm64 quarantine bypass (test if needed)

**Estimate**: 3–4 engineering days (Electron boilerplate, subprocess lifecycle, tray menu)

---

### Phase 1: Native Host Install (P1)
**Goal**: In-app UI to write native host manifests for Chrome/Brave/Arc/Edge  
**Tasks**:
- Settings panel: "Extensions" section with "Install Native Host" button
- On click, write `com.transcribed.host.json` to all browser manifest dirs (loop array of paths)
- Manifest `path` points to bundled Node: `/Applications/Transcriber.app/Contents/Resources/app.asar.unpacked/node/bin/node /Applications/Transcriber.app/Contents/Resources/app.asar.unpacked/tools/native-host/transcriber-host.js`
- `allowed_origins`: default to placeholder ID + "Add Extension ID" text field (saves to app state, regenerates manifests)
- Uninstall button (removes manifests)
- Diagnostics: "Test Native Host" (spawns host process, sends `ping`, shows result)

**Estimate**: 2 engineering days (file writes, path resolution, Settings UI)

---

### Phase 2: Bundle External Binaries (P2)
**Goal**: Ship yt-dlp, ffmpeg; Python venv setup on first launch  
**Tasks**:
- Download universal ffmpeg binary, bundle in `app.asar.unpacked/bin/` (unpacked so it's executable)
- Download yt-dlp, bundle same location
- Electron main: on first launch, detect if `~/Library/Application Support/Transcriber/.venv/` exists
  - If missing: spawn `python3 -m venv ~/.../Transcriber/.venv && source .venv/bin/activate && pip install openai-whisper mlx-whisper pyannote.audio`
  - Show progress modal: "Setting up Whisper... (this takes ~2 min on first launch)"
- Store venv paths in app config, pass to Next.js server via `WHISPER_PYTHON_BIN` and `WHISPER_CLI` env vars
- Next.js server reads `YTDLP_PATH` / `FFMPEG_PATH` env vars (set by Electron to bundled bin paths)
- Test transcription end-to-end

**Estimate**: 2–3 engineering days (binary bundling, venv bootstrap, env var plumbing, quarantine testing)

---

### Phase 3: Auto-Update (Manual Flow for Unsigned) (P3)
**Goal**: In-app "Check for Updates" that opens GitHub Releases or download link  
**Tasks**:
- Unsigned builds **cannot** use `electron-updater` (requires codesigning). Manual flow only.
- On app boot, fetch `https://api.github.com/repos/lifesized/youtube-transcriber/releases/latest` (or James's private JSON feed)
- Compare `version` in `package.json` vs. latest release tag
- If newer: show banner in Settings: "New version X.Y.Z available — [Download](link) · [Release Notes](changelog)"
- "Check for Updates" menu item does same check, shows "Up to date" toast or download banner
- User downloads new DMG manually, drags to `/Applications/` (replaces old app)
- **Alternative (future)**: Host signed update feed + Squirrel.Mac after Phase S

**Estimate**: 1 engineering day (version check, banner UI, JSON feed)

---

### Phase 4: Beta Distribution (P4)
**Goal**: Package DMG, write install instructions, distribute to friends  
**Tasks**:
- `electron-builder` config: DMG with drag-to-Applications background image
- Ad-hoc sign all binaries with `codesign -s -` (if needed for arm64; test first)
- Build universal binary (arm64+x64) or arm64-only (most Macs)
- Upload DMG to GitHub Releases or private S3 link
- Write install doc: download, open DMG, drag to Applications, right-click → Open (see Gatekeeper notes below)
- Extension: upload to Web Store as unlisted, share link with beta users
- Email beta users: DMG link + extension link + setup steps

**Estimate**: 1 engineering day (DMG assets, build pipeline, docs)

**Total P0–P4**: ~9–11 engineering days (unsigned beta-ready)

---

## Install Notes for Friends (Unsigned App)

### First Launch — Gatekeeper Block
1. **Download DMG** and open it
2. **Drag Transcriber.app to Applications**
3. **First launch**: Double-click → macOS shows **"Transcriber cannot be opened because it is from an unidentified developer"**
4. **Workaround A (recommended)**: System Settings → Privacy & Security → scroll to "Transcriber was blocked..." → click **"Open Anyway"** → click **"Open"** in confirmation dialog
5. **Workaround B**: Right-click Transcriber.app → **"Open"** (first time) → click **"Open"** in dialog

**Quarantine on DMG**: macOS sets `com.apple.quarantine` xattr on downloaded DMG and extracted contents. Gatekeeper enforces unsigned-app block. **Do NOT tell users to run `xattr -dr com.apple.quarantine`** — it's security-hostile and scares non-technical users. Use "Open Anyway" flow instead.

**Nested Binaries (ffmpeg, yt-dlp, node)**: Bundled in `app.asar.unpacked/` or `Contents/Resources/bin/`. If unsigned, they inherit quarantine from parent `.app`. Ad-hoc `codesign -s -` may reduce Gatekeeper friction (test both signed and unsigned). If dialogs persist for each binary, add instructions: "If macOS asks about ffmpeg/yt-dlp, click Open for each."

**Translocation (Ventura+)**: If app runs from DMG or a read-only location, macOS translocates it to a randomized path (breaks absolute paths in native host manifest). **Install instructions must say**: "Drag to Applications **before** first launch."

---

## Limits of Being Unsigned

### Auto-Update
- **Squirrel.Mac / electron-updater** require a **signed** app (they validate signatures before applying updates).
- **Unsigned flow**: Manual "Check for Updates" → download link → user re-installs DMG. No silent background updates.
- **Workaround (future)**: Self-signed update feed with hash validation (risky; easy to MITM). Or wait for Phase S (signed updates).

### Native Host
- **Chrome** will launch an **unsigned** native host script/binary if it's executable and not quarantined.
- **Problem**: If bundled Node binary inside `.app` is quarantined, Chrome may block it with "Native host has exited" error.
- **Mitigation**: Ad-hoc codesign (`codesign -s - /Applications/Transcriber.app/Contents/Resources/.../node`) may clear quarantine flag. Test on fresh macOS install.
- **Fallback**: If native host fails, extension shows "Start server manually: open Transcriber app". User can still send URLs via copy-paste into web UI.

### Login Item
- **Unsigned apps can register as login items** via `app.setLoginItemSettings()` (sandboxed or not). Works fine.
- **Caveat**: User sees "Transcriber" in Login Items list but can't verify publisher (no code signature in System Settings). Cosmetic only; functionally works.

### Keychain Access (Notion Tokens, Phase "Connectors Later")
- **macOS Keychain** (`security` CLI or Electron `safeStorage`) works with unsigned apps **but**:
  - Unsigned items have no identity in Keychain Access (shows "unsigned" or "adhoc" codesignature)
  - If app is translocated or reinstalled, keychain items tied to old path are orphaned (can't be found)
- **Mitigation**: Use `app.getPath('userData')` as stable identifier, or `safeStorage.encryptString()` (writes encrypted blob to disk, keys stored in macOS Login keychain with app bundle ID as identifier). Survives reinstalls if bundle ID stays same.
- **Recommendation**: Store Notion OAuth tokens in SQLite encrypted with `TRANSCRIBER_SECRETS_KEY` (same as provider API keys today). Keychain is bonus but not required.

### arm64 "Damaged App"
- **Rare case**: Unsigned arm64 apps on Monterey+ sometimes trigger **"Transcriber is damaged and can't be opened"** even after "Open Anyway".
- **Cause**: Gatekeeper's strict XProtect remediator quarantines apps with suspicious dylib patterns (libffi, libruby, Python frameworks).
- **Workaround**: Ad-hoc codesign with entitlements (`codesign -s - --entitlements entitlements.plist Transcriber.app`) can pass. Entitlements: `com.apple.security.cs.allow-unsigned-executable-memory` (for V8 JIT), `com.apple.security.cs.disable-library-validation` (if loading unsigned dylibs).
- **Test on Sequoia (15.x)** — Apple tightened Gatekeeper in 2024. If "damaged" errors persist, may need Phase S (Developer ID signature) sooner.

---

## Phase S (Optional — Signing & Notarization, Later)

**When**: Before enterprise demos or if unsigned beta hits Gatekeeper blockers James can't workaround  
**James-Only Steps**:
1. **Apple Developer Program enrollment** ($99/yr, [developer.apple.com/programs](https://developer.apple.com/programs))
2. **Developer ID Application certificate**: Xcode → Preferences → Accounts → Manage Certificates → + → Developer ID Application (or via [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates))
3. **Notarytool auth**: App-specific password (appleid.apple.com → Sign-In and Security → App-Specific Passwords) **or** App Store Connect API key (team-scoped, better for CI). Store in Keychain: `xcrun notarytool store-credentials --apple-id <email> --team-id <TEAM_ID>`
4. **Team ID**: Found at [developer.apple.com/account](https://developer.apple.com/account) (10-char alphanumeric, looks like `AB12CD34EF`)
5. **GitHub Actions secrets** (if automating signing in CI):
   - `APPLE_ID` (email)
   - `APPLE_ID_PASSWORD` (app-specific password)
   - `APPLE_TEAM_ID`
   - `CSC_LINK` (base64-encoded Developer ID .p12 cert)
   - `CSC_KEY_PASSWORD` (passphrase for .p12)
6. **Update feed hosting**: If using Squirrel.Mac / electron-updater, host `latest-mac.yml` + DMG on S3/CDN with HTTPS. Feed URL goes in `electron-builder` `publish` config. **Or** use GitHub Releases (public feed).

**Signing Flow**:
- `electron-builder` auto-signs all Mach-O binaries inside `.app` (nested ffmpeg, yt-dlp if re-packaged as .app, Node, Electron framework) with Developer ID cert.
- **Hardened Runtime** enabled (`hardenedRuntime: true` in `electron-builder`). Required for notarization.
- **Entitlements** (`entitlements.plist`):
  - `com.apple.security.cs.allow-jit` (V8 JIT compilation in Electron/Node)
  - `com.apple.security.cs.allow-unsigned-executable-memory` (if loading Python .so modules)
  - `com.apple.security.network.server` (loopback HTTP server on 19720)
  - `com.apple.security.network.client` (outbound for yt-dlp, Whisper, API calls)
- **Notarization**: `xcrun notarytool submit Transcriber.dmg --wait` (takes 2–10 min). If rejected, check for unsigned dylibs or invalid entitlements.
- **Stapling**: `xcrun stapler staple Transcriber.dmg` (embeds notarization ticket in DMG so it opens offline).

**P2 Tasks (Signing)**:
- Sign nested binaries: `codesign --deep --force --sign "Developer ID Application: James Lastname (TEAM_ID)" /path/to/ffmpeg` (before bundling in `.app`)
- Sign yt-dlp: if Python zipapp, may need to extract, codesign Python shebang interpreter, or accept "unnotarizable" warning (Gatekeeper allows it if top-level app is signed)
- Sign Whisper venv (not practical — skip; venv created post-install, not notarized). **Risk**: If user's system Python or pip downloads unsigned wheels, Gatekeeper may block. **Mitigation**: App creates venv in user's home dir (outside `.app`), avoids translocation issues.

**P3 Tasks (Notarized Auto-Update)**:
- Enable `electron-updater` in Phase P3
- Host `latest-mac.yml` + signed DMG on GitHub Releases (or S3)
- Set `publish: { provider: "github", owner: "lifesized", repo: "youtube-transcriber" }` in `electron-builder` config
- Test full update cycle: bump version, build, upload, older app checks and downloads

**Estimate**: 3–4 engineering days (signing, notarization, CI automation, update feed)

---

## Connectors (Later Phase — Same Beta Scope)

**Feature**: Obsidian (markdown to vault folder) and Notion (OAuth in app, write via API), surfaced as "Save to" chips in web UI and extension

### Architecture
- **Where tokens live**: SQLite `ProviderConfig` table (encrypted with `TRANSCRIBER_SECRETS_KEY` at rest), **not** in macOS Keychain. Reuse existing secrets-at-rest flow.
- **OAuth flow (Notion only)**:
  1. User clicks "Connect Notion" in Settings → opens Notion OAuth URL in default browser
  2. After auth, Notion redirects to `http://127.0.0.1:19720/api/auth/notion/callback?code=...`
  3. Next.js API route exchanges code for access token, writes to SQLite, returns success page
  4. Settings UI polls `/api/settings` to detect new connection (or listens for SSE)
- **No OAuth in extension** — extension sends transcript ID to app via loopback API `/api/destinations/send`, app owns OAuth + token storage

### Extension ↔ App Messaging
- **Loopback API** (not native host):
  - Extension: `POST http://127.0.0.1:19720/api/destinations/send` with `{ destinationId: "notion", transcriptId, folderId? }` (Bearer token via native host)
  - App validates token, fetches Notion token from SQLite, calls Notion API, returns `{ ok: true }`
- **Native host** only for fetching loopback token (existing `getLocalToken` command). No new native-host commands for destinations.

### Obsidian Integration (Reuse Pre-Thin Code)
- **Settings**: Text field for vault name (e.g. "Notes"). No OAuth (local filesystem).
- **Save flow**:
  1. User clicks "Save to Obsidian" chip → app writes markdown to `~/Documents/<vaultName>/Transcripts/<videoId>.md` (or configurable folder)
  2. If vault has Obsidian Advanced URI enabled, open note in Obsidian: `obsidian://open?vault=<vaultName>&file=<path>` (optional toggle in Settings)
- **Markdown format**: Title, URL, timestamp, transcript body with `[MM:SS]` markers

### Notion Integration
- **OAuth**: App-level OAuth (not Workspace or Public integration — easier for beta). Client ID + secret stored in app (not user-configurable for beta; hardcode or env var).
- **Save flow**:
  1. User connects Notion in Settings (OAuth popup)
  2. User picks a Notion database from dropdown (app lists accessible databases via `/v1/search`)
  3. "Save to Notion" chip → app creates new page in database with title, URL, embed, transcript as page content
- **Token storage**: `ProviderConfig` table (new row: `provider="notion"`, `apiKey=<encrypted_access_token>`, `baseUrl` unused, `model=<database_id>`)

### Security Notes
- **Loopback API only**: Extension never sees Notion token. All destination work happens in app backend.
- **Origin check**: `/api/destinations/send` validates `Origin: chrome-extension://<allowed_id>` (same as `/api/transcripts` today)
- **Token rotation**: Notion tokens expire (not refresh tokens in beta). User re-connects if expired. Full OAuth refresh flow optional (adds complexity).

### Tasks (Connectors Phase)
1. DB schema: add `destinations` table or reuse `ProviderConfig` with `provider="notion"`
2. API routes: `/api/destinations/list`, `/api/destinations/send`, `/api/auth/notion/callback`
3. Settings UI: "Connectors" section with Obsidian vault field + Notion OAuth button
4. Obsidian: markdown writer, Advanced URI integration
5. Notion: OAuth popup, database picker, page creation via `/v1/pages`
6. Extension: "Save to" dropdown in kebab menu (fetches `/api/destinations/list` on panel open)
7. Test end-to-end: transcribe → summarize → save to Obsidian + Notion

**Estimate**: 4–5 engineering days (OAuth, UI, API endpoints, markdown/Notion formatting)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Gatekeeper blocks unsigned app on arm64 Sequoia** | Ad-hoc codesign with entitlements (`codesign -s - --entitlements`); test on Sequoia beta. If persistent, escalate Phase S (signing) earlier. |
| **yt-dlp frequent updates (new features, bug fixes)** | Ship current version in DMG; add separate auto-update for yt-dlp only (check GitHub Releases on launch, download to `~/Library/Application Support/Transcriber/bin/yt-dlp`, prefer that over bundled). Or manual: "Check for yt-dlp updates" in Settings. |
| **Whisper model size (large-v3 ~3 GB)** | Default to `base` model (~150 MB). Settings dropdown for model selection (base / small / medium / large). Models downloaded on first use, cached in `~/.cache/whisper/`. Show download progress in transcription UI. |
| **Port 19720 conflict** | Health check detects foreign server → tray icon shows "Port Conflict" error. User can kill conflicting process or change port in Settings (writes to `~/.config/transcriber/port.txt`, app reads on boot). Requires restart. |
| **Multiple Chrome profiles / browsers** | Native host manifest must be installed per browser (Chrome, Brave, Arc, Edge). Settings shows checkboxes: "Install for Chrome / Brave / Arc / Edge". Each writes to its own `NativeMessagingHosts/` dir. |
| **Rosetta (x86 Mac users)** | Build universal binary (arm64+x64) with `electron-builder` target `"dmg"` + `"mas-universal"` (or just `"dmg"` with `arch: ["x64", "arm64"]`). Increases DMG size ~30% but covers Intel Macs. **Or** build arm64-only for beta, add x64 if users report issues. |
| **Loopback server security (no HTTPS)** | Loopback is localhost-only (no network exposure). Origin checks + Bearer token prevent CSRF. **Not a risk** unless user has malware on localhost. Document: "Transcriber binds to 127.0.0.1 only; not accessible from network." |
| **Auto-update signing (unsigned can't auto-update)** | Manual "Check for Updates" flow for unsigned beta. Full Squirrel.Mac auto-update deferred to Phase S. Not a blocker for friends beta. |
| **Extension ID changes between dev and Store** | Native host manifest supports multiple `allowed_origins`. App Settings: "Add Extension ID" field. User pastes Store ID + local unpacked ID. Manifest regenerated on save. |

---

## Open Questions for James

1. **Beta duration**: How long before moving to signed/notarized (Phase S)? If > 3 months, consider signing sooner to avoid Gatekeeper friction.
2. **Obsidian vault default location**: Should we auto-detect Obsidian vaults (scan `~/Documents/`, `~/Library/Mobile Documents/iCloud~md~obsidian/`) or require manual vault name entry?
3. **Notion OAuth app**: Create new Notion integration at [notion.so/my-integrations](https://www.notion.so/my-integrations) or reuse existing? Need Client ID + Secret for app-level OAuth.
4. **Update feed hosting**: GitHub Releases (public, free, easy) or private S3 (costs ~$1/mo, unlisted)? Recommend GitHub for beta.
5. **Universal binary (arm64+x64) or arm64-only**: Most friends likely on Apple Silicon. x64 adds ~30% to DMG. Ship universal or single-arch?
6. **Python venv install timeout**: First-launch pip install takes ~2 min on fast connection, ~5 min on slow. Show progress modal with "Cancel" button (aborts install, user retries later)? Or block launch until complete?
7. **yt-dlp auto-update**: Separate update channel (check GitHub on launch) or bundle static version + manual "Update yt-dlp" button in Settings?

---

**Next Steps**:
1. James confirms open questions + beta timeline
2. P0 (shell + server + tray) starts: scaffold Electron, bundle Next.js standalone, subprocess lifecycle
3. Test unsigned app on fresh Sequoia install (verify Gatekeeper "Open Anyway" flow)
4. P1–P4 sequentially; friends beta ships after P4 (~2 weeks at 1 engineer full-time, or ~4 weeks part-time)
5. Phase S (signing) scheduled based on beta feedback + Gatekeeper friction reports
