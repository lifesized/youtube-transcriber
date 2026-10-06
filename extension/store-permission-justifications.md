# Permission Justifications — Chrome Web Store Review

LOCAL build. Paste these into the Chrome Web Store developer console.

## Single purpose statement

> Send the URL of the page the user is viewing to the Transcriber app running on their own computer.

## Required permissions

### `activeTab`
> Reads the URL of the tab the user invoked the extension on, so the panel can send that page.

### `tabs`
> Reads the active tab URL while the side panel stays open, including when the user switches tabs, so **Send this page** targets the page they are looking at.

### `sidePanel`
> The extension UI is a side panel with one action: send the current page URL.

### `nativeMessaging`
> Asks the local Transcriber native host for the loopback API token and holds it in service-worker memory only long enough to authorize `POST /api/transcripts`. The token is not written to extension storage and is not placed in a URL.

## Required host permissions

### `http://127.0.0.1:19720/*` and `http://localhost:19720/*`
> The extension delivers the page URL only to Transcriber on the same computer. It does not contact a remote host.

## Permissions explicitly NOT requested

Not declared: `storage`, `scripting`, `cookies`, `webRequest`, `identity`, `notifications`, `<all_urls>`, `history`. The extension does not store secrets, does not inject content scripts, and does not request optional host access to cloud or LLM sites.

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
