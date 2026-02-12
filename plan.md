# YouTube Transcript Capture App — Plan

## Goal

Build a single-user Next.js web app that captures transcripts from any YouTube video by URL, displays them with time-coded text, and stores them in a browsable library with markdown download.

## Tasks

### Wave 1 (parallel)

1. **Project scaffolding and data layer**
   - Initialize Next.js 14+ (App Router, TypeScript, Tailwind CSS)
   - Install and configure Prisma with SQLite
   - Define schema: `Video` model (id, videoId (unique), title, author, channelUrl, thumbnailUrl, videoUrl, transcript (Prisma `Json`: `Array<{ text, startMs, durationMs }>`), createdAt, updatedAt)
   - Generate Prisma client
   - Project structure: `app/`, `lib/`, `components/`, `prisma/`

2. **YouTube transcript and metadata fetching**
   - `lib/youtube.ts` — parse video ID from various YouTube URL formats (watch, short, embed, youtu.be)
   - `lib/transcript.ts` — fetch transcript via `youtube-transcript` package and metadata via `youtubei.js` (fallback to YouTube oEmbed if needed)
   - Return structured data: `{ videoId, title, author, channelUrl, thumbnailUrl, transcript: Array<{ text, startMs, durationMs }> }`
   - Error handling for: invalid URL, no captions available, private/unavailable video

### Wave 2 (depends on Wave 1)

3. **API routes for transcript capture and library**
   - Implement as Next.js App Router route handlers under `app/api/.../route.ts`
   - `POST /api/transcripts` — accept YouTube URL, fetch transcript + metadata, save to DB (detect duplicates by `videoId` unique constraint; return existing row if already saved)
   - `GET /api/transcripts` — list all saved transcripts (with optional `q` search query param; matches title + author only)
   - `GET /api/transcripts/[id]` — get single transcript with full data
   - `DELETE /api/transcripts/[id]` — delete a saved transcript
   - `GET /api/transcripts/[id]/download` — return `.md` file download

### Wave 3 (parallel, depends on Wave 2)

4. **Frontend: capture page and transcript viewer**
   - Home page (`/`): URL input form, loading state, error display, redirect to transcript on success
   - Transcript detail page (`/transcripts/[id]`): video metadata header, time-coded transcript body, download button, back to library link

5. **Frontend: transcript library page**
   - Library page (`/library`): card grid of saved transcripts with thumbnail, title, author, date
   - Search/filter bar
   - Delete button per card with confirmation
   - Empty state when no transcripts saved

## Tech Stack

- **Framework**: Next.js 14+ (App Router, TypeScript)
- **Styling**: Tailwind CSS
- **Database**: SQLite via Prisma ORM
- **Transcript**: `youtube-transcript` package
- **Metadata**: `youtubei.js` package (or oembed fallback)
- **No external API keys required**

## Acceptance Criteria

- User can paste any YouTube URL and capture its transcript
- Saved transcripts include: video title, author, video link, time-coded text, capture date
- Library page lists all saved transcripts with thumbnail, title, author, date
- Search/filter works on the library page (search matches title + author only)
- Transcripts are downloadable as `.md` files with a simple format:
  - Title
  - Video URL
  - Captured date
  - Transcript lines as `- [mm:ss] text`
- Duplicate URLs are detected (by `videoId`) and return the existing transcript
- Errors (invalid URL, no captions, private video) display clear messages
- App runs locally with `npm run dev` — no external API keys required

## Non-goals

- User authentication / multi-user support
- AI-based speaker diarization (YouTube captions don't include speaker labels; we show what YouTube provides)
- Video downloading or playback within the app
- Browser extension
- Deployment / hosting (local-only for now)

## Assumptions

- YouTube videos have captions/subtitles available (auto-generated or manual)
- Videos are publicly accessible (not private or age-restricted)
- `youtube-transcript` and `youtubei.js` npm packages work without API keys
- SQLite is sufficient for single-user local storage

## Verification Plan

1. `npm run dev` starts without errors
2. `npx tsc --noEmit` passes
3. Capture a transcript from a known YouTube video
4. Verify library listing shows the saved transcript
5. Download the `.md` file and verify formatting
6. Test error handling with an invalid URL
7. Test duplicate detection with the same URL
