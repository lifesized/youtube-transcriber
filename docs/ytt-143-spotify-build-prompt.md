# YTT-143: Add Spotify Podcast Transcription Support — Build Prompt

## Objective

Extend the YouTube Transcriber app to support Spotify podcast episode URLs. Users paste a `open.spotify.com/episode/...` URL and get a transcript, just like YouTube today. This is the first non-YouTube source — architecture should be generic enough to add more platforms later without major rewrites.

## Branch

Create and work on branch `feat/ytt-143-spotify-support` off `main`.

## Scope: MVP

Build the MVP tier: **metadata + native Spotify transcript API only** (no audio download). This covers many podcasts, is fast to build, and avoids ToS issues.

Fallback chain for Spotify:
1. Spotify native transcript (internal `transcript-read-along` API) — fast, free, time-synced
2. If no transcript available, return a clear error: "This episode doesn't have a transcript available on Spotify. Audio transcription for Spotify is not yet supported."

Audio download + Whisper fallback for Spotify is out of scope for this ticket.

---

## Research Summary

### Spotify Native Transcripts

- **No official API endpoint.** The Spotify Web API returns only metadata.
- **Undocumented internal API:** `GET https://spclient.wg.spotify.com/transcript-read-along/v2/episode/{episode_id}?format=json`
  - Returns time-synced JSON with word-level or segment-level timestamps
  - Requires `sp_dc` cookie auth — this is NOT standard OAuth. The user must provide their `sp_dc` cookie value from a logged-in Spotify browser session.
  - To get a bearer token: `GET https://open.spotify.com/get_access_token` with cookie `sp_dc={value}`
  - Coverage is incomplete — not all podcasts have transcripts
  - Can break at any time (undocumented)
- **Transcript format (JSON):** Contains sections with words, each having `startMs` and `endMs` timestamps. This maps directly to our existing `TranscriptSegment` type (`text`, `startMs`, `durationMs`).

### Spotify Metadata API

- **Endpoint:** `GET https://api.spotify.com/v1/episodes/{id}?market=US`
- **Auth:** Client Credentials flow (server-to-server, no user login)
  ```
  POST https://accounts.spotify.com/api/token
  Content-Type: application/x-www-form-urlencoded
  Authorization: Basic base64(client_id:client_secret)
  grant_type=client_credentials
  ```
- **Response fields we need:**
  - `name` → title
  - `show.name` → author
  - `show.external_urls.spotify` → channelUrl (show URL)
  - `images[0].url` → thumbnailUrl (640px cover art)
  - `duration_ms` → duration
  - `external_urls.spotify` → videoUrl (episode URL)
- **Credentials:** `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET` env vars. Free app at developer.spotify.com/dashboard.
- **Rate limits:** ~100-180 req/30s per token. Returns 429 with `Retry-After` header.

### URL Parsing

- Format: `https://open.spotify.com/episode/{id}?si=...`
- Episode ID: 22-character alphanumeric string after `/episode/`
- The `?si=` param is a tracking token — ignore it

---

## Current Architecture (what exists)

### Key files and their roles:

- `lib/youtube.ts` — Extracts YouTube video ID from URL (11-char regex validation)
- `lib/transcript.ts` — Main transcript pipeline. Exports `getVideoTranscript(url, lang)` which:
  1. Calls `extractVideoId(url)` to parse URL
  2. Fetches metadata via YouTube oEmbed API
  3. Runs fallback chain: WEB scrape → yt-dlp subs → InnerTube → Whisper
  4. Returns `VideoTranscriptResult & { source: string }`
- `lib/types.ts` — Shared types:
  ```ts
  interface TranscriptSegment { text: string; startMs: number; durationMs: number; speaker?: string; }
  interface VideoMetadata { videoId: string; title: string; author: string; channelUrl: string; thumbnailUrl: string; }
  interface VideoTranscriptResult extends VideoMetadata { transcript: TranscriptSegment[]; }
  ```
- `lib/whisper.ts` — Local Whisper transcription + yt-dlp audio download
- `lib/whisper-cloud.ts` — Cloud Whisper (Groq/OpenRouter)
- `lib/providers.ts` — Provider config management
- `lib/progress.ts` — SSE progress events
- `app/api/transcripts/route.ts` — POST handler: receives `{ url, lang }`, calls `extractVideoId()`, checks for duplicates, calls `getVideoTranscript()`, saves to Prisma
- `prisma/schema.prisma` — Video model with `videoId @unique`, `source` field, no platform field
- `app/page.tsx` — Frontend with URL input (placeholder: "https://www.youtube.com/watch?v=...")
- `extension/content.js` — Chrome extension, YouTube-only

### Prisma Video model (current):
```prisma
model Video {
  id           String   @id @default(cuid())
  videoId      String   @unique
  title        String
  author       String
  channelUrl   String?
  thumbnailUrl String?
  videoUrl     String
  transcript   String   // JSON stringified TranscriptSegment[]
  source       String   @default("youtube_captions")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

---

## Implementation Plan

### 1. Prisma Schema Update

Add a `platform` field to the Video model:

```prisma
model Video {
  // ... existing fields ...
  platform     String   @default("youtube")  // "youtube" | "spotify"
}
```

Run `npx prisma migrate dev --name add-platform-field` after the change.

### 2. URL Detection — `lib/url-parser.ts` (new file)

Create a unified URL parser that detects the platform and extracts the content ID:

```ts
type Platform = "youtube" | "spotify";

interface ParsedUrl {
  platform: Platform;
  contentId: string;  // YouTube video ID (11 chars) or Spotify episode ID (22 chars)
  originalUrl: string;
}

function parseContentUrl(url: string): ParsedUrl { ... }
```

- Detect YouTube: existing logic from `lib/youtube.ts`
- Detect Spotify: match `open.spotify.com/episode/{22-char-id}`
- Throw descriptive error for unsupported URLs
- Keep `lib/youtube.ts` working (don't break imports) but the API route should use the new parser

### 3. Spotify Module — `lib/spotify.ts` (new file)

This is the core new module. It should handle:

**a) Spotify API auth (Client Credentials):**
- Read `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` from env
- Token caching (tokens last 3600s, cache and refresh before expiry)
- Return bearer token for metadata API calls

**b) Metadata fetching:**
- `fetchSpotifyMetadata(episodeId: string): Promise<VideoMetadata>`
- Call `GET /v1/episodes/{id}?market=US` with bearer token
- Map response to `VideoMetadata` interface:
  - `videoId` = episode ID
  - `title` = `name`
  - `author` = `show.name`
  - `channelUrl` = `show.external_urls.spotify`
  - `thumbnailUrl` = `images[0].url`

**c) Transcript fetching (internal API):**
- `fetchSpotifyTranscript(episodeId: string): Promise<TranscriptSegment[]>`
- Read `SPOTIFY_SP_DC` from env (the user's sp_dc cookie value)
- Get access token: `GET https://open.spotify.com/get_access_token` with `Cookie: sp_dc={value}`
- Fetch transcript: `GET https://spclient.wg.spotify.com/transcript-read-along/v2/episode/{id}?format=json` with bearer token
- Parse the JSON response into `TranscriptSegment[]` (map word/segment timestamps to `startMs`/`durationMs`)
- If no `SPOTIFY_SP_DC` configured or transcript unavailable, throw a clear error

**d) Main entry point:**
- `getSpotifyTranscript(url: string): Promise<VideoTranscriptResult & { source: string }>`
- Parse episode ID from URL
- Fetch metadata and transcript in parallel
- Return combined result with `source: "spotify_transcript"`

### 4. Update Transcript Pipeline — `lib/transcript.ts`

Modify `getVideoTranscript()` to be platform-aware:

```ts
export async function getVideoTranscript(
  url: string,
  lang?: string
): Promise<VideoTranscriptResult & { source: string }> {
  const parsed = parseContentUrl(url);  // new unified parser

  if (parsed.platform === "spotify") {
    return getSpotifyTranscript(url);
  }

  // Existing YouTube flow (unchanged)
  const videoId = parsed.contentId;
  // ... rest of existing code
}
```

This is a minimal change — just add the platform detection at the top and route to the Spotify handler.

### 5. Update API Route — `app/api/transcripts/route.ts`

- Replace `extractVideoId(url)` with `parseContentUrl(url)` for URL validation
- Use `parsed.contentId` as the `videoId` for duplicate detection
- Update error messages to not say "YouTube" when it's a Spotify URL
- Add `platform` field to Prisma create/update calls

### 6. Update Frontend — `app/page.tsx`

- Change the input placeholder to `"Paste a YouTube or Spotify podcast URL..."`
- No other frontend changes needed for MVP (the existing UI displays transcripts the same way regardless of source)

### 7. Settings UI (optional for MVP)

Consider adding a Spotify section to settings for:
- `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` — needed for metadata
- `SPOTIFY_SP_DC` — needed for transcript API

If you skip the settings UI, just document that these go in `.env`.

---

## Environment Variables

Add to `.env.example` and document:

```
# Spotify (optional — enables Spotify podcast transcription)
SPOTIFY_CLIENT_ID=       # From developer.spotify.com/dashboard
SPOTIFY_CLIENT_SECRET=   # From developer.spotify.com/dashboard
SPOTIFY_SP_DC=           # Your sp_dc cookie from open.spotify.com (for transcript access)
```

---

## Error Handling

- **No Spotify credentials configured:** "Spotify transcription requires API credentials. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to your .env file."
- **Invalid Spotify URL:** "Could not extract episode ID from URL. Supported format: open.spotify.com/episode/{id}"
- **Episode not found (404):** "Spotify episode not found — it may have been removed or is not available in your market."
- **No sp_dc cookie:** "Spotify transcript access requires your sp_dc cookie. Add SPOTIFY_SP_DC to your .env file."
- **Transcript unavailable:** "This Spotify episode doesn't have a transcript available. Audio transcription for Spotify is not yet supported."
- **Rate limited (429):** Respect `Retry-After` header, same pattern as existing YouTube retry logic.

---

## Testing

1. **URL parser tests:** Test YouTube URLs still work, test various Spotify URL formats (`open.spotify.com/episode/{id}`, with `?si=` params, etc.)
2. **Manual E2E test:** Paste a known Spotify podcast episode URL, verify metadata displays correctly and transcript loads
3. **Error cases:** Test with invalid URLs, missing credentials, episodes without transcripts

---

## What NOT to change

- Do not modify the existing YouTube transcript pipeline (keep it working exactly as-is)
- Do not rename `lib/youtube.ts` — other files import from it
- Do not touch the Chrome extension (Spotify tab detection is a separate ticket)
- Do not add audio download / Whisper fallback for Spotify (out of scope)
- Do not add settings UI unless it's trivial (env vars are fine for MVP)

---

## Git Rules

- Commit/push only when explicitly asked
- No Claude attribution in commit messages
- Use feature branch `feat/ytt-143-spotify-support`
