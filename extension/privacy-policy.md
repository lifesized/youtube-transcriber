# Privacy Policy — Transcriber for YouTube Chrome Extension

**Last updated:** October 8, 2026

## Overview

This is the local build of Transcriber for YouTube. It sends the URL of the page you choose to the Transcriber app running on your computer (`http://127.0.0.1:19721` for the packaged menu-bar app, or `http://127.0.0.1:19720` for a checkout). Transcription and library storage happen in that app, not in the extension.

The extension does not collect analytics, does not track your browsing, and does not sell or share data with advertisers.

## What the extension sends

When you click **Send this page**, the extension sends that page URL to your local Transcriber. The request includes a loopback `Authorization` header so the local API can accept it.

- The token is read from the native messaging host into the extension service worker's memory for that request.
- The token is not written to `chrome.storage`, not put in a query string, and not shown in the panel.
- The extension does not ask for or store provider API keys.

**YouTube caption extraction (optional):** If you transcribe a YouTube video with captions, the extension may read those captions directly from YouTube's native transcript panel DOM and send the extracted segments to the local API (`127.0.0.1:19721` packaged, or `127.0.0.1:19720` checkout) instead of downloading audio. Content script is read-only — no cookies, no credentials, no external fetch.

**LinkedIn posts and events:** When you press **Transcribe** on a LinkedIn post or a past LinkedIn Event, the extension finds that video's LinkedIn CDN (`licdn.com`) address in your open tab and sends the page URL, that address, and the post's title and author to your local Transcriber. Your local app then downloads the video from LinkedIn's CDN. The LinkedIn content script remembers up to 50 LinkedIn video addresses the tab has loaded, in that tab's memory only, and forgets them when you navigate. It doesn't read cookies or credentials, makes no network requests, and stores nothing. For a LinkedIn post you paste or queue without its tab open, the extension sends only the post URL, and your local Transcriber app fetches the public post page itself.

**Slack (Tusk):** Tusk is a Socket Mode bot inside the Transcriber menu-bar app, not this extension. When you paste a YouTube URL in an allowlisted Slack channel, the app transcribes and summarizes it locally and posts the result (and sometimes a transcript file) to that channel. Anyone in that channel can see those posts, including Slack Connect members if the channel is allowlisted. In-thread `@Tusk` questions and the transcript go to the LLM provider configured in Transcriber Settings.

If you add YouTube channel or playlist IDs to the Tusk watchlist in Settings, the menu-bar app polls YouTube’s public `https://www.youtube.com/feeds/videos.xml` Atom feed (ETag / If-Modified-Since, size-capped) and, for new public videos, transcribes and summarizes them locally, then posts one digest to the allowlisted digest channel you chose. The extension does not poll RSS and does not talk to Slack.

**Summarize (optional):** If you pick Claude or ChatGPT, the extension may open that site and place a prepared prompt (summarize instruction plus the full transcript) into the composer (content script on those hosts only, only during a handoff). Without your Summarize action, that script does nothing. Prompt text stays on your machine / in that provider tab — the extension does not upload it elsewhere.

No data is sent to a remote Transcriber host. The extension does not contact `transcribed.dev`.

**Packaged app updates (Developer ID builds only):** A notarized, Developer ID–signed Transcriber.app may check GitHub Releases for `lifesized/youtube-transcriber` (one HTTPS request for `latest-mac.yml` / release metadata; a download only after an update is offered). Ad-hoc, unsigned, and `electron:dev` builds never initialize the updater and make no GitHub calls. The extension itself never checks for app updates.

## Data stored in the browser

The extension uses `chrome.storage` to save Settings (e.g. Summarize provider), Recent list metadata, and light panel diagnostics. Does not store API keys or the loopback auth token.

The page URL is shown in the side panel only while that panel is open.

## Permissions

- **`activeTab`** and **`tabs`** — read the URL of the tab you are viewing so the panel can send that page.
- **`sidePanel`** — show the send panel.
- **`nativeMessaging`** — ask the local Transcriber host for the loopback token. The token is not retained in extension storage.
- **`storage`** — save Settings (e.g. Summarize provider), Recent list metadata, and light panel diagnostics. Does not store API keys or the loopback auth token.
- **`scripting`** — enables programmatic injection of content scripts as a fallback when a tab was opened before the extension loaded.
- **`http://127.0.0.1:19721/*`** and **`http://127.0.0.1:19720/*`** — deliver the page URL to Transcriber on this computer: the packaged app (`127.0.0.1:19721`) or a checkout (`127.0.0.1:19720`).
- **`https://www.linkedin.com/*`** — find the video address of the LinkedIn post or event you transcribe (see above).

### Optional host permissions (requested only when used)

- **`https://www.youtube.com/*` and `https://m.youtube.com/*`** — requested only when you transcribe a YouTube video. Content script reads YouTube's native transcript panel DOM (if captions exist) to extract segments locally. Read-only — no cookies, no credentials, no external fetch.
- **`https://claude.ai/*` and `https://chatgpt.com/*`** — requested only when you use **Summarize** with Claude or ChatGPT. Opens that site and places the summarize instruction plus the full transcript into the chat composer. Does not read your Claude/ChatGPT history or store credentials.

## What we don't do

- We don't sell or share your data with advertisers.
- We don't use cross-site tracking, remote telemetry, or analytics in the extension.
- We don't read pages other than the URL of the tab you send, except the YouTube captions and LinkedIn video details described above.
- We don't store API keys, local auth tokens, or other secrets in the extension.

## Contact

- Email: <support@transcribed.dev>
- Or open an issue: <https://github.com/lifesized/youtube-transcriber/issues>
