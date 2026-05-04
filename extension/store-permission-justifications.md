# Permission Justifications — Chrome Web Store Review

Paste these into the corresponding fields in the Chrome Web Store developer console when submitting. Each justification answers "why does this extension need this permission?"

## Single purpose statement

> Transcribe videos and podcasts the user is viewing, then optionally hand the transcript off to a destination (Notion, Obsidian, Claude, ChatGPT) of the user's choice.

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
> Registers content scripts dynamically based on which optional host permissions the user has granted, so newly enabled platforms (Vimeo, Twitch, etc.) get their detection script without a manifest update.

## Required host permissions

### `http://localhost:19720/*` and `http://127.0.0.1:19720/*`
> The extension is the front-end for an open-source, locally hosted transcription service the user runs on their own machine (see https://github.com/lifesized/youtube-transcriber). When local mode is selected, the extension communicates only with this localhost service. No data leaves the user's machine.

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

| Category | Collected? | Notes |
|---|---|---|
| Personally identifiable information | No | Cloud mode uses an existing transcribed.dev account; the extension itself does not register or collect identity. |
| Health information | No | |
| Financial / payment information | No | All payments handled by Stripe via transcribed.dev, never via the extension. |
| Authentication information | No | Cloud mode rides on the user's existing transcribed.dev session cookie; no credentials are stored in the extension. |
| Personal communications | No | |
| Location | No | |
| Web history | No | The extension only knows the URL of the tab the user actively clicked on. |
| User activity | No | No analytics or telemetry inside the extension. |
| Website content | Yes (limited) | Video / podcast URLs the user explicitly chooses to transcribe. Sent to localhost (local mode) or transcribed.dev (cloud mode). Not sold or shared. |

**Certifications (must check):**
- ☑ I do not sell or transfer user data to third parties outside of the approved use cases.
- ☑ I do not use or transfer user data for purposes unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.
