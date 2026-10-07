# Permission Justifications — Chrome Web Store Review

LOCAL build. Paste these into the Chrome Web Store developer console.

## Single purpose statement

> Send the URL of the page the user is viewing to the Transcriber app running on their own computer. Optionally open Claude or ChatGPT with a summary prompt the user starts from Summarize.

## Required permissions

### `activeTab`
> Reads the URL of the tab the user invoked the extension on, so the panel can send that page.

### `tabs`
> Reads the active tab URL while the side panel stays open, including when the user switches tabs, so **Send this page** targets the page they are looking at.

### `sidePanel`
> The extension UI is a side panel with one action: send the current page URL.

### `nativeMessaging`
> Asks the local Transcriber native host for the loopback API token and holds it in service-worker memory only long enough to authorize `POST /api/transcripts`. The token is not written to extension storage and is not placed in a URL.

### `storage`
> Saves Settings (e.g. Summarize provider), Recent list metadata, and light panel diagnostics in the browser. Does not store API keys or the loopback auth token.

### `scripting`
> Enables programmatic injection of content scripts as a fallback when a tab was opened before the extension loaded (YouTube caption extraction, LLM handoff).

## Required host permissions

### `http://127.0.0.1:19720/*`
> The extension delivers the page URL only to Transcriber on the same computer. It does not contact a remote host.

## Optional host permissions

### `https://www.youtube.com/*` and `https://m.youtube.com/*`
> Optional. Requested only when you transcribe a YouTube video. Content script reads YouTube's native transcript panel DOM (if captions exist) to extract segments locally instead of downloading audio. Segments are sent to the local API (`127.0.0.1:19720`) only. Read-only — no cookies, no credentials, no external fetch from content script.

### `https://claude.ai/*` and `https://chatgpt.com/*`
> Optional. Requested only when you use **Summarize** with Claude or ChatGPT. Opens that site and places the summarize instruction **plus the full transcript** into the chat composer so you don't paste by hand. Does not read your Claude/ChatGPT history, does not store those accounts' credentials, and does not send transcript text to any server other than the provider page you already use.

## Permissions explicitly NOT requested

Not declared: `cookies`, `webRequest`, `identity`, `notifications`, `<all_urls>`, `history`. The extension does not connect to remote Transcriber hosts (`transcribed.dev`), does not sell data, and does not track browsing across sites.

## Data usage disclosures

| Category | Collected? | Notes |
|---|---|---|
| Personally identifiable information | No | No account in the extension. |
| Health information | No | |
| Financial / payment information | No | |
| Authentication information | No | The loopback token is used in memory as a request header and is not stored or transmitted off the machine. |
| Personal communications | No | |
| Location | No | |
| Web history | No | Only the single page URL the user chooses to send is posted to local Transcriber. General history is not read. |
| User activity | No | |
| Website content | No | The extension sends the page URL, not page contents. Transcription happens in the local app. |
