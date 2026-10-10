# Changelog

## 2026-10-10

### Fixed
- **Extension messaging lastError (1.6.39)** — content-script `sendMessage`, the side-panel port, and native-host `postMessage` read `chrome.runtime.lastError`. A closed side panel or a content script that is not injected yet is quiet. The caption fast-path inject/retry log is `console.debug`.
- **Hung / busy dev server (1.6.39)** — every health check has a 3s timeout. Native-host Start tells apart nothing listening, listening-but-hung, and healthy. A hung listener is killed only when recorded pid + `ps` start time + exe/cmdline match this repo's `next dev`. Anything else returns `Port 19720 is busy/stuck (pid X)` with no kill. A healthy launchd `com.transcribed.devserver` is left alone. `Starting…` is capped at 30s.
- **Detached native-host Start (1.6.39)** — `npm run dev` is `detached: true` + `unref` (own process group), stdio to a `0600` `dev-server.log`, and pid/startTime/exe are recorded for the hung-server check.

## 2026-10-09

### Security
- **Signing keychain re-unlocks before DMG codesign** — `notarytool --wait` can exceed 15 minutes, so the sign job unlocks the temporary keychain immediately before `macos-codesign-dmg.sh` and uses `-lut 3600` as a backstop. The `keychain.password` file is deleted after that unlock.
- **Quit-and-install stops Tusk without blocking install** — Restart to Update still calls `tuskManager.stop()`, but a throw or ~5s hang cannot skip Next stop or the install. `installingUpdate` is set only at install time so a failed hook still lets a normal Quit tear down Tusk and the server.
- **Sign job requires the SHA on beta** — the same `git merge-base --is-ancestor` check as the release job.
- **Tusk M-1 posting** — Progress `postOrUpdate` sends the bot token. Slack `ok: false` on HTTP 200 throws in `postMessage`, `updateMessage`, and `uploadThreadFile`, so a missing `ts` cannot be handed to `chat.update`.
- **Tusk M-2 markup** — Video titles in the transcript `initial_comment` and failure `detail` are passed through `escapeSlackMrkdwn`, so `<!channel>`, `<@U…>`, and `<https://evil|Click>` stay literal.
- **Tusk M-3 Q&A** — `/api/summaries` passes `promptOverride` on every path. A thread question is never written or read back as the video’s cached summary.
- **Tusk L-4 docs** — README, manifests, setup, and the extension privacy policy say summaries and transcript files are visible to everyone in an allowlisted channel (including Slack Connect if listed) and that questions and transcripts go to the configured LLM provider.
- **Tusk L-1 confirm** — One native confirm at a time (409 while a dialog is open). After Change, the store is re-read and the patch is applied to that fresh state. Allowlist adds and enabling Tusk also confirm. The dialog shows team ID, `auth.test` URL, and current pin vs new pin. `app.focus({ steal: true })` plus a parent window when one exists. `tusk-set` IPC waits 15 minutes; a timed-out request sends a cancel and never writes.
- **Tusk L-2 sources** — Slack jobs skip LinkedIn, Spotify, `client_panel_scrape`, and any non-YouTube library entry so signed-in captures are not posted to a channel.
- **Tusk L-3 caps** — 20 LLM calls per hour and 80 per day. The job queue is bounded. The 180s duration cap aborts the client and `POST /api/jobs/cancel`, which aborts in-flight LLM fetches and SIGTERMs live Whisper/yt-dlp children.
- **Tusk info hardening** — Bullet lists are escaped once. File uploads use `redirect: "error"` and refuse `upload_url` values with userinfo or any port. Prompts wrap question and transcript in data delimiters. `is_ext_shared_channel` is denied unless the channel is allowlisted. An empty `Authorization` header is rejected on Settings writes.

### Changed
- **James docs name the two self-review settings separately** — Environment `release` → Prevent self-review stays OFF; the `beta/electron-menubar` branch rule “Require approval from someone other than the last pusher” stays OFF. Those repo settings are required before setting `SIGNING_ENABLED`.

### Added
- **Tusk M4 watchlist digest** — Settings › Slack (Tusk) accepts YouTube channel / playlist IDs or `videos.xml` URLs and a digest channel. Tusk polls the public Atom feed (ETag / If-Modified-Since), stores seen video IDs on disk (`0600`), and posts one escaped digest to that allowlisted channel. First poll seeds history. Signed-in library captures are skipped.

## 2026-10-08

### Added
- **Tusk v0 (milestones 1–3)** — a Slack Socket Mode bot inside the Electron menu-bar app. James pastes `xoxb` / `xapp` tokens in Settings › Slack (Tusk); they are encrypted with `safeStorage` and the page only shows `saved ••••last4`. Tray line: `Tusk: connected to <workspace>` / `off` / `error` (Design placeholders). `/tusk help`, `/tusk status`, a 👀 reaction plus a threaded summary (or transcript file) on a supported YouTube / Spotify episode / LinkedIn URL, and `@Tusk <question>` in that thread answering only from that video. No public endpoint. Manifest and setup: `docs/tusk/`.

### Security
- **Sign executes nothing from the build artifact** — fuse check is a dependency-free sentinel reader; DMG/zip use `hdiutil` / `ditto` / `codesign`. The `.p12` is deleted after `security import -x`, the `.p8` after the last notarytool call, the keychain is locked after codesign and deleted in `always()` teardown, and `set-keychain-settings -lut` is 900s.
- **Sign and release stay off until James is ready** — both jobs require `vars.SIGNING_ENABLED == 'true'` and a `v*-beta.*` tag or `workflow_dispatch` from `beta/electron-menubar`. Plain beta pushes stay unsigned. Create the protected `release` environment first, then set the variable, then push the first tag.
- **Beta clients follow the beta channel only** — `channel` is set first, then `allowDowngrade = false`. A future plain `vX.Y.Z` is rejected.
- **Packaged electron-updater is required from `app.asar.unpacked`** — CI asserts every `UPDATER_MODULES` entry, `require.resolve`, and `ELECTRON_RUN_AS_NODE` load from the packaged binary.
- **Native host Team ID comes from the host bundle** — a signed host no longer fail-opens when the candidate lacks `signing-identity.json`. Ad-hoc hosts keep the bundle-id-only check.
- **Apple secrets moved to Environment `release`** — signing and publishing are separate jobs with `environment: release` and `if: github.event_name != 'pull_request'`. The sign job does not run `npm ci`. Same-repo PRs no longer see Apple secrets and never produce a signed artifact. See `docs/signing-and-updates.md`.
- **Draft, ref-gated releases** — the release job requires `$GITHUB_SHA` to be an ancestor of `beta/electron-menubar`, the tag to equal `v${package.json.version}` under `X.Y.Z-beta.N`, and creates a **draft** prerelease targeted at that SHA. `workflow_dispatch` publish is allowed only on `beta/electron-menubar`.
- **Updater load failure cannot kill the tray** — `electron-updater` ships in `app.asar.unpacked`; a failed require or settings call returns `{enabled:false, reason:'load-failed'}`.

### Changed
- **Beta version scheme** — app releases use semver prereleases (`0.2.0-beta.1`, tag `v0.2.0-beta.1`, electron-updater channel `beta`) so a non-app GitHub Release cannot stall updates.
- **Library indicator** — the panel header shows a status dot plus **App · 19721** or **Dev · 19720**. It is read-only: a click opens Settings › Library, with no menu or chevron. Tooltip: "Library: Transcriber app · 19721, Running. Click to change in Settings."
- **Settings › Library radio rows** — **Transcriber app · 19721** and **Dev server · 19720** are stacked radio rows. Only the selected row shows its action: **Start** (app stopped), **Retry** (dev stopped), **Allow access** (app needs permission), the setup command with **Copy** (dev needs permission), **Update helper** (the tray item for the app, the setup command for dev, and a dev 401). The Server section stays hidden while Stop is off, so Settings has one Start.
- **Amber setup states** — Needs permission, Helper out of date and the dev project-folder message are amber. Stopped is muted. Red is only for a Start that failed.
- **Tray status and order** — The status line always shows **Transcriber is running** or **Transcriber is stopped**, with **App library · Port 19721** under it (one line before macOS 14.4). Stopped adds **Start Transcriber**. Order: Open Transcriber, Open Library, then Connect Browser Extension… / Paired Extensions… / Reinstall Browser Connection, then Advanced ▸ Show Data in Finder (plus Import Existing Library… when offered), Start at Login, Quit Transcriber. **Open Library** opens the list view (`/?layout=list`) and is disabled while stopped.
- **Launch pop only for a manual launch** — the menu pop and "running in the menu bar" notification are skipped for Start at Login and for starts from the browser extension (the native host launches the app with `--launched-by=native-host`). A manual launch, including the first after install or update, still pops.
- **DMG hides the app in `.payload/`** — `finalize-dmg.sh` moves `Transcriber.app` into a dot-folder Finder never shows, instead of parking it off-canvas. Install Transcriber.command copies from `.payload/Transcriber.app` and falls back to `Transcriber.app` beside it.
- **Final picker and tray strings** — Design's copy for the Library label, helper line, connection errors and tray status.
- **Dev 401 asks for a helper update** — the extension sends tokens only, so opening the dev server in the browser no longer helps. The message is now "The dev server's browser helper needs an update. Copy the setup command from Settings › Library, run it in your Transcriber folder, then try again.", amber, with **Update helper** and the setup command on the Dev row.

### Removed
- **Open Library Folder** and the separate **Serving: …** tray line, replaced by Advanced ▸ Show Data in Finder and the status sublabel.

### Added
- **Developer ID signing, notarization, and updates (secret-gated)** — when `MACOS_CERT_P12_BASE64` is set, CI copies the ad-hoc app, signs it inside-out with hardened runtime, notarizes (App Store Connect API key, Apple ID fallback), staples, and writes a drag-to-Applications DMG plus `latest-mac.yml` / zip / blockmap. Without those secrets the job is the same ad-hoc DMG as today (`Install Transcriber.command`, `.payload/`, artifact `Transcriber-macOS-arm64`). A `beta-v*` tag (or dispatch with publish checked) publishes a GitHub prerelease via `GITHUB_TOKEN`. The in-app updater stays off for ad-hoc, unsigned, and `electron:dev`. Tray placeholder: **Check for Updates…**. See `docs/signing-and-updates.md`.
- **Design screenshots in CI** — the macOS job uploads `design-screenshots`: the real tray menu (best effort), every Settings › Library state rendered by `popup.js` (`scripts/capture-library-rows.js`), and the DMG window.

### Security
- **Packaged app update check** — a Developer ID–signed build may call GitHub Releases for `lifesized/youtube-transcriber` only. Documented in `extension/privacy-policy.md`. Privacy policy and store justifications now mention both `127.0.0.1:19721` (packaged) and `127.0.0.1:19720` (checkout).
- **Native-host log rotation keeps the `.1` private** — `rotateLogIfFull` chmods the live `native-host.log` to 0600 before rename and the `.1` after, so a leftover 0644 file does not stay world-readable as the archive.
- **Packaged frame-header CI is stale-proof** — each curl writes a fresh header file, fails on unexpected HTTP status, and also checks unauthenticated `/api/health` (401, one CSP + one XFO) and a bad `Host` (421).
- **Tusk M1 review (T1/T2/Lows)** — Socket Mode is single-flight with a generation counter; only the current socket reschedules, with jitter and Retry-After; `invalid_auth` / `token_revoked` / `account_inactive` / `link_disabled` stop permanently and leave the tray in error. Socket URLs must be `wss:` on `*.slack.com`. Tusk settings PUT accepts only the Settings page (port-scoped cookie and `Sec-Fetch-Site: same-origin`); extension / MCP / native-host Bearer callers get 401. Team pin comes from `auth.test` before any event; a different workspace needs **Reset workspace**. Empty allowlist is public channels Tusk is in, not allow-all. Per-user and global rate limits cover slash commands. Slack links use only the `<target|label>` target, decode `&amp;` last, and rebuild canonical URLs. Slack Connect externals are ignored.
- **Tusk L-A1 empty allowlist denies all** — An empty channel allowlist denies every conversation, including public `C…` ids. Missing `channel_type` is unknown (not inferred public from the id). Slash commands also use `channel_name` to deny `privategroup`, `directmessage`, and `mpdm-*` unless that channel ID is on the list.
- **Tusk L-A4 settings writes** — The Tusk settings route rejects any request that carries an `Authorization` header. Changing Slack tokens or resetting the workspace pin shows a native confirmation dialog (Cancel is the default); cancel returns 409 and writes nothing.
- **Tusk L-A2 Retry-After clamp** — Socket Mode reconnect delay is `max(backoff, min(Retry-After, 300000))` ms.
- **Tusk L-A3 link_disabled** — A Socket Mode disconnect with reason `link_disabled` calls `stopPermanently` instead of reconnecting every 30s.
- **Tusk rate-limit order** — `allowAll` checks the per-user bucket before taking from the global one, so a user who is already limited does not drain the shared budget.
- **Tusk M2/M3 posting** — Titles and model output are escaped (`&`, `<`, `>`) before Slack. The model is never asked for `<url|label>`; Tusk builds every link. File uploads refuse any `upload_url` that is not `https://files.slack.com/...`. Local calls are only transcribe and summarize with the rebuilt URL. Replies stay in the source channel and thread. `@Tusk` Q&A uses only that thread’s cached transcript id.
- **Pages cannot be framed** — Every HTML/document response from the local app (Dev 19720 and App 19721 share `next.config.ts`) sends `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`. Nothing in the app or extension iframes those pages; the side panel talks to the API with `fetch`. Packaged-app CI curls `/`, the Library tab, `/settings`, and a 404.
- **Native-host log is private and capped** — `native-host.log` is created 0600 (an existing one is chmodded on write) and rotates at 5 MB, keeping one `native-host.log.1`.
- **Tray errors go through app-log** — tray `_logError` writes one rotated `main.log` line via `app-log.error` and does not append the file itself.
- **No tokenless no-auth fallback** — The extension and native host no longer call the local API without a Bearer token. A missing or stale helper is an error (`unknown_cmd` / `no_token`); a 401 still shows the Dev helper-update message. Page routes on 19720 stay token-optional in middleware so the Dev UI still loads.
- **LinkedIn media URLs reach yt-dlp exactly as validated** — The server and the extension accept a LinkedIn media URL only if it equals `new URL(url).href`, and pass on only that href. Before this, `https://dms.licdn.com\@127.0.0.1:8443/x.mp4` passed the `*.licdn.com` check (Node reads the host as `dms.licdn.com`) but yt-dlp connected to `127.0.0.1:8443`. Backslashes, surrounding spaces, and look-alike characters such as `。` or `ⅼ` are rejected too. Both yt-dlp calls (info and download) now put `--` before the URL.
- **LinkedIn page URLs are strict and stored canonically** — A LinkedIn page URL must be `https://` on `www.linkedin.com` or `linkedin.com` with no port and no username or password; anything else (e.g. `javascript://www.linkedin.com/…`) is not treated as LinkedIn. The library stores a URL rebuilt from the post or event ID (`https://www.linkedin.com/feed/update/urn:li:<type>:<id>/` or `https://www.linkedin.com/events/<id>/`), not the pasted text. yt-dlp gets the parsed URL, never the raw input.
- **LinkedIn build guard** — The LinkedIn build test also forbids `document.cookie`, `localStorage`, `sessionStorage`, `indexedDB`, `innerHTML`, `eval` and `world: "MAIN"` in the LinkedIn scripts, and fails if any content script runs in the page's MAIN world.
- **LinkedIn disclosures** — The store justification says the content script observes LinkedIn video URLs the tab loads, in memory only, and sends one only when you press Transcribe. The privacy policy lists `127.0.0.1:19721` and says the app fetches the public post page itself for pasted or queued posts.
- **Port-scoped token cookie** — The web UI cookie is now `transcriber_local_token_<PORT>` (`_19721` for the app, `_19720` for the dev server). Cookies are per host, not per port, so before this the two servers overwrote one shared cookie and each accepted it. Neither server accepts the other's cookie now, and the old unsuffixed `transcriber_local_token` is ignored (not cleared, so a dev server still on `main` keeps working). Cookie auth on `/api/*` needs `Sec-Fetch-Site: same-origin` or `none`; `same-site` (the other port), `cross-site` and a missing header get 401. Bearer is unchanged. Page routes mint the cookie (HttpOnly, SameSite=Strict) on same-origin loads and on top-level document navigations from anywhere, so a Library tab the extension or tray opens (`/?layout=list&id=…`) loads on the first try. `/api/*`, cross-site subresources, iframes and fetches never get it. CI opens a Library tab on the packaged app and checks each case.
- **Dev fallback sends no cookies** — The extension's tokenless Dev request no longer uses `credentials: "include"`. A protocol-2 Dev host's `getLocalToken` is still tried first; the tokenless fallback only works against a dev server without auth. A 401 still shows the Dev auth message.
- **LinkedIn page send follows the same rule** — Without a token, a LinkedIn post or event is sent tokenless only when the target is the dev server; any other target is refused instead of quietly posting to 19720. It uses the `getLocalToken` token when there is one and never sends cookies.
- **No raw native-host pass-through** — The unused `CALL_NATIVE_HOST` background message is gone. Any extension context, including content scripts on YouTube and LLM sites, could use it to call `getLocalToken`, `start` or `stop`, bypassing `FEATURES.stop=false`.
- **App log is private and capped** — `main.log` is created 0600 (an existing one is chmodded when the log opens) and rotates at 5 MB, keeping one `main.log.1`.
- **Fuses checked on the shipped app** — CI also reads the fuses from `Transcriber.app` inside the mounted final DMG and requires its CDHash to match the `dist-electron` app the other steps check.
- **Loopback Host pin** — Requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` (port from `PORT`, default 19720) return 421. The local-token cookie is minted only when `Sec-Fetch-Site` is `none` or `same-origin`.
- **Pairing opt-in** — Tray **Connect browser extension…** opens a 2-minute window. Outside it, `/api/native-host/pair` returns 403 and no dialog is shown. Origin must match `^chrome-extension://[a-p]{32}$`. Deny is a global cooldown; main never stacks a second dialog and caps about 3 dialogs per hour.
- **Unpair** — Tray **Paired extensions…** lists paired IDs. Removing one rewrites native-host manifests, rotates the local API token, kills native-host processes whose command line contains the exact host script path, and restarts the server. `getLocalToken` requires `argv[1]` to be a paired `chrome-extension://<id>/`.
- **Pairing window closes on Allow** — main sets `openUntil` to 0 and sends that close over IPC so a second extension cannot get a dialog for the rest of the 2 minutes.
- **Secrets over IPC** — The packaged server no longer inherits LLM/Notion keys via `secretEnv` at spawn. In Electron they are fetched from main over IPC, so a key cleared in Settings stops working immediately.
- **Electron fuses** — afterPack turns off `EnableNodeOptionsEnvironmentVariable` and `EnableNodeCliInspectArguments`, keeps `RunAsNode` on.
- **Native-host hardening** — Wrapper paths are single-quoted; Electron PATH is exactly Resources/bin, /usr/bin, /bin; stdin messages capped at 1 MiB. `extension-ids.json` and the secrets file are written atomically (mode 0600). Corrupt JSON is refused on append. Masked key detection is exact equality with the GET placeholder.
- **App Start is a fixed action** — the app host's `start` ignores the payload and runs only `/usr/bin/open -a <bundle>`. The bundle is the recorded install (derived from the host's own `Contents/MacOS` path) or `/Applications/Transcriber.app`, and its `Info.plist` must say `CFBundleIdentifier` `com.transcribed.app`. Paths under `/Volumes/` or AppTranslocation are skipped. Otherwise Start refuses with `app_not_found`.
- **Stop is off by default** — the extension hides Stop behind `ConnectTarget.FEATURES.stop` (false). The dev host only signals the process group it started; the app host returns `stop_unsupported`.
- **Dev tokenless fallback** — Dev server only: when the host has no `getLocalToken` (`unknown_cmd`) or no token (`no_token`), the extension calls `127.0.0.1:19720` with no `Authorization` header (the browser's own dev-UI cookie may ride along). A 401 shows an auth message. The app target always needs the token. Requests outside the selected target's loopback origin throw.
- **Status and Recent are authenticated** — `CHECK_SERVICE`, Recent, and duplicate checks now send the token; `GET_TRANSCRIPT` validates and encodes the ID.

### Fixed
- **Install helper finds an app path with double spaces** — `pids_matching_exe` strips the PID with `sub()` instead of assigning `$1`, which made awk collapse runs of spaces, so the running app was never matched. CI sources the helper and calls the same function instead of an inlined awk copy.
- **Library opens for transcripts made outside this browser** — The home page no longer hides the Library behind the `hasCreatedTranscript` localStorage flag. It waits for the first `GET /api/transcripts` (showing the existing spinner, never the paste screen) and shows the Library when there is at least one row or the `?id=` transcript loads, then sets the flag. Links from the extension's Recent list (`/?layout=list&id=<id>`) now open that transcript's drawer in list view on a browser that never transcribed from the web page. An empty library with no `?id` still gets the first-time paste screen; an unknown or malformed `?id` falls back to the paste screen (empty library) or the Library (rows present).
- **App library gets the settings tables** — Migration `20261008193000_add_settings_usage_waitlist_tables` creates `Setting`, `ProviderConfig`, `DailyUsage` and `WaitlistSignup` with their unique indexes (`DailyUsage(date, provider)`, `WaitlistSignup(email)`). Before this, only `prisma db push` made them, so in the packaged app every audio-path transcription (LinkedIn, YouTube without captions) failed and the boot secrets check logged a missing-table error. The app applies it on the next launch with no user action; it only adds tables and indexes (`IF NOT EXISTS`), so existing rows and dev databases that already have the tables are untouched. `Video.source` and `Video.platform` stay nullable in migrated databases (the schema says NOT NULL); changing that would need a table rebuild.
- **Dev native host Start uses the recorded project root** — `npm run install-native-host -- --project-root=<abs-path>` records the checkout in `native-host.json` (0600) in `~/Library/Application Support/Transcriber/`; `--clear-project-root` removes it. The host script can live in another checkout (e.g. a beta worktree) and Start still runs `npm run dev` from the recorded root. Start refuses with `bad_project_root` when the root is unset, empty, missing, or lacks a `youtube-transcriber` `package.json`, a `dev` script, `node_modules`, or a generated Prisma client; it never falls back to the host's own folder. A plain install records its own checkout only when nothing is recorded. Unknown installer flags now error instead of being ignored. The app host (`com.transcribed.app.host`) is unaffected.
- **Dev native host allowlist is written by the installer** — `--ext-id=<id>` validates the ID (32 letters a–p) and creates or merges `Transcriber/extension-ids.json` (atomic, 0600, never drops existing entries) alongside the manifest's `allowed_origins`, so `getLocalToken` works without hand-editing the file. `--remove --ext-id=<id>` takes one ID out of both. When the host refuses a token because the ID isn't allowlisted it returns `extension_not_allowed` instead of `unauthorized_caller`. The app installer defaults to `Transcriber App/` and refuses to write its allowlist inside the checkout's `Transcriber/`.
- **Second launch no longer looks dead** — A relaunch of the LSUIElement menu-bar app still exits the second process after the single-instance handoff, but the primary pops the tray menu and shows a Notification: “Transcriber is running in the menu bar”. `activate` and first launch do the same, so a notch-clipped icon still has visible feedback.
- **Invisible tray after relaunch** — Packaged tray templates are loaded with `nativeImage.createFromBuffer` from `app.asar.unpacked` (not `createFromPath` on an asar path, which returns an empty image). Size and alpha are logged at startup. If the image is empty, zero-size, or fully transparent, the status item falls back to a visible title `Transcriber`. A module-level `retainedTray` pin keeps the `Tray` from being GC’d. State changes only call `setImage` on the existing item — they never `destroy()` it. Zero `getBounds()` is treated as notch/overflow clip, not a dead tray. CI decodes the six packaged PNGs and requires 16/18×16/18 or 32/36×32/36 plus non-zero alpha.
- **Ad-hoc codesign seal** — afterPack used to sign the `.app` and then re-sign ffmpeg/yt-dlp, which broke `codesign --verify --deep --strict`. Nested binaries are signed first; `afterSign` is the last step that touches the `.app` (`codesign --force --deep --sign -`). DMG finalize hides `Transcriber.app` then strips wrapper FinderInfo (`chflags` writes it; `--strict` rejects it) and never writes into `Contents/`. CI verifies the mounted final DMG with `--strict` and fails if FinderInfo is back. The icon stays off-canvas at y=560; UF_HIDDEN may not survive UDZO without FinderInfo.
- **Packaged file logs** — main-process `console.*` is teed to `~/Library/Logs/Transcriber App/main.log`, which is created on startup. CI asserts the file exists after launch.
- **LOCAL extension never falls through to cloud Sign-in** — If the app (19721) or dev server (19720) is unreachable, unauthorized, or unpaired, the side panel stays on the friendly offline screens (`Transcriber isn't running` / `Allow Transcriber to connect`). Leftover `mode: "cloud"` from a dual-mode install, a failed `GET_SETTINGS`, or a `CHECK_SERVICE` payload cannot show Google / magic-link auth or open `transcribed.dev`. Dead cloud handlers (`sendMagicLink`, `OPEN_GOOGLE_SIGNIN` / `SEND_MAGIC_LINK`) are removed. LOCAL `short_name` is `Transcriber`; the dev build tags `Transcriber (dev)`.
- **Gold Save hover** — Settings → Summaries Save no longer uses `hover:bg-white/[0.04]`, which wiped the accent fill.
- **Start shows real progress** — Start in the panel and Settings shows **Starting…**, polls health for about 20 seconds, then shows Running or a human failure (port in use, app not found, project root, timed out). No more fire-and-forget.
- **Human errors for host and auth problems** — `unknown_cmd`, `no_token`, `host_not_found`, `bad_project_root`, `unauthorized`, `unreachable`, and `extension_not_allowed` each map to their own message per target (dev `extension_not_allowed`: “This extension isn't paired with the dev server. Re-run setup.”). The generic “Transcription failed” is only for other errors. All copy is in `ConnectTarget.STRINGS`.
- **Stale helper detected up front** — native host `ping` / `version` return `protocol: 2`, the supported commands, and `target`. An older host shows **Helper out of date** instead of failing later.
- **Launch tray menu no longer delays ready** — the first-launch menu pop runs after the server-status listener is attached, so status changes are not missed while the menu is open.

### Added
- **Install Transcriber.command Finder icon** — the DMG helper uses Design's `electron/dmg/install-helper.icns`. `electron/dmg/finalize-dmg.sh` (run from `electron:build`) stamps the icns into the helper's resource fork, hides the `.command` extension (`SetFile -a E` / `NSFileExtensionHidden`), hides `Transcriber.app`, and drops any `/Applications` link. CI mounts the final DMG and checks the custom-icon flag, a non-empty resource fork, the hidden-extension flag, the hidden app, and no Applications symlink.
- **LinkedIn posts and events** — Transcribe a LinkedIn video post (`/posts/…`, `/feed/update/urn:li:activity:…`, a playing video in the feed or a profile/company activity list) or a past LinkedIn Event (`/events/<slug>-<id>/`). Library IDs are `linkedin:<activityId>` and `linkedin:event-<eventId>`, so the cache and dedupe treat different URLs for the same post or event as one entry. The LOCAL extension reads the video's LinkedIn CDN address from your signed-in tab and sends it to the local app, which downloads it with yt-dlp. No LinkedIn cookies or credentials are read or stored. Upcoming, still-live, no-recording, expired-link, and sign-in-only videos get a plain message telling you what to do instead of a generic failure.
- **Friends-beta P0 visuals** — Design's Oct 8 review: friendly extension first screens, Transcriber app icon, hidden Dock (`LSUIElement` + `app.dock.hide()`), per-state tray template icons, a light-warm DMG background with an arrow to Applications, and human tray status copy (`Transcriber is running` / `Starting…` / `Port {port} is in use` / `Transcriber stopped unexpectedly`) with **Try Again** / **Restart Transcriber**. Raw exceptions go to the app log, not the menu. CI checks Info.plist `LSUIElement`, the packaged icon, and all six tray template PNGs.
- **Flip-ready product defaults** — `electron/product-defaults.js` holds one constant each for: no auto-save after Transcribe, Obsidian writes Markdown into the vault, re-save updates the same note, port conflict names the holder and does not offer to quit it, the dark app icon, and Import Existing Library… only when a checkout library is detected.
- **Library picker** — the panel header and Settings › Connect to list **Transcriber app · 19721** and **Dev server · 19720** (ports from config), each with a live status dot: Running / Stopped / Needs permission / Helper out of date. Switching clears the cached token and Recent, re-pairs, and refreshes the list. It never auto-switches.
- **Tray shows the served library** — a read-only **Serving: Transcriber app library · 19721** line while running, plus **Open Library Folder** (`~/Library/Application Support/Transcriber App/`).

### Changed
- **LOCAL extension asks for `https://www.linkedin.com/*`** — New required host permission plus a content script on `www.linkedin.com` only. An unpacked extension picks it up on reload; a Web Store update stays disabled until you accept the new permission. Store justification and privacy policy updated.
- **Tray menu casing and grouping** — Title case: Connect Browser Extension…, Paired Extensions…, Import Existing Library…. Start at Login sits in its own group above Quit. Quit has ⌘Q. Connect / Paired / Import are disabled while the server is not running. A translocated launch shows **Move to Applications and Reopen**. Left-click on the macOS tray icon no longer opens the browser.
- **Extension first screen** — Offline no longer auto-opens Settings or the npm setup box. App target: **Transcriber isn't running** + Start, or **Open Transcriber from your Applications folder** + Check Again, or **Allow Transcriber to connect** while pairing. Dev server still sees **Dev server setup**. Auth: **Reconnect to Transcriber**. Footer GitHub link is hidden. A `Connected to: … · Change` line opens Settings › Connect to.
- **DMG window** — Design's 660×420 landing (1x + @2x). Header: “Double-click the installer. It copies Transcriber to Applications and opens it.” Footer: macOS 15 first-open steps (Close the warning → Open Anyway → double-click again). Installer icon at (330, 200), size 128. `Transcriber.app` is parked off-canvas at (330, 560) and hidden. No `/Applications` link and no drag arrow.
- **Packaged app ~510 MB / DMG ~227 MB** — Next standalone is the only server tree; asar/unpacked keep Electron main deps (`better-sqlite3` + bindings). Prisma ships the wasm compiler, not native engines. Unused `@img/sharp`, extra locales, maps, `.d.ts`, READMEs, tests, and docs are pruned. CI fails if the `.app` exceeds 576 MiB or the DMG exceeds 256 MiB, and prints a per-directory size table. Baseline at fb85bea was ~1.1G `.app` / ~393 MB DMG.
- **Beta app runs beside `npm run dev`** — packaged server listens on **19721** (`electron/config.js`; change that one value to revert to 19720). Checkout stays on 19720. Native host is `com.transcribed.app.host` with its own wrapper, `extension-ids.json`, token, DB, secrets, backups, and logs under `~/Library/Application Support/Transcriber App/` and `~/Library/Logs/Transcriber App/` — never the checkout's `~/Library/Application Support/Transcriber/` or `~/Library/Logs/Transcriber/`. Electron `userData` / `logs` / `crashDumps` are pinned before ready so productName `Transcriber` cannot share James's checkout state. App NMH manifest is `com.transcribed.app.host.json`; the installer refuses to write or unlink `com.transcribed.host.json`.
- **Smaller friends DMG** — keep darwin-arm64 Prisma engines only, drop `.next/cache` and `*.map`, keep Electron `en` locale, and stop packing unused `@prisma` into asar. CI prints `.app` / DMG sizes and uploads the DMG file itself (`compression-level: 0`), not a zip of the unpacked `mac-arm64` folder. Previous unpruned artifact was ~459 MB.
- **Pinned ffmpeg 9.0.2** — CI downloads a specific Martin Riedl macOS arm64 zip (`electron/ffmpeg.lock.json`) and fails if the SHA-256 does not match. Packaged `ffmpeg -version` plus a 1-second sine encode, and `yt-dlp --version`, must exit 0. The lock records provenance: single-maintainer Martin Riedl build, re-signed ad-hoc in afterPack.
- **Pinned yt-dlp 2026.08.19** — CI downloads `yt-dlp_macos` from that release (`electron/yt-dlp.lock.json`), checks SHA-256 against the lock and against yt-dlp's `SHA2-256SUMS`, and fails on mismatch. `curl --fail` with `set -o pipefail`.

### Added
- **Connect to** — LOCAL extension Settings has a two-option segmented control: **Transcriber app** (default, `127.0.0.1:19721`) then **Dev server** (`127.0.0.1:19720`). Helper: “Use Dev server only if you run Transcriber from a code checkout.” Unreachable: “Transcriber app isn't running.” (reuses Start Transcriber) or “Can't reach your dev server. Start it, then try again.” with **Retry**. Choice persists in `chrome.storage.local` and does not auto-switch.
- **Import existing library…** — Tray item opens a `.db` file read-only, confirms `Import N transcripts? Your current library will be backed up first.`, online-backups the app DB to `~/Library/Application Support/Transcriber App/backups/<timestamp>.db`, copies the source with `.backup()` to a temp file, migrates that copy (extra `_prisma_migrations` / indexes are tolerated), and merges Video rows in one transaction. Dedupes on `(videoId, captionLanguage, pipelineVersion)` with old rows as `en`/1; existing rows win. Any error rolls back; the source file is never modified.
- **Install Transcriber.command** — the DMG includes a helper that copies Transcriber to `/Applications`, clears `com.apple.quarantine`, and opens the app. Source/dest basename must be `Transcriber.app`; an existing dest is replaced only when `CFBundleIdentifier` is `com.transcribed.app`; quit targets that bundle executable. First launch of the helper: System Settings → Privacy & Security → **Open Anyway** (macOS 15 dropped right-click → Open). Docs ask friends to `shasum -a 256` the DMG against a hash James sends separately. Docs: `docs/beta-install-macos.md`.

### Fixed
- **Install helper process match** — quit uses `ps -axo pid=,args=` with an exact executable-path prefix, space-safe awk. Darwin `comm=` is not a reliable full path.
- **Import backups 0600** — create the backup with `wx` mode 0600 instead of a process-wide umask, then SQLite-backup into that file.
- **Packaged launch power-save id** — `powerSaveBlocker.isStarted(null)` threw on first ready (`conversion failure from null`), so the Next server never started and CI waited 60s for `/api/health`. Guard the id the same way `will-quit` already did; CI now fails immediately on `UnhandledPromiseRejectionWarning` too.
- **Packaged require gate reads asar `package.json`** — the walker now extracts `package.json` from `app.asar` so packages whose `main` is not `index.js` resolve (`better-sqlite3` → `lib/index.js`, `bindings` → `bindings.js`). The previous path treated asar file lists as a Map, defaulted to `index.js`, and failed the CI gate after Import existing library started requiring `better-sqlite3`.
- **CI Node 22 for `npx asar`** — `@electron/asar` 4.x requires Node >=22.12, so the macOS DMG job uses Node 22. Node 20 failed the packaged-require gate with `CANNOT RUN WITH NODE 20`. afterPack replaces the extraResources standalone tree instead of merging with `cpSync({ dereference: true })`, which Node 22 rejects when dest already has a symlink to the same path.
- **Native-host wrapper path** — Packaged host script is `Contents/Resources/app.asar.unpacked/tools/...` (not `Resources/app/tools`). `start` in Electron mode launches the app with `open -b com.transcribed.app`. Spawned children have an `error` handler. CI `ls`s the wrapper target and sends a framed `ping`.
- **CI workflow** — Job uses `permissions: contents: read` and prints the DMG SHA-256 in the job summary.
- **Packaged main-process modules** — `lib/*.js` is inside `app.asar` so Electron can `require('../lib/local-api-token.js')`. CI lists the asar, resolves every `require()` from `electron/main.js`, and launches `Transcriber.app` until `/api/health` returns 200.
- **Pairing dialog** — Focuses the menu-bar app (`app.focus({ steal: true })`) before the confirm box, shows the extension ID in `detail`, and warns when the ID is not a known Chrome Web Store listing. A dialog timeout marks the request expired so a late Allow does not write the ID.
- **Native-host PATH** — The Electron-installed wrapper no longer prepends `/opt/homebrew/bin` or `/usr/local/bin`. Those prefixes stay only for the dev/non-Electron host.
- **Packaged `@prisma/client`** — electron-builder extraResources skips a source-root `node_modules`, so afterPack now copies the staging standalone tree (including Prisma) into the `.app` before the payload check.
- **CI packaged-server launch path** — the smoke test `cd`s into standalone, so `APP_PATH` is now absolute (`$PWD/...`) instead of `dist-electron/...`.
- **Electron-ABI better-sqlite3** — Next standalone keeps a hashed Node-20 copy under `.next/node_modules/better-sqlite3-*`. afterPack now overlays the Electron-rebuilt `better_sqlite3.node` onto every copy in the packaged tree.
- **Flatten hashed sqlite symlink dirs** — those `.next/node_modules/better-sqlite3-*` entries can be symlink directories (`Dirent.isDirectory()` is false), so the overlay walk skipped them and the packaged server loaded the workspace Node ABI 127 build. afterPack now replaces those link dirs with a real copy, then overlays the Electron-ABI `.node`.

## 2026-10-07

### Added
- **Notion save** — Settings stores an internal integration token (Keychain) and a database ID/URL. `POST /api/destinations/notion/save` creates one database row per video (title, channel, URL, published, saved) and appends summary + transcript in Notion-sized batches. The extension never sees the token.
- **LLM provider setting** — Settings → Summaries chooses Anthropic or OpenAI. Keys are stored with Electron `safeStorage` (Keychain) and passed to the server child via IPC or env at spawn, never plaintext on disk. `summarize(transcript, promptVersion)` writes cached `baseSummary`.
- **Transcript cache integration test** — Temp SQLite DB starts at the pre-cache schema, `prisma migrate deploy` keeps old rows with `captionLanguage=en` / `pipelineVersion=1`, and `getOrCreateTranscript` with a mocked fetcher hits once unless lang or pipeline version changes.
- **Extension pairing without Terminal** — `POST /api/native-host/pair` reads the extension ID only from `Origin: chrome-extension://<32 a-p>`. The Electron app shows a native Allow / Don't allow dialog; Allow appends the ID to `extension-ids.json` and rewrites browser manifests. The LOCAL extension calls this once when the native host is missing, then retries.

### Fixed
- **Self-contained ffmpeg** — CI bundles a static macOS arm64 ffmpeg (Martin Riedl) instead of Homebrew's dylib-linked binary. Packaged `ffmpeg` and `yt-dlp` must be arm64 and `otool -L` must not show `/opt/homebrew` or `/usr/local`.
- **Native-host install notifications on macOS** — Success and failure use Electron `Notification` (with `dialog.showMessageBox` fallback). `displayBalloon` is Windows-only and is no longer used on Mac.
- **Visible macOS tray icon** — Ships `trayTemplate.png` (16px) and `trayTemplate@2x.png` (32px): a black-on-transparent "T" glyph. The menu-bar item uses template rendering and falls back to title `T` if the image is empty.
- **Packaged Electron server starts** — The Next.js standalone server, its `node_modules` (including `next` and Prisma), `.next/static`, `public/`, Prisma client + darwin-arm64 engines, and migrations are copied outside asar into `Contents/Resources/standalone`. The menu-bar app runs that `server.js` with `ELECTRON_RUN_AS_NODE=1`. Health checks send the loopback token (so they are not stuck on 401). Missing Python/Whisper is a warning, not a 503, because this beta is captions-first. CI launches the packaged server on a temp data dir, requires `/api/health` 200, then `GET /api/transcripts`.
- **Extension side panel opens faster (YTT-456)** — The initial `chrome.tabs.query()` call is deferred with `requestIdleCallback` so the panel paints its skeleton loader immediately instead of blocking on service-worker wake (which can take hundreds of ms on cold start). The panel shows the loading state, then updates asynchronously when tab info arrives. Applies to both LOCAL and ENTERPRISE builds.

## 2026-10-06

### Changed
- **LOCAL extension sends the page URL only (YTT-442)** — The Chrome extension side panel has one action, **Send this page**, which posts that URL to `http://127.0.0.1:19720/api/transcripts`. The loopback token stays in service-worker memory and is sent only as an `Authorization` header. The extension does not write secrets to `chrome.storage`, does not put them in query strings, and does not talk to a remote host.

### Security
- **Block SSRF on custom provider URLs (#16)** — Connection tests and cloud transcription refuse custom `baseUrl` values that are private, loopback, link-local, or cloud metadata (including `169.254.169.254`, `metadata.google.internal`, and DNS answers that land on those ranges). The check runs before the stored provider key is sent. Groq, OpenRouter, and OpenAI stay on a known-host allowlist; a known host that resolves to a blocked address is still refused. Custom URLs must not redirect. Saving a blocked base URL returns HTTP 400.
- **Fail closed on plaintext database secrets (#18)** — `ProviderConfig.apiKey` and Setting `groq_api_key` are usable only as `yttenc:v1` ciphertext with `TRANSCRIBER_SECRETS_KEY`. Plaintext rows are refused (including when the master key is set, until boot or `npm run migrate:secrets` re-encrypts them). If plaintext rows remain and the master key is missing, boot logs a warning and those keys are not used. Env-only keys (`OPENROUTER_API_KEY`, `WHISPER_CLOUD_API_KEY`) stay in the environment and are not written to the database.
- **MCP loopback auth and confirmed delete (YTT-438)** — The MCP server sends the same `Authorization: Bearer` token as the local API (`TRANSCRIBER_LOCAL_TOKEN` or an existing shared token file) and does not call the API when that token is missing. MCP does not create the token file. `delete_transcript` permanently deletes only when `confirm` is `true`. Tool arguments still do not include `apiKey`.
- **Encrypt provider API keys at rest (YTT-437)** — `ProviderConfig.apiKey` and Setting `groq_api_key` are stored as AES-256-GCM ciphertext (`yttenc:v1:…`) using `TRANSCRIBER_SECRETS_KEY` (generate with `openssl rand -hex 32`). Decrypt only in server processes when calling providers; Settings/Providers GET stay masked. Boot (and `npm run migrate:secrets`) re-encrypts plaintext rows when the master key is present. Saving or decrypting stored secrets fails closed with a clear error if the master key is missing. Env-only keys (`OPENROUTER_API_KEY`, `WHISPER_CLOUD_API_KEY`) are unchanged.
- **No client `apiKey` on summarize (YTT-436)** — `POST /api/transcripts/[id]/summarize` and `POST /api/summaries` reject any client-supplied `apiKey` (HTTP 400). Summarize uses only a server-held OpenRouter key (`OPENROUTER_API_KEY` or Settings → OpenRouter). MCP `summarize_transcript` no longer accepts or forwards `apiKey`. Custom provider test URLs must be http(s) without embedded credentials.
- **Local API loopback auth (YTT-435)** — All `/api/*` routes on the self-hosted server require `Authorization: Bearer <token>` (or the httpOnly `transcriber_local_token` cookie for the same-origin web UI). The token lives in the Transcriber state dir (`~/Library/Application Support/Transcriber/local-api.token` on macOS; `~/.config/transcriber/local-api.token` on Linux; `%APPDATA%/Transcriber/local-api.token` on Windows) with mode `0600`, or in `TRANSCRIBER_LOCAL_TOKEN`. The Chrome native host exposes `getLocalToken` so the extension can attach Bearer headers without storing the token in `chrome.storage` or URLs. MCP reads the same file/env. `/api/health` no longer returns `projectPath`.

### Added
- **`GET`/`POST /api/summaries`** — built-in summarize (server OpenRouter key). Web sparkle menu offers **Built-in (OpenRouter)** as the primary action.

### Changed
- **Legacy `POST /api/transcripts/{id}/summarize`** — same server-key rules; prefer `/api/summaries`.
- **`npm run dev` / `start`** — Wrappers ensure the loopback token is present in the process env before Next.js boots (required for middleware).
- **`npm run mcp:config`** — Prints the token file path and documents auth; does not recommend raw DB reads as a recall workaround.


## 2026-09-27

### Fixed
- **Side-panel startup no longer blocks the loading shell behind diagnostics** — Startup diagnostics and application scripts are deferred so Chrome can parse the static loading UI without waiting for extension JavaScript. The shell remains visible until a concrete panel state replaces it, and development builds preserve the loaded `dist` directory instead of invalidating Chrome's unpacked extension root.

### Added
- **Bounded local startup diagnostics** — Toolbar launches, panel lifecycle milestones, and paint timings can be exported locally for debugging without collecting page URLs, titles, transcript text, or raw error messages.

## 2026-07-15

### Changed
- **Accurate Node.js setup requirement** — Setup and documentation now require Node.js 20.19+, 22.12+, or 24+, matching the application dependencies. The SQLite driver is pinned to a release that also supports Node.js 26.

### Fixed
- **YouTube audio-only HTTP 403 fallback** — Local Whisper downloads now retry with YouTube's progressive format 18 when separate audio-only streams are rejected with HTTP 403. This restores transcription for videos such as `UIEzt1gGCmk` whose metadata and progressive stream are available but whose DASH audio streams are forbidden.
- **Setup no longer reports success with a broken database driver** — Bun is explicitly allowed to run `better-sqlite3`'s native install script, setup verifies the binding immediately after dependency installation, automatically rebuilds it when lifecycle scripts were skipped or the Node ABI changed, and stops if post-setup verification fails. `npm run test:setup` also opens an in-memory SQLite database so missing or ABI-mismatched native bindings are caught before the app starts returning HTTP 500 errors.

## 2026-05-13

### Fixed
- **Embed-disabled videos no longer fail with "private or restricted" (YTT-319)** — `lib/transcript.ts:fetchMetadata()` was throwing on oEmbed 401 with a misleading "private or restricted — metadata unavailable" error, and because metadata + transcript run in `Promise.all`, the entire transcribe operation failed. But oEmbed 401s happen on **publicly viewable** videos whenever the channel has disabled embed (common) or the video is age-restricted. Confirmed via direct curl: `IFElGv5ZmRM` (Hormozi-adjacent talk) → 401 every time, both URL formats and with/without browser User-Agent; a normal video (`dQw4w9WgXcQ`) → 200. Now `fetchMetadata` falls back to placeholder metadata (`title: "Untitled"`, `author: "Unknown"`, thumbnail URL guessed from videoId) on any non-OK response other than 404. 404 still throws "video not found". Transcript path is independent of oEmbed, so the user gets their transcript with a placeholder title instead of a wrongful error.

### Removed
- **Unused manifest permissions (1.6.27)** — Removed `downloads`, `contextMenus`, and `clipboardWrite` from `optional_permissions`. Chrome Web Store rejection (Purple Potassium) flagged `downloads` and `contextMenus` as never requested. Audited the remainder: `clipboardWrite` was also unused — all four `navigator.clipboard.writeText` sites fire from user-gesture click handlers in the side panel, which doesn't need the permission in MV3. No functional change.

## 2026-05-10

### Added
- **Self-hosted setup wall (1.6.26)** — First-time switch from Cloud to Self-hosted now opens a modal disclosing requirements (~3GB Whisper model, Python 3.10+, ffmpeg, native messaging host, local server) and performance reality (~2-3hrs per 1hr video on Apple Silicon, cloud is ~5× faster). "Stay on Cloud" reverts the toggle; "Continue" marks the user as graduated, opens the GitHub install guide, and switches the mode. Existing self-hosted users are retroactively flagged so they skip the wall and see a one-time toast that the toggle moved.
- **Advanced section in Settings (1.6.26)** — Self-hosted mode toggle moved out of the top of Settings into a collapsible Advanced section so casual cloud users aren't lured into flipping away from the paid product. Cloud is presented as recommended; the toggle stays reachable for users who genuinely need it.
- **Local-detected banner dismiss (1.6.26)** — The "Local server detected · Switch to self-hosted" banner now has a × button. Dismissal persists in `chrome.storage.sync` so casual cloud users with an unrelated localhost server (other tools on :19720) aren't repeatedly nudged.

### Changed
- **Provider picker checkmark (1.6.26)** — The summarize provider menu now shows a checkmark on the selected provider and rebuilds on each open so the highlight reflects the latest selection.
- **Store listing — data-use disclosures rewritten** — Chrome Web Store rejected the previous submission's data-use table. Updated to accurately mark Personally identifiable information (email via Supabase Auth), Authentication information (Supabase session cookie + `ytt_sk_…` API keys), Location (IP, logged for per-IP rate limiting), and Web history (transcribed URLs) as **Yes** in cloud mode. Local mode collects none of these — clarified inline. Added justification for the `nativeMessaging` permission. Single-purpose statement tightened. GitHub URL updated to `lifesized/transcriber`.

### Fixed
- **Connectors skeleton invisible during load (1.6.26)** — Two compounding issues: (1) `el.destinationsSection.hidden = false` ran synchronously while the persisted-cache read was async, leaving a visible empty section under the CONNECTORS label until cached or skeleton rows painted; (2) the persisted cache was mode-agnostic, so a local→cloud switch would briefly paint the local list (Obsidian only) before the cloud fetch returned. (3) The skeleton shimmer gradient (4%→9% white) was imperceptible on the dark side panel. Fixes: paint skeleton synchronously before any await whenever the in-memory cache is null; tag persisted cache with `mode` so a stale-mode read returns null and skeleton stays through the network fetch; bump shimmer contrast to 8%→18%.

## 2026-05-08

### Changed
- **Persisted destinations cache (1.6.25)** — Destinations list now survives popup close. Settings panel reads the cached list from `chrome.storage.local` (5-min TTL) and paints rows instantly on open, while a fresh `fetchDestinations()` runs in the background. The new paint only replaces the cached one if a cheap signature differs (`adapterId|connected|needsReauth` per row + `cloudReady|cloudReason`), avoiding DOM thrash on the common "nothing changed" case. `fetchDestinations` now parallelizes the obsidian-vault read and `GET_SETTINGS` via `Promise.all` so the cloud round-trip is no longer waiting on serialized awaits. OAUTH return clears both in-memory and persisted caches so a fresh connection is picked up immediately.

### Fixed
- **Kebab menu shows "Connect a destination" after transcribe-and-summarize (1.6.24, YTT-293)** — `onExtensionFocus` invalidated `destinationsCache` on every focus / visibility-visible event but only re-fetched when the Settings panel was open. The transcribe-and-summarize flow opens a new tab (ChatGPT/Claude handoff) and returns, firing visibilitychange twice on the side panel, so the cache landed null with the user on the Recent list. The kebab (⋯) menu's `fetchDestinations()` call wasn't awaited, so `connectedDestinations()` read the null cache synchronously and rendered the empty "Connect a destination in Settings to send" state despite working connections. Two fixes: (1) `onExtensionFocus` now refetches in both branches — Settings open *and* Recent list. (2) `toggleRowActionsMenu` awaits `fetchDestinations()` when the cache is empty so first-open paints with real destinations; hot-cache opens still fire-and-forget the refresh for next-open freshness.

## 2026-05-05

### Fixed
- **Stale destination rows during mode switch (1.6.23)** — `switchMode` invalidated `destinationsCache` but waited on two server roundtrips (`CLEAR_TRANSCRIPTION` + `SAVE_SETTINGS`) before re-rendering. During that 100-500ms window, switching cloud → self-hosted left the Notion row visible — looked like a bug. Now renders the destinations skeleton immediately when the settings panel is open, so stale rows clear at the moment of the toggle click.

### Changed
- **Re-check destination tier on focus (1.6.22, YTT-268)** — Side panel keeps its JS context across tab switches, so a tier upgrade completed on transcribed.dev in another tab used to leave the destinations cache stale (Notion stayed "locked" until popup reload). Now on every focus / visibility-visible event the destinations cache is invalidated and the Settings list re-renders if visible. Throttled to once per 2s so platforms that fire `focus` on minor activations don't thrash the cloud.

## 2026-05-04

### Changed
- **Notion gated behind Pro tier (1.6.21, YTT-268)** — Free cloud users now see Notion in the Settings → Destinations list as a locked row: muted icon/name, "Pro" pill, and an Upgrade CTA that opens `transcribed.dev/pricing` in a new tab. Obsidian stays free for everyone in all modes. Cloud server is the authoritative gate (`/api/destinations` marks the row `locked`, `/oauth/start` returns 403, `/send` returns 402); the extension UX layer just renders what cloud reports. Defense-in-depth: if a stale OAuth token survives a downgrade, the send route 402 opens pricing in a new tab and the toast explains why.
- **First-time setup flow simplified (1.6.20)** — Offline state replaces the dual-path layout (`npm run dev` copybox + disclosure-wrapped install) with a single canonical install-native-host flow. Cleaner first impression; `npm run dev` still documented in README for power users running the server in a terminal. Tightens setup-step / setup-hint typography to match.

## 2026-04-28

### Fixed
- **Click-too-fast race: Transcribe falls to slow server path on freshly-opened captioned videos (1.6.13)** — When the user opened a YouTube video and clicked Transcribe within ~1s, `openTranscriptPanel` ran before YouTube had mounted the engagement-panel placeholder (`PAmodern_transcript_view`) or the "Show transcript" description button — `findShowTranscriptDirectButton` returned null, More-actions menu had no transcript item, and we returned `[]`. Background then POSTed without segments, hitting the slow server path even though captions were ~200-1000ms away. Now `tryExtractTranscriptFromPanel` first calls `waitForTranscriptReadiness(3000)` which polls every 150ms for any of: the engagement-panel placeholder, the "Show transcript" button, or an already-expanded transcript panel. Captioned videos with a quick-click resolve in 200-1000ms; uncaptioned videos time out at 3s and correctly fall through to the server. Doesn't gate the Transcribe button (per user feedback that gating would break the audio/yt-dlp path for uncaptioned videos).
- **"Already transcribed" link never shows in local/self-hosted mode (1.6.12)** — `background.js checkExisting()` filtered records with strict `t.status === "done"`, but the local server's Prisma schema (`transcriber-local/prisma/schema.prisma model Video`) has no `status` column at all — every local record returns with the field absent. Strict equality made every local-mode lookup return null, so the "Already transcribed" link never showed and users had no path back to a transcript they'd already created. Now matches the popup's cache-side check (`maybeFindCachedTranscript`): treats a record as done if `status === "done"` OR the field is absent. Cloud's "processing"/"error" semantics still respected because those statuses are explicit non-empty strings, not absences.
- **Two-transcript flash when scraping (1.6.11)** — Clicking Transcribe in the extension was causing YouTube's own transcript panel to briefly open in the page (visible to the user), then close once segments were read. Reported as confusing — "I see two transcripts." We now inject a one-rule stylesheet (`ytd-engagement-panel-section-list-renderer { visibility: hidden !important }` scoped to the transcript panel via `target-id*='transcript'` + `:has(transcript-segment-view-model)`) immediately before clicking Show transcript, and remove it via a `try/finally` after segments are read. Verified against live YT DOM: YouTube renders segments off the panel's internal state attribute, not CSS visibility — segments populate fully even while invisible. Skipped when the user had the panel open before clicking Transcribe (yanking a panel they were actively viewing would be worse than the flash). User now sees nothing happen on the YouTube page when transcribing.
- **Panel-scrape silently failing on every captioned video (1.6.10)** — Modern YouTube replaced `<ytd-transcript-segment-renderer>` with `<transcript-segment-view-model>` and shifted timestamps to `.ytwTranscriptSegmentViewModelTimestamp` / text to `.ytAttributedStringHost`. The old selectors matched zero rows, so `waitForTranscriptSegments` always timed out at 5s and every captioned video fell through to the yt-dlp/Whisper server path. Verified by driving chrome-devtools MCP against `KPDXMtmkcgk` — 500 segments rendered in DOM under the new tag, 0 matched the old selector; new selector list returned all 500 in 516ms and the local fast-path responded 201 in 276ms with `source=client_panel_scrape`. Selectors now match both vintages so the scrape works whichever bucket YouTube serves.
- **`findTranscriptPanel` returning the always-present HIDDEN placeholder** — `PAmodern_transcript_view` is in the DOM from page load whether or not the panel ever opens. The old "panel already in DOM" short-circuit in `openTranscriptPanel` fired on every load and never even attempted to click "Show transcript". Now distinguishes via the `visibility="…EXPANDED"` attribute and only treats a panel as open when it actually contains segments.
- **`findClickableByText` returned wrappers, not the inner `<button>`** — When the match was a `ytd-button-renderer` (the description-strip "Show transcript" container), `.click()` on the wrapper was a no-op because YouTube's actual handler is bound to the inner `<button class="ytSpecButtonShapeNextHost">`. Helper now drills down to the inner button when the match isn't already one.
- **`findMoreActionsButton` selector chain matched a hidden ghost first** — The first selector in the list (`ytd-watch-metadata button[aria-label='More actions']`) matches a `display:none` element before reaching the real visible `#above-the-fold #actions` button. Reordered selectors and added an `offsetParent !== null` filter so the visible button always wins.
- **First Transcribe click after mode switch silently does nothing** — If the user toggled cloud→local while a cloud transcribe was still in flight, the bg's persisted state stayed `status: "transcribing"`. PHASE 3 of `init()` re-armed `isTranscribing = true` from that state, and the next click hit the doTranscribe `if (isTranscribing) return` guard — looked dead. Now the mode-toggle handlers explicitly reset `isTranscribing = false` and dispatch `CLEAR_TRANSCRIPTION` before saving the new mode, so any leaked in-flight state from the prior mode is dropped before the user sees the next click.

### Changed
- **Hide cloud-only adapters in self-hosted mode** — `extension/popup.js` no longer renders the Notion connector with a "Switch to Cloud mode to use" teaser when the user is in self-hosted mode. Cloud-only adapters can't work without the cloud backend, so showing them as gated rows was just noise. The teaser still appears in cloud mode when the destinations fetch fails (signed out, offline, 5xx).

### Fixed
- **Sign-in flash on Local↔Cloud mode toggle** — `coldStartHandled` is now reset on both mode-toggle handlers. Commit `8747b0d` had locked the 400ms cold-start retry to the very first `init()` call, but a mode switch invalidates the background `apiConfigCache` and the next `/api/account` hit can 401 on the same cookie-attach race a true cold start sees. Returning signed-in users were getting bounced to the sign-in card after Local→Cloud despite a valid session — the retry window now reopens on every mode change.

## 2026-04-27

### Added
- **Client-side caption scrape (extension 1.6.1)** — Side panel now reads `window.ytInitialPlayerResponse` from the YouTube tab via a new MAIN-world content script (`content-captions-main.js`) and fetches the JSON3 timed-text URL directly in-browser. When captions exist, segments are sent along with the `POST /api/transcripts` request as a `segments[]` field; the cloud server stores them directly and skips the Inngest worker round-trip. Matches the "instant transcript" UX of competitor extensions for caption-able videos. Falls back transparently to the existing server-side path for videos without captions (Whisper / audio).
- **Transcribe benchmarking** — `doTranscribe` now logs and persists per-call timings (`captionScrapeMs`, `serverRequestMs`, `totalMs`, pathway) to the service worker console + `chrome.storage.local.transcribeBench` (last 20 records). Lets us measure the speedup objectively across videos.

### Fixed
- **`isTranscribing` flag leaks `true` across panel sessions (1.6.9)** — 1.6.8's double-click guard correctly returns when `isTranscribing` is true, but the flag could be stuck from a previous attempt where the panel was closed mid-transcribe (the popup's `await sendMsg(...)` never resolved, so the assignment back to `false` never ran). Result: every Transcribe click in the next panel session was a silent no-op. `init()` now resets `isTranscribing = false` at the top of its UI-reset block; PHASE 3 sets it back to `true` only if the bg actually has a pending transcription. Self-correcting.
- **Transcribe click feels frozen, second click lurches the bar backward (1.6.8)** — `doTranscribe` awaits `GET_SETTINGS` (~100-300ms on a cold service worker) before calling `startProgress`. During that gap the Transcribing card is visible but the bar sits at 0% with no animation, looking like nothing happened. Users double-click; the second click starts a parallel `doTranscribe`, both eventually call `startProgress`, the second resets the bar to 0% — visible jump backward. Now `doTranscribe` no-ops if `isTranscribing` is already true, and the bar flips to indeterminate animation synchronously on click before any await — instant visual feedback.
- **Renderer-present-but-empty intermediate state still leaked through (1.6.7)** — User probe on `5mGMDdT6YrM` returned **12 caption tracks**, our bench still reported `captionTracks: 0`. So 1.6.6's `renderer === undefined` check wasn't strict enough — YouTube populates the response in stages and we were catching a window where `playerCaptionsTracklistRenderer` was present but `captionTracks` was still empty/missing. Snapshot now treats anything short of a non-empty `captionTracks` array as "not ready". Cost: videos that genuinely have no captions poll the full ~6s before giving up — acceptable, those fall to the server path and most YouTube videos have captions.
- **MAIN-world snapshot froze cache at empty before captions populated (1.6.6)** — On the videos in 1.6.5 testing, `getPlayerResponse()` returned a partial object early in load — the response existed but `captions.playerCaptionsTracklistRenderer` hadn't materialized yet. Old code took that as "no captions, all done", dispatched an empty array, and the poll loop exited. By the time the user clicked Transcribe (or probed manually) the renderer had populated, but our cache was already locked empty. Confirmed by user diagnostic: `tracks: 1` on `dYwQYdD81Z4` while bench showed `captionTracks: 0`. Snapshot now treats `renderer === undefined` as "not ready" and keeps polling until either captions appear or the 6s cap.
- **YouTube no longer exposes `ytInitialPlayerResponse` on many pages (1.6.5)** — Field probe on a real watch page (id `4iq1CqihWgI`) returned `hasInitial: false` while `getPlayerResponse()` on `#movie_player` returned the same shape with `tracks: 1`. So the historic global isn't reliable anymore. Updated the MAIN-world snapshot to try three sources in order: `window.ytInitialPlayerResponse` → `document.getElementById("movie_player").getPlayerResponse()` → `window.ytplayer.config.args.player_response`. Whichever returns truthy first wins. Combined with the 1.6.4 polling, the script now waits for the player to initialize and reads from whichever surface YouTube exposes.
- **MAIN-world caption snapshot loses race against YouTube hydration (1.6.4)** — `content-captions-main.js` runs at `document_start`, which on direct-load YouTube watch URLs fires *before* YouTube's inline assignment of `window.ytInitialPlayerResponse`. The initial dispatch always saw `undefined` and gave up, and `yt-navigate-finish` never fires for direct-load pages. Effect: ISOLATED content script answered `EXTRACT_CAPTIONS` correctly (≈600ms — the `awaitCaptionsRefresh` timeout), but no track data ever made it into the cache. Now the script polls every 200ms (cap ~6s) until `ytInitialPlayerResponse` shows up, then dispatches. Same poll dance reused for `yt-navigate-finish` and the `ytt-captions-request` handshake. Diagnosed via 1.6.2 bench data showing `captionScrapeMs: 605ms` matching the timeout exactly.
- **Auto-inject content scripts into existing tabs on extension update (1.6.3)** — Chrome doesn't re-inject newly registered content scripts into tabs that were already open before an extension update — only into future page loads. That left every YouTube tab a user already had open running the pre-update content script (or none at all), with no `EXTRACT_CAPTIONS` listener, so the bg's caption-scrape probe resolved instantly with `chrome.runtime.lastError` and the fast path could never fire until the user manually reloaded each tab. Now `registerContentScripts` follows up by iterating matching tabs and calling `chrome.scripting.executeScript` to attach the new code immediately. ISOLATED-world scripts ping with `PING_TRANSCRIBER` first and skip injection if the new code is already responsive — avoids duplicating `runtime.onMessage` listeners.
- **"Already transcribed" lying about pending records (1.6.2)** — Both the cached lookup in the side panel (`maybeFindCachedTranscript`) and the bg `checkExisting` round-trip matched recent transcripts by `videoId` only, ignoring `status`. A stuck `processing` record would surface as "Already transcribed", and clicking it took users to a still-pending row in the web app. Both paths now require `status === "done"` before claiming the video is done.
- **Progress bar lurching** — `startProgress` was leaking `setInterval` timers when called twice (e.g., on a tab-switch race). Two timers writing to `bar.style.width` with their own elapsed counters made the bar jump backward. Now idempotent — clears any previous timer before starting a new one.
- **`optimisticAuthed` ReferenceError on cold-start retry** — Leftover references after the recent rename to `cachedAuthOk` would have crashed the cold-start retry path on cloud-mode 401s.
- **Stale caption cache across SPA navigation** — Cached caption tracks are now tagged with their videoId; `EXTRACT_CAPTIONS` rejects stale snapshots and waits for a fresh dispatch from the MAIN-world script before fetching, so video B never gets video A's captions.

### Changed
- **Extension cloud-mode panel boot — instant first paint** — Side panel no longer shows a dark blank screen while `CHECK_SERVICE` (`/api/health` + `/api/account`) round-trips on open. `init()` now does parallel cheap reads (active tab, mode, cached auth) up front and paints the page state + Recent list optimistically before any network fetch. The CHECK_SERVICE call still runs and reconciles the UI on confirmed offline / 401, but happy-path users see content in their first frame.
- **Recent transcripts SWR cache** — Last fetched list is cached per mode in `chrome.storage.local`. `loadRecent()` renders the cached list immediately on open, then revalidates from `/api/transcripts` and only touches the DOM if the result actually differs.
- **Cloud auth cache (5 min TTL)** — Successful `/api/account` writes `authCache_cloud` so returning users skip the sign-in flash on a transient cold-start 401. Cold-start retry is now also triggered when the cached auth says we should still be signed in (a 401 there is almost always a Supabase cookie warmup race, not a real signout). Confirmed 401 clears the cache so the next open shows the sign-in card without flashing the list.

### Removed
- **Dead `popup-shell.html` / `popup-shell.js`** — Unused since the side panel switched to native `popup.html`. Dropped from `extension/build.js` too.

## 2026-04-20

### Added
- **Extension destination adapters — client scaffolding (YTT-205 §2)** — Settings panel gains a Destinations section for connecting / disconnecting cloud-hosted adapters (Notion, Obsidian, and future destinations). Each recent-transcript row gains a `⋯` menu with **Send to \<connected destination\>**, **Open in web app**, and **Copy link**. Success / failure surfaces as a `chrome.notifications` toast (falls back to a badge flash if the optional `notifications` permission is denied).
- **New background message types** — `LIST_DESTINATIONS`, `START_DESTINATION_OAUTH`, `SEND_TO_DESTINATION`, `DISCONNECT_DESTINATION`. All route through the existing cloud session-cookie auth; the extension itself holds zero adapter code or OAuth secrets — it is a thin client.

### Notes
- The UI ships inert until the cloud-side registry + OAuth proxy (YTT-211) lands. When `/api/destinations/*` returns 404 or 501, the settings section shows "Destinations aren't available yet." and row menus gracefully hide destination items.
- Obsidian adapter uses a URL scheme (`obsidian://new?…`); the scheme URL is built cloud-side for consistency and opened client-side via `chrome.tabs.create`.
- Extension bumped to **1.6.0**.

## 2026-04-16

### Added
- **Generic video support via yt-dlp** — Any URL from a yt-dlp-supported site (Twitch, Vimeo, TikTok, Twitter/X, Dailymotion, Reddit, Instagram, Facebook, Rumble, BiliBili, Odysee, Streamable, and ~1,800 more) now routes through a generic transcription pipeline. Detects platform via yt-dlp extractor, downloads audio, transcribes via the existing provider fallback chain.
- **New `lib/generic-video.ts` module** — Fetches metadata via `yt-dlp --dump-json`, downloads audio, re-encodes large files for cloud upload limits, falls back to local Whisper.
- **`transcribeAudioFileWithWhisper`** (`lib/whisper.ts`) — New public helper that runs local Whisper on an arbitrary audio file path (not just YouTube videoIds). Reused by Spotify and the generic video route.
- **URL input accepts any video URL** — Home page validator loosened from a YouTube/Spotify-only regex to any `http(s)://` URL. Server-side `parseContentUrl` + the generic yt-dlp route handle detection and routing. Placeholder and error copy updated to reflect multi-platform support.

### Changed
- **Spotify transcription** — Wired up local Whisper fallback (previously stubbed out). Large podcast episodes are re-encoded to 48kbps mono MP3 before cloud upload so they fit under the Groq/OpenAI 25MB Whisper limit.
- **Chrome extension dual-mode** (YTT-162) — Extension now supports both cloud (transcribed.dev) and self-hosted (localhost:19720) modes. Cloud mode is the default for new installs. Updated popup UI, background script, content script, and manifest.
- **README** updated with dual-mode extension install instructions and cloud/self-hosted usage guide.
- **Portable binary defaults** — `yt-dlp` and `ffmpeg` paths now default to bare command names (resolved via `PATH`) instead of `/opt/homebrew/bin/...`. Works on Intel Macs, Linux, and any system where the tools are in `PATH`. Override via `YTDLP_PATH` / `FFMPEG_PATH` env vars if needed.
- **Dev server stability** — Switched dev script to `next dev --webpack` to work around a Turbopack HMR panic on Next.js 16.1.6 that caused the settings page to reload in a loop. Pinned `outputFileTracingRoot` and `turbopack.root` in `next.config.ts` to prevent Next from walking up to a stray parent-dir `package.json`.

### Fixed
- **Settings page reload loop** — Turbopack panic (`Next.js package not found` on `/settings` HMR) caused continuous full-page reloads; switched to webpack for dev.
- **`.cursor/` added to `.gitignore`** — prevents IDE config from being tracked.

## 2026-03-27

### Added
- **Spotify podcast transcription** (YTT-143) — Paste a Spotify episode URL to get a transcript. Uses Spotify's official API for metadata, iTunes Search API to discover the podcast's public RSS feed, then downloads audio and transcribes via Groq/OpenRouter/Whisper. No undocumented APIs or TOS violations.
- **Unified URL parser** (`lib/url-parser.ts`) — Detects YouTube vs Spotify URLs and extracts content IDs. Extensible for future platforms.
- **Spotify module** (`lib/spotify.ts`) — Client Credentials auth, RSS feed discovery via iTunes, RSS XML parsing with episode matching by title/duration, podcast audio download from CDN.
- **Chrome extension Spotify support** (YTT-144) — Extension now detects Spotify episode pages and enables one-click transcription from the side panel.
- **`platform` field** on Video model — Tracks whether a transcript came from YouTube or Spotify.

### Changed
- **URL input** accepts both YouTube and Spotify URLs with updated validation and placeholder text.
- **Chrome extension** updated to v1.2.0 with multi-platform URL detection in content scripts, background worker, and popup.

## 2026-03-24

### Added
- **yt-dlp subtitle fallback** (YTT-119) — New fallback step between web scrape and Whisper audio transcription. Uses `yt-dlp --write-auto-subs` to download auto-generated captions via YouTube's PO token ecosystem, recovering captions that broke after YouTube's March 2026 BotGuard enforcement. Tagged as `youtube_captions_ytdlp` source.
- **VTT subtitle parser** — Parses WebVTT files from yt-dlp into timestamped transcript segments, handling HTML entities, VTT tags, and alignment metadata.
- **Configurable yt-dlp path** — `YTDLP_PATH` env var overrides the default `/opt/homebrew/bin/yt-dlp`.

### Changed
- **InnerTube methods disabled by default** — ANDROID and WEB InnerTube caption methods are skipped (broken without PO tokens since March 2026). Re-enable with `YTT_INNERTUBE_ENABLED=1`.
- **Updated User-Agent** — Chrome/120 (2023) updated to Chrome/131 to reduce bot-detection risk on web scrape.
- **Updated InnerTube client versions** — ANDROID `19.35.36` to `19.47.53`, WEB `2.20241126.01.00` to `2.20250312.04.00`.

### Fixed
- **Auto-generated captions broken since March 5** — YouTube began requiring PO tokens for auto-caption access. All 133 transcriptions since March 5 fell through to Whisper. The new yt-dlp subtitle fallback restores fast caption retrieval for these videos.

## 2026-03-21

### Added
- **Focus-visible rings** on submit button, retry button, and library tile links for keyboard accessibility.
- **Input disabled state** — reduced opacity and `not-allowed` cursor when disabled.
- **Input error state** — red border and ring when `aria-invalid="true"` is set.
- **Toggle hover feedback** — subtle brightness/opacity shift on hover for both on and off states.

### Fixed
- **Retry button spacing** — increased padding and added `whitespace-nowrap` to prevent text wrapping in failed queue items.

## 2026-03-18

### Added
- **Cost tracking for paid Groq usage** (YTT-108) — Estimated cost displayed below the usage bar when exceeding the free tier. Shows daily cost and collapsible monthly breakdown with per-day details.
- **Daily usage history** — New `DailyUsage` database table persists usage per provider per day. Previous day's data is preserved on day rollover instead of being discarded.
- **Real Groq rate limits** — Usage bar now reads `x-ratelimit-*` headers from Groq API responses, showing actual remaining quota and reset time instead of local estimates.
- **Usage history API** — `GET /api/usage` returns current month's daily breakdown with overage cost calculations.
- **Entrance animations** — Staggered fade-up animations on page load for header, input, and library sections with `prefers-reduced-motion` support.
- **Empty state illustration** — Library shows an icon and helpful prompt when no transcripts exist yet.
- **Shimmer loading skeletons** — Library loading state uses animated shimmer effect instead of static placeholders.
- **Ambient glow** — Subtle pulsing radial glow behind the URL input when idle.
- **First-visit subtitle** — "Local transcription powered by Whisper. No data leaves your machine." shown to new users.

### Changed
- **Home page full redesign** — Glassmorphic input card, refined tile cards with gradient overlays and bronze thumbnails, polished list view with softer borders, centered footer with icon dividers, backdrop-blur dialogs and toasts.
- **Transcribe button** — Renamed from "Extract" to "Transcribe", color changed to `#a0a0a0` for reduced brightness.
- **Completion animations** — Reworked with Framer Motion spring physics. Queue items spring in/out with `AnimatePresence`, list entries get a spring-animated grayscale tick (no more green), smoother layout reflow with soft spring easing.
- **Tile thumbnails** — Bronze/sepia filter with hover transition to increased opacity.
- **Library section** — Removed enclosing panel card, view toggle buttons moved to top-right, search bar full-width.
- **Footer** — Centered layout with vertical line dividers, GitHub text link replaced with octocat icon.
- **Delete dialog** — Backdrop blur overlay, refined copy and spacing.
### Fixed
- **Usage day boundary** — Daily usage now resets at local midnight instead of UTC midnight.

## 2026-03-17

### Added
- **Multi-provider transcription** (YTT-102) — Configure multiple cloud providers (Groq, OpenRouter, custom endpoints) with automatic fallback chain.
- **Drag-and-drop provider ordering** — Reorder transcription providers and local Whisper in settings with drag-and-drop. Priority persists to database.
- **Provider reorder API** — `POST /api/settings/providers/reorder` for bulk priority updates.

### Changed
- **OpenRouter defaults** — Default model changed to `google/gemini-2.5-flash`, trimmed model list to verified audio models.
- **Settings panel redesign** — Extracted to standalone component with dither toggles, hover states, and confirm-before-delete for providers.
- **Library toolbar** — Simplified to single view toggle with dropdown menu.

### Fixed
- **Extension fullscreen** — Side panel now closes when entering YouTube fullscreen via button or 'f' shortcut.
- **Progress animation** — Fixed animation resetting to pulsing pattern when switching browser tabs during transcription.

## 2026-03-15

### Added
- **Tab completion notifications** — Favicon shows a green checkmark badge and document title updates to "✓ Transcript ready: ..." when a transcript finishes, visible from other tabs. Both reset when starting a new extraction. (YTT-86)
- **Notifications setting** — Completion alerts toggle moved to Settings page with a proper switch control. Replaces the inline "Alerts On/Off" button in the queue header.

### Changed
- **Louder completion sound** — Increased gain from 0.08 to 0.35 with longer sustain so it's actually audible.
- **Extension: removed redundant header** — Chrome's side panel already shows the extension name and icon; removed the duplicate header inside the panel.
- **Extension: "already transcribed" detection** — When navigating to a video that's already in the database, the extension now shows the title with a checkmark badge and "View transcript" button instead of offering to transcribe again.
- **Extension: auto-open on completion** — Newly completed transcriptions automatically open in the app. Reuses an existing app tab instead of spawning new ones.
- **Extension: no more dead-end "Done" screen** — The old "Transcription complete / Open in app" screen is replaced with a contextual transcribed state that stays useful.

### Fixed
- **Groq usage daily reset** — Settings page now persists the usage reset to the database when visiting on a new day, instead of only resetting in the UI.

## 2026-03-14

### Added
- **Settings page** (`/settings`) — Configure Groq API key with auto-save on paste, test connection button, and step-by-step setup guide. Gear icon in footer links to settings. (YTT-87)
- **Groq usage meter** — Daily usage visualization showing audio-seconds used vs 14,400s free tier limit with color-coded status (Free / Approaching limit / Paid usage).
- **Settings API** — `GET /api/settings` (masked key), `PUT /api/settings` (save), `POST /api/settings/test-groq` (verify key).
- **DB-backed cloud config** — `getCloudWhisperConfig()` now checks DB settings (priority over env vars), allowing API key setup via the Settings page instead of `.env`.
- **Groq as primary transcription** — When a Groq API key is configured, cloud Whisper runs before YouTube caption scraping for faster results.
- **README Groq section** — Added "Groq Cloud Transcription (Free)" with signup steps, free tier limits, and env var alternative.

### Fixed
- **Redundant Groq retries** — When Groq fails (e.g., file too large), fallback path no longer re-attempts Groq, avoiding triple audio downloads.
- **Audio file size for Groq** — Lowered yt-dlp audio quality from 5 (~130kbps) to 9 (~65kbps) to keep files under Groq's 25MB limit for longer videos.
- **Usage tracking** — Fixed duration calculation falling back to last segment end time when Groq response omits top-level `duration` field.

### Changed
- **Footer layout** — Removed "about this project by lifesized" text; settings gear icon on left, GitHub icon on right.

## 2026-03-13

### Added
- **Chrome extension** — One-click YouTube transcription from any video page. Detects the current video, shows a Transcribe button, and displays recent transcripts. (`extension/`)
- **Side panel UI** — Extension uses Chrome Side Panel API so it stays open while navigating between YouTube videos. Auto-detects new videos on tab change.
- **Transcription queue in extension** — Queue multiple videos while one is transcribing. Queue persists via `chrome.storage.session`.
- **Persistent transcription state** — Extension state survives popup close and service worker restart. Badge indicator on icon: `...` (transcribing), `✓` (done), `!` (error).
- **Scrollable recent list** — Extension's recent transcripts list is scrollable with `max-height`.
- **`Setting` model** — Key-value settings table added to Prisma schema for upcoming settings page (YTT-87).

### Changed
- **"Open in app" button** — Restyled from orange text to white glass design matching the web app (`bg-white/10 border-white/20 rounded-full`).

### Removed
- **"Online" status badge** — Green dot and "Online"/"Offline" label removed from extension header.

## 2026-03-06

### Fixed
- **Queue stuck after duplicate URL** — Submitting a URL that was already transcribed would permanently block the processing queue, causing all subsequent URLs to stay in "pending" forever. (`app/page.tsx`)
- **Retry button not working** — The retry button on failed queue cards referenced the wrong variable, making it non-functional. (`app/page.tsx`)

### Changed
- **Pending queue items now show feedback** — Items waiting to be processed display a pulsing indicator and "Queued" label instead of a static grey dot with no context. (`app/page.tsx`)

## 2026-03-05

### Added
- **GNU AGPL v3.0 license** — Added `LICENSE` file, updated `package.json`, README badge, and About page. Replaces the previous ISC/MIT references. (`LICENSE`, `package.json`, `README.md`, `app/about/page.tsx`)

### Changed
- **Reordered transcript fallback chain** — Web page scrape is now tried first instead of last. YouTube's InnerTube API now requires Proof-of-Origin (PO) tokens via BotGuard attestation, causing ANDROID (400 FAILED_PRECONDITION) and WEB (UNPLAYABLE) clients to fail on all videos. Web scrape remains reliable and is now the primary caption source. (`lib/transcript.ts`)
- **Improved yt-dlp error messages** — Raw yt-dlp command output is no longer shown to users. Errors are classified into friendly messages (network issues, anti-bot blocks, unavailable videos, etc.) with actionable advice. (`lib/whisper.ts`)

### Fixed
- **yt-dlp audio download retry** — Added automatic retry (1 retry with 3s delay) for transient network errors during audio download, improving reliability on unstable connections. (`lib/whisper.ts`)
- **Updated yt-dlp** — Upgraded from 2026.02.04 to 2026.03.03 to fix YouTube "n challenge solving" failures.

## 2026-03-01

### Fixed
- **Progress bar now reaches 100%** — The transcription progress bar previously disappeared around 50–75% because the item status changed to "completed" before the bar could animate to full width. Now the bar animates to 100% with a "Done!" label before transitioning to the completed state.
- **Vertically centered status indicator** — The green checkmark (and other status icons) on queue cards are now vertically centered instead of being top-aligned.

## 2026-02-24

### Added
- **BYOK cloud Whisper fallback** — Cloud-based transcription via Groq or OpenAI Whisper APIs when YouTube captions aren't available. Configure with `WHISPER_CLOUD_API_KEY` and optional `WHISPER_CLOUD_PROVIDER` / `WHISPER_CLOUD_MODEL` env vars. Falls back to local Whisper on failure. New source values: `whisper_cloud_groq`, `whisper_cloud_openai`. (YTT-41)

## 2026-02-23

### Added
- **Lightweight standalone skill** (`contrib/claude-code/SKILL-lite.md`) — Zero-setup transcription skill that works with just `yt-dlp` installed. Auto-detects and upgrades to the full service when running. (YTT-35)
- **Caption language preference** — New `lang` parameter on POST `/api/transcripts` and MCP tools (`transcribe`, `transcribe_and_summarize`). Configure defaults via `YTT_CAPTION_LANGS` env var (comma-separated, e.g. `en,zh-Hans,es`). Tries manual captions first, then auto-generated, falls back to first available. (YTT-36)

### Changed
- **README** — Added Lite vs Full skill comparison table, Language Preference section with API/env var examples, added speaker diarization and multi-language captions to features list.
- **About page** — Split Claude Code agent into full and lite entries, added multi-language captions to Technical Highlights.
- **Stronger session continuity hook** — `check-handover.sh` now validates both HANDOVER.md and CHANGELOG.md, checks date headers, and blocks git commits when files are stale.
- **Competitive analysis** — Researched skills.sh ecosystem, feiskyer/youtube-transcribe-skill, mower07/youtube-transcribe-openclaw, and inference-sh audio skills to identify gaps and improvements.
- **9 new Linear tickets** for improvement roadmap:
  - YTT-35: Lightweight standalone SKILL.md (no server required) — Urgent
  - YTT-36: Caption language preference support — High
  - YTT-41: BYOK cloud Whisper fallback (Groq, OpenAI, user-provided) — High
  - YTT-37: Browser automation fallback (Chrome DevTools MCP) — Medium
  - YTT-38: Cookie/auth support for restricted content — Medium
  - YTT-42: Post-transcription intelligence layer (reflection, bias, content ideas) — Medium
  - YTT-39: Remote/non-localhost server URL — Low
  - YTT-40: Auto-detect and start service when not running — Low
  - YTT-43: Improve transcript download format and structure — Low

## 2026-02-22

### Added
- **`transcribe_and_summarize` MCP tool** — Combo tool that transcribes a video and returns the full text for the LLM to summarize in one step. No more follow-up questions in Claude Desktop.
- **`ts` shorthand** — Type `ts <URL>` in Claude Code, Claude Desktop, or OpenClaw to transcribe and summarize in one action.
- **MCP server** — New `mcp-server/` sub-package wrapping the REST API for Claude Desktop, Claude Code, Cursor, and other MCP clients. Includes 7 tools (`transcribe`, `transcribe_and_summarize`, `list_transcripts`, `search_transcripts`, `get_transcript`, `delete_transcript`, `summarize_transcript`) and a `transcript://{id}` resource. Built automatically during `npm run setup`.
- **`npm run mcp:config`** — Helper that prints the MCP client config with the correct absolute path.
- **MCP documentation** — `docs/MCP.md` with setup guides for Claude Desktop, Claude Code, and Cursor.
- **Session continuity hook** — `scripts/check-handover.sh` warns when work was done but `HANDOVER.md` wasn't updated.

### Changed
- **README** — Added "Use as an MCP Server" section; expanded skill trigger examples; simplified credits line.
- **Favicon** — Regenerated as multi-size ICO (16/32/48px) with 4x supersampled anti-aliasing.
- **Setup script** — MCP server install is now opt-in via y/N prompt during `npm run setup`.
- **About page** — Added Claude Desktop / Cursor entry to "How to Use"; updated AI agent integration highlight to mention MCP.

## 2026-02-20

### Changed
- **README skill examples** — Show all trigger forms (summarize, transcribe, s, t) as separate example lines instead of inline shorthand note.
- **README credits** — Simplified credits line.
- **Favicon** — Regenerated as multi-size ICO (16/32/48px) with 4x supersampled anti-aliasing for smooth edges in browser tabs.

## [Unreleased] — improve-transcript branch

### Added
- **Speaker diarization support** — Opt-in speaker identification using pyannote.audio. When `HF_TOKEN` is configured, Whisper-transcribed videos automatically get "Speaker 1", "Speaker 2" labels. Diarization is non-fatal; if it fails, transcripts are returned without speaker labels. (`lib/whisper.ts`)
- **`speaker` field on `TranscriptSegment`** — Optional field added to the transcript segment interface for backward-compatible speaker data. (`lib/types.ts`)
- **Segment merging in transcript viewer** — Short caption segments (every 2-3s) are merged into ~10-second blocks for more readable paragraphs. (`app/page.tsx`)
- **Speaker labels in UI** — Speaker name shown above transcript blocks when the speaker changes. (`app/page.tsx`)
- **Speaker labels in exports** — Copy-to-clipboard, Markdown download, LLM summarization prompts, and "Summarize with" launcher all include speaker labels when available. (`app/page.tsx`, `app/api/transcripts/[id]/download/route.ts`, `app/api/transcripts/[id]/summarize/route.ts`, `components/ui/llm-launcher.tsx`)
- **`HF_TOKEN` env var** — Documented in `.env.example` for pyannote.audio speaker diarization setup.
- **pyannote.audio install** — Added to `scripts/setup.sh` as an optional dependency.
- **"Identifying speakers..." progress phase** — Progress indicator updated with a diarization stage between Whisper transcription and completion. (`app/page.tsx`)

### Changed
- **Transcript rendering alignment** — Timestamps now use `items-baseline` alignment, fixed width (`w-10`), and right-alignment for consistent visual positioning. (`app/page.tsx`)
- **About page layout** — Matched content width to home page (`max-w-[800px]`), added responsive padding, removed section dividers, updated typography hierarchy to match home page styles (h2 = video title style, body = author/date style). (`app/about/page.tsx`)
- **About page content** — Title changed to "About", removed subtitle, added "Summarize with..." to How to Use section, renamed "Built With AI" to "Tools", updated tools list text, added MIT License mention, removed Ghostty from tools.
- **Favicon** — Created `app/favicon.ico` with black circle on light gray (`#B4B4B4`) background, 4px rounded corners, centered smaller circle. Next.js App Router auto-serves it.

### Removed
- `public/favicon.ico` — Moved to `app/favicon.ico` for App Router compatibility.
