# Permission Justifications — Chrome Web Store Review

Paste these into the corresponding fields in the Chrome Web Store developer console when checking or updating the published listing. Each justification answers "why does this extension need this permission?"

## Single purpose statement

> Transcribe the YouTube video or podcast the user is viewing, then optionally summarize it with Claude or ChatGPT or send the transcript to Notion or Obsidian, all from a side panel that stays open beside the video.

## Required permissions

### `activeTab`
> Reads the URL of the tab the user has clicked the extension on, so the extension knows which video or podcast to transcribe.

### `tabs`
> Required for three flows that `activeTab` alone cannot serve:
> 1. Opening `obsidian://` URL-scheme links via `chrome.tabs.create()` to deliver finished transcripts to the user's local Obsidian app.
> 2. Reusing an existing transcribed.dev tab when re-opening the cloud app (`chrome.tabs.query({})` to find it, `chrome.tabs.update()` to focus and navigate it) — avoids opening a new tab every time.
> 3. Reading `tab.url` in `chrome.tabs.onActivated` / `onUpdated` listeners so the side panel updates the "currently viewing" video when the user navigates.

### `storage`
> Persists user settings (mode selection, destination preferences, Obsidian vault name) and current transcription queue/state across browser restarts.

### `sidePanel`
> The extension's primary UI is a Chrome side panel that stays open beside the video being transcribed.

### `scripting`
> Registers content scripts dynamically based on which optional host permissions the user has granted, so newly enabled platforms (Vimeo, Twitch, etc.) get their detection script without a manifest update. Also used to inject the panel-scrape helper on demand when extracting captions from the YouTube transcript panel.

### `nativeMessaging`
> Used in local/self-host mode only. Lets the extension start and communicate with the open-source transcription service the user has installed on their own machine (see https://github.com/lifesized/transcriber). No data leaves the user's machine via this channel; the native host is invoked solely to manage the local service. Cloud mode does not exercise this permission.

## Required host permissions

### `http://localhost:19720/*` and `http://127.0.0.1:19720/*`
> The extension is the front-end for an open-source, locally hosted transcription service the user runs on their own machine (see https://github.com/lifesized/transcriber). When local mode is selected, the extension communicates only with this localhost service. No data leaves the user's machine.

### `https://transcribed.dev/*` and `https://www.transcribed.dev/*`
> The extension is also the front-end for the cloud transcription service at transcribed.dev. When cloud mode is selected, the extension authenticates via the user's signed-in browser session and submits transcription jobs to this host. Destination OAuth (Notion, etc.) also runs through transcribed.dev as a server-side proxy, so the extension does not need per-vendor host permissions.

### `*://*.youtube.com/*`
> Content script detects when the user navigates between YouTube videos so the side panel can update which video is "currently viewing." No DOM modification, no data collection — read-only metadata extraction (video ID from the URL).

### `*://open.spotify.com/*`
> Same as YouTube but for Spotify podcast episodes. Detects episode navigation so the side panel can transcribe the current episode.

## Optional permissions (requested at runtime, only when the user enables the feature)

### `notifications`
> Shows a desktop notification when a long-running transcription completes in the background, so the user doesn't have to keep the side panel open.

### `downloads`
> Saves transcripts as markdown or `.srt` subtitle files to the user's local Downloads folder.

### `clipboardWrite`
> "Copy as markdown" button — universal fallback for sending a transcript anywhere, when the user's destination isn't directly integrated.

### `contextMenus`
> Right-click shortcut on a supported video page to send the transcript directly to a connected destination.

## Optional host permissions (requested at runtime, only when the user enables the feature)

### `*://*.vimeo.com/*`, `*://podcasts.apple.com/*`, `*://*.twitch.tv/*`
> Same role as the YouTube/Spotify content scripts: detect video or episode navigation on these additional platforms. Requested only if the user opts into multi-platform support.

### `https://claude.ai/*` and `https://chatgpt.com/*`
> Powers the one-click "Summarize" feature. When the user clicks Summarize, the extension opens Claude.ai or chatgpt.com with the transcript pre-loaded as a prompt. The user can revoke this permission at any time via Chrome's extension settings; the rest of the extension continues to work without it.

## Permissions explicitly NOT requested

For reviewer reference, these are not declared anywhere in the manifest: `cookies`, `webRequest`, `webRequestBlocking`, `<all_urls>`, `history`, `bookmarks`, `geolocation`, `debugger`, `identity`, `proxy`, `management`. Destination OAuth is handled server-side via the cloud proxy at transcribed.dev, so the extension never needs `chrome.identity` or per-vendor API host permissions.

## Privacy policy

Live at: https://transcribed.dev/privacy/extension

## Data usage disclosures (Chrome Web Store form)

These match the categories the extension transmits to transcribed.dev in cloud mode. Local/self-host mode collects none of the categories below — everything stays on the user's machine.

| Category | Collected? | Notes |
|---|---|---|
| Personally identifiable information | **Yes** | Email address, collected when the user creates or signs in to a transcribed.dev account in cloud mode (via Supabase Auth). Not collected in local mode. |
| Health information | No | |
| Financial / payment information | No | Stripe runs in the transcribed.dev web app, not the extension. The extension never sees card numbers, billing addresses, or other payment data. |
| Authentication information | **Yes** | Cloud mode: a Supabase session cookie issued by transcribed.dev keeps the user signed in, plus any `ytt_sk_…` API keys the user generates in the dashboard for programmatic use. Not collected in local mode. |
| Personal communications | No | |
| Location | **Yes** | IP address is logged on the cloud server (transcribed.dev) for per-IP rate limiting (15 transcripts per IP per day) and abuse prevention. Not used for advertising, profiling, or precise geolocation. Not collected in local mode. |
| Web history | **Yes** | The URL of the specific YouTube or podcast page the user chooses to transcribe is sent to the server (cloud mode) or local service (local mode) so the source audio can be fetched. Sent only when the user triggers a transcription — never general browsing history. |
| User activity | No | No analytics, telemetry, click tracking, scroll tracking, keystroke logging, or session recording inside the extension. |
| Website content | **Yes** | The transcript text produced from the audio of the video or podcast the user chose. In cloud mode, stored in the user's transcribed.dev account so it's accessible from any device. In local mode, stored on the user's machine only. |

**Certifications (must check):**
- ☑ I do not sell or transfer user data to third parties outside of the approved use cases.
- ☑ I do not use or transfer user data for purposes unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.
