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
> Enables programmatic injection of content scripts as a fallback when a tab was opened before the extension loaded (YouTube caption extraction, LinkedIn video lookup, LLM handoff).

## Required host permissions

### `http://127.0.0.1:19721/*` and `http://127.0.0.1:19720/*`
> The extension delivers the page URL only to Transcriber on the same computer: the packaged app (`127.0.0.1:19721`) or a checkout (`127.0.0.1:19720`). It does not contact a remote host.

### `https://www.linkedin.com/*`
> Lets the user transcribe a LinkedIn post or a past LinkedIn Event they are viewing. LinkedIn only shows event recordings to signed-in members, so the local app can't fetch them by URL. A content script on `www.linkedin.com` observes LinkedIn video URLs the tab loads, in memory only, and sends one only when you press Transcribe. It keeps at most 50 of those URLs and clears them on navigation. On **Transcribe** it takes the video's LinkedIn CDN (`licdn.com`) address from the page's own embedded data, the `<video>` element, or those observed URLs, and sends the page URL, that CDN address, and the post's title and author only to Transcriber on `127.0.0.1`. The content script makes no network requests, doesn't read cookies or credentials, and doesn't write to extension storage. No other LinkedIn subdomain is requested.

## Optional host permissions

### `https://www.youtube.com/*` and `https://m.youtube.com/*`
> Optional. Requested only when you transcribe a YouTube video. Content script reads YouTube's native transcript panel DOM when captions exist, and if that panel is missing it reads the page's caption-track list and fetches same-origin `youtube.com` timedtext (`json3` or `vtt`) instead of downloading audio. Segments are sent to the local API (`127.0.0.1:19721` packaged, or `127.0.0.1:19720` checkout) only. Read-only — no cookies, no credentials, no off-site fetch. No new host permissions.

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
| Website content | Yes | Optionally reads YouTube caption/transcript panel text, or same-origin YouTube timedtext, when you transcribe a YouTube page (sent only to local Transcriber). When you transcribe a LinkedIn post or event, reads that video's LinkedIn CDN address, title, and author from the tab (sent only to local Transcriber). Optionally places the summarize instruction plus the full transcript into Claude or ChatGPT when you use Summarize. Does not read other page content or browsing history. |
