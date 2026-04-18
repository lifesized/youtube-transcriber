# Privacy Policy — YouTube Transcriber Chrome Extension

**Last updated:** March 31, 2026

## Overview

This browser extension transcribes videos and podcasts from supported web pages. It supports two modes: **local mode** (all processing on your machine) and **cloud mode** (processing via transcribed.dev). You choose which mode to use in the extension settings.

## Local Mode

In local mode, the extension communicates only with your locally running transcription service (`localhost:19720`).

- **No data leaves your machine** — audio, transcripts, and all processing stay local.
- **No account required** — works without sign-up or login.
- **No analytics or tracking** — we do not use telemetry or third-party tracking.

Your local transcription service may use third-party transcription providers (such as Groq or OpenAI) depending on your configuration — but this is configured and controlled by you in the local app, not by the extension.

## Cloud Mode

In cloud mode, the extension sends requests to `transcribed.dev` using your API key.

- **Data sent to the cloud** — the URL of the video or podcast episode you want to transcribe is sent to transcribed.dev for processing. Your signed-in session is sent with each request for authentication.
- **Account required** — you need a transcribed.dev account to use cloud mode.
- **Transcripts stored on the server** — completed transcripts are stored in your transcribed.dev account so you can access them from any device.
- **No analytics or tracking in the extension** — the extension itself does not use telemetry. The transcribed.dev service has its own privacy policy at https://www.transcribed.dev/privacy.

## Data Stored in Your Browser

The extension uses Chrome's `storage` API to save:
- **Sync storage** — your selected mode (local or cloud). This syncs across your Chrome devices.
- **Session storage** — current transcription progress and queue (cleared when the browser closes).
- **Local storage** — cached preferences (persisted across sessions).

This data is stored within your browser profile and managed by Chrome.

## Permissions

The extension requests the following permissions:
- **activeTab / tabs** — to detect which video or podcast episode you're viewing.
- **storage** — to persist settings, transcription state, and preferences.
- **sidePanel** — to display the transcription panel alongside your browsing.
- **scripting** — to register content scripts that detect video/episode pages.
- **Host permissions for localhost** — to communicate with your local transcription service.
- **Host permissions for transcribed.dev** — to communicate with the cloud transcription service (cloud mode only).
- **Host permissions for youtube.com and open.spotify.com** — to inject content scripts that detect video and episode navigation.

## Changes

If this policy changes, the updated version will be posted at the same URL.

## Contact

For questions about this privacy policy, open an issue at:
https://github.com/lifesized/youtube-transcriber/issues
