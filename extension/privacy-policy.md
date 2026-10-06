# Privacy Policy — Transcriber for YouTube Chrome Extension

**Last updated:** October 6, 2026

## Overview

This is the local build of Transcriber for YouTube. It sends the URL of the page you choose to the Transcriber app running on your computer (`http://127.0.0.1:19720`). Transcription and library storage happen in that app, not in the extension.

The extension does not collect analytics, does not track your browsing, and does not sell or share data with advertisers.

## What the extension sends

When you click **Send this page**, the extension sends that page URL to your local Transcriber. The request includes a loopback `Authorization` header so the local API can accept it.

- The token is read from the native messaging host into the extension service worker's memory for that request.
- The token is not written to `chrome.storage`, not put in a query string, and not shown in the panel.
- The extension does not ask for or store provider API keys.

No data is sent to a remote Transcriber host. The extension does not contact `transcribed.dev`.

## Data stored in the browser

The extension does not use `chrome.storage`. It does not keep a queue, account, mode, or token on disk.

The page URL is shown in the side panel only while that panel is open.

## Permissions

- **`activeTab`** and **`tabs`** — read the URL of the tab you are viewing so the panel can send that page.
- **`sidePanel`** — show the send panel.
- **`nativeMessaging`** — ask the local Transcriber host for the loopback token. The token is not retained in extension storage.
- **`http://127.0.0.1:19720/*`** and **`http://localhost:19720/*`** — deliver the page URL to Transcriber on this computer.

## What we don't do

- We don't sell or share your data with advertisers.
- We don't use cross-site tracking, remote telemetry, or analytics in the extension.
- We don't read pages other than the URL of the tab you send.
- We don't store API keys, local auth tokens, or other secrets in the extension.

## Contact

- Email: <support@transcribed.dev>
- Or open an issue: <https://github.com/lifesized/youtube-transcriber/issues>
