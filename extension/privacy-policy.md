# Privacy Policy — YouTube Transcriber Chrome Extension

**Last updated:** March 27, 2026

## Overview

YouTube Transcriber is a browser extension that connects to a locally running transcription service on your machine. It is designed to keep your data private by default.

## Data Collection

This extension does **not** collect, transmit, or store any personal data on external servers.

Specifically:
- **No analytics or tracking** — we do not use Google Analytics, telemetry, or any third-party tracking.
- **No account required** — the extension works without sign-up or login.
- **No data leaves your machine** — all communication is between the extension and your local transcription service running on `localhost`.

## Data Stored Locally

The extension uses Chrome's `storage` API to save:
- **Session state** — current transcription progress and queue (cleared when the browser closes).
- **Local preferences** — the path to your local transcription service (persisted across sessions).

This data is stored entirely within your browser profile and is never transmitted externally.

## Permissions

The extension requests the following permissions:
- **activeTab / tabs** — to detect which YouTube video or Spotify episode you're viewing.
- **storage** — to persist transcription state and preferences locally.
- **sidePanel** — to display the transcription panel alongside your browsing.
- **scripting** — to register content scripts that detect video/episode pages.
- **Host permissions for localhost** — to communicate with your local transcription service.
- **Host permissions for youtube.com and open.spotify.com** — to inject content scripts that detect video and episode navigation.

## Third-Party Services

The extension communicates only with your locally running YouTube Transcriber service (`localhost:19720` by default). It does not contact any external APIs, servers, or services.

Your local transcription service may use third-party transcription providers (such as Groq or OpenAI) depending on your configuration — but this is configured and controlled by you in the local app, not by the extension.

## Changes

If this policy changes, the updated version will be posted at the same URL.

## Contact

For questions about this privacy policy, open an issue at:
https://github.com/lifesized/youtube-transcriber/issues
