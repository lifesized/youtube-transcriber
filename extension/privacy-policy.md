# Privacy Policy — Transcriber for YouTube Chrome Extension

**Last updated:** April 26, 2026

## Overview

Transcriber for YouTube transcribes videos and podcasts you choose, then optionally hands the transcript off to a destination of your choice (Obsidian, Notion, Claude, ChatGPT, etc.). It supports two modes: **local mode** (all processing on your own machine) and **cloud mode** (processing via transcribed.dev). You choose which mode to use in extension settings.

The extension itself does not collect analytics, does not track your browsing, and does not sell or share data with advertisers.

## Local Mode

In local mode, the extension communicates only with your locally running transcription service at `http://localhost:19720` / `http://127.0.0.1:19720`.

- **No data leaves your machine.** Audio, transcripts, and all processing stay local.
- **No account required.** Works without sign-up, login, or network calls to transcribed.dev.
- **No telemetry or third-party tracking.**

Your local transcription service may use third-party providers (such as Groq or OpenAI) depending on how you have configured the open-source app — but that is configured and controlled by you in the local app, not by the extension.

## Cloud Mode

In cloud mode, the extension communicates with `transcribed.dev` using your signed-in browser session.

- **Data sent to the cloud.** The URL of the video or podcast you want to transcribe is sent to transcribed.dev for processing.
- **Account required.** Sign-in to transcribed.dev is required for cloud mode.
- **Transcripts stored on the server.** Completed transcripts are stored in your transcribed.dev account so you can access them from any device.
- **Cloud service privacy policy.** The transcribed.dev service has its own privacy policy at <https://transcribed.dev/privacy> covering server-side data handling, retention, and third-party processors.

### Transcripts are not used to train AI models

Neither the extension, transcribed.dev, nor the third-party transcription providers we use are permitted to use your transcripts to train AI models. This is enforced contractually with our processors.

## Destinations (Send-to integrations)

You can optionally send finished transcripts to a destination of your choice. Destinations fall into two categories:

**Client-side destinations** — handled entirely in your browser via URL schemes. The extension does not store credentials or tokens for these:

- **Obsidian** (`obsidian://`) — opens your local Obsidian app to create or update a note.

**Cloud-proxied destinations** — OAuth and credential handling run server-side on transcribed.dev. The extension never sees or stores destination access tokens; it only knows whether you have a destination connected:

- **Notion** — sends transcript to a page in your Notion workspace.

Additional destinations may be added in the future server-side without an extension update. Any new destination will be listed here and announced before it goes live.

## LLM handoff (optional)

The extension includes a one-click "Summarize" affordance that opens **Claude** (`https://claude.ai`) or **ChatGPT** (`https://chatgpt.com`) with the transcript pre-loaded as a prompt. This requires an opt-in host permission grant:

- The transcript text is passed to the LLM site only when you click the summarize button.
- The extension does not log the conversation or read the LLM's response.
- Claude and ChatGPT each have their own privacy policies that cover what happens to the prompt once it leaves the extension.

You can decline or revoke these host permissions at any time via Chrome's extensions settings.

## Data Stored in Your Browser

The extension uses Chrome's `storage` API to save:

- **Sync storage** — selected mode (local or cloud) and connector preferences. Syncs across your Chrome devices via your Google account.
- **Session storage** — current transcription progress and queue (cleared when the browser closes).
- **Local storage** — cached preferences (persisted across sessions).

This data is stored within your browser profile and managed by Chrome. The extension does not transmit this data anywhere except as described in the modes above.

## Permissions

Required permissions (declared in the manifest):

- **`activeTab`** — read the current tab's URL to detect a supported video or podcast page.
- **`tabs`** — open completion redirects (e.g. OAuth callbacks) and `obsidian://` URL-scheme links to deliver transcripts.
- **`storage`** — persist settings, transcription state, and preferences.
- **`sidePanel`** — display the transcription panel alongside your browsing.
- **`scripting`** — register content scripts dynamically based on which optional host permissions you have granted.

Optional permissions (requested only when the relevant feature is used):

- **`notifications`** — show completion status for background transcription jobs.
- **`downloads`** — save transcripts as markdown or subtitle files to your local filesystem.
- **`clipboardWrite`** — copy transcripts to the clipboard as a universal fallback for unsupported destinations.
- **`contextMenus`** — right-click shortcut to send transcripts to connected destinations.

Required host permissions (declared in the manifest):

- **`http://localhost:19720/*`, `http://127.0.0.1:19720/*`** — communicate with your local transcription service in local mode.
- **`https://transcribed.dev/*`, `https://www.transcribed.dev/*`** — communicate with the cloud transcription service in cloud mode, including the cloud OAuth proxy used for destination connections.
- **`*://*.youtube.com/*`** — inject content scripts that detect video navigation on YouTube.
- **`*://open.spotify.com/*`** — inject content scripts that detect podcast episode navigation on Spotify.

Optional host permissions (requested only when the relevant feature is used):

- **`*://*.vimeo.com/*`, `*://podcasts.apple.com/*`, `*://*.twitch.tv/*`** — additional video / podcast source platforms.
- **`https://claude.ai/*`, `https://chatgpt.com/*`** — opt-in LLM handoff for the summarize feature described above.

## What we don't do

- We don't sell or share your data with advertisers.
- We don't use cross-site tracking cookies, pixels, or fingerprinting.
- We don't read or transmit pages other than the supported video / podcast pages you transcribe.
- We don't access your YouTube, Spotify, or other source-platform credentials.
- We don't store destination access tokens inside the extension. Cloud-proxied destinations (e.g. Notion) keep tokens server-side on transcribed.dev; client-side destinations (e.g. Obsidian) require no tokens at all.
- We don't include third-party analytics, telemetry, or A/B tooling inside the extension.

## Data retention and deletion

- **Local mode:** all data lives on your machine. Delete the local app and your browser profile to remove everything.
- **Cloud mode:** transcripts are kept in your transcribed.dev account until you delete them. Deleting your transcribed.dev account permanently removes all associated data. See the cloud privacy policy at <https://transcribed.dev/privacy> for details.

## Children

The extension is not intended for users under 13 years of age. We do not knowingly collect personal information from children.

## Changes

If this policy changes, the updated version will be posted at the same URL with a new "Last updated" date. Material changes will be announced in extension release notes.

## Contact

For privacy questions or data requests:

- Email: <support@transcribed.dev>
- Or open an issue: <https://github.com/lifesized/youtube-transcriber/issues>
