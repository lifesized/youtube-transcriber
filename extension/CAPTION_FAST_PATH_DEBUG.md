# Caption Fast-Path Debug Report

Date: 2026-04-28
Branch: `lifesized/ytt-224-extension-inpanel-auth`

## Summary

The Chrome extension's client-side YouTube caption fast path successfully discovers caption tracks in the page, but fails when trying to fetch the caption payload from `captionTracks[].baseUrl`.

This means the current architecture can prove captions exist, but cannot reliably retrieve the transcript body from the browser context.

## Confirmed Working

1. Content scripts register correctly in both ISOLATED and MAIN worlds.
2. Existing-tab reinjection is working.
3. `background.js -> tryExtractCaptions()` successfully reaches the YouTube tab.
4. `content-captions-main.js` can read `movie_player.getPlayerResponse()`.
5. `captionTracks` are present and non-empty on captioned videos.
6. `content.js` cache is correctly keyed by `videoId`.
7. `EXTRACT_CAPTIONS` sees `stale: false` and `freshTracksLen: 1` on live repros.

## Confirmed Failing

For multiple captioned videos, the timedtext URL in `captionTracks[].baseUrl` fails the same way across transports:

- ISOLATED `fetch()`
- MAIN-world `fetch()`
- MAIN-world `XMLHttpRequest`
- with `fmt=json3`
- and with the raw `baseUrl`

Observed result in every case:

- HTTP `200`
- `content-type: text/html; charset=UTF-8`
- `bodyLength: 0`
- `finalUrl` unchanged (not a redirect)

## Key Conclusion

The problem is not caption discovery. The problem is that `captionTracks[].baseUrl` is not a reliable client-side transcript source in this extension/browser context.

Continuing to iterate on transport or parser logic is unlikely to solve the UX problem.

## Recommended Direction

Replace the current browser fast path ordering with:

1. Transcript-panel / transcript-renderer extraction on the YouTube page.
2. Existing remote `yt-dlp` subtitle extraction fallback.
3. Whisper/audio fallback only when captions are truly unavailable.

## Why This Route

- Other fast transcript extensions likely do not depend on direct `captionTracks[].baseUrl` fetches from content scripts.
- The transcript panel is a user-visible YouTube surface and is more likely to be stable in-browser than the signed timedtext URL.
- The existing remote worker path already works; it is only too slow because it re-discovers captions remotely.

## Implementation Notes

- A first-pass transcript-panel client extractor should:
  - detect/open the transcript panel from the watch page
  - wait for transcript rows to render
  - scrape timestamps + text from DOM
  - return normalized segments to the background
- Keep the `baseUrl` path as a secondary debug fallback only while the transcript-panel path is being proven.
