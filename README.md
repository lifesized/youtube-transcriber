# YouTube Transcript Capture

A local-first web app to capture, store, and browse transcripts from YouTube videos. No API keys required.

## Features

- Paste any YouTube URL to capture its transcript
- Time-coded transcript display with timestamps
- Video metadata (title, author, thumbnail, channel link)
- Transcript library with search and filtering
- Download transcripts as Markdown files
- Duplicate detection (same video won't be saved twice)
- Local SQLite storage via Prisma

## Tech Stack

- Next.js 16 (App Router, TypeScript)
- Tailwind CSS v4
- Prisma ORM with SQLite
- YouTube InnerTube API (direct, no API key needed)

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
git clone https://github.com/lifesized/youtube-transcriber.git
cd youtube-transcriber
npm install
npx prisma migrate dev
```

### Usage

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## How It Works

The app uses YouTube's InnerTube API directly to fetch public caption tracks (auto-generated or manual) and the YouTube oEmbed API for video metadata. No external transcript packages or YouTube Data API keys are needed.

1. Paste a YouTube URL on the home page
2. The server extracts the video ID, fetches captions and metadata in parallel
3. The transcript and metadata are stored in a local SQLite database
4. Browse, search, and download saved transcripts from the library

## Project Structure

```
app/
  page.tsx                          # Home — URL input form
  library/page.tsx                  # Library — saved transcript grid
  transcripts/[id]/page.tsx         # Transcript detail viewer
  api/transcripts/
    route.ts                        # POST (capture) / GET (list)
    [id]/route.ts                   # GET / DELETE single transcript
    [id]/download/route.ts          # GET markdown download
lib/
  transcript.ts                     # Transcript + metadata fetching
  youtube.ts                        # YouTube URL parsing / video ID extraction
  types.ts                          # Shared TypeScript types
  prisma.ts                         # Prisma client singleton
prisma/
  schema.prisma                     # Database schema (Video model)
```

## License

ISC
