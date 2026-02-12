import { Metadata } from "next";

export const metadata: Metadata = {
  title: "About YouTube Transcriber",
  description: "Learn about why this project exists and how it works",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-semibold text-white/90">About YouTube Transcriber</h1>
        </div>

        {/* The Problem */}
        <section className="space-y-3 rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-6">
          <h2 className="text-xl font-medium text-white/80">The Problem</h2>
          <p className="text-sm leading-relaxed text-white/60">
            Transcription services are expensive. I burned through my allowed transcriptions in under a week while trying to capture and archive YouTube content for research and reference. The cost quickly became unsustainable, and I needed a solution that would let me transcribe as much as I wanted without worrying about quotas or pricing tiers.
          </p>
          <p className="text-sm leading-relaxed text-white/60">
            This tool was built to solve that problem. Instead of relying on paid APIs, it uses local transcription with OpenAI Whisper, which means unlimited transcriptions at zero marginal cost.
          </p>
        </section>

        {/* Technology Stack */}
        <section className="space-y-3 rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-6">
          <h2 className="text-xl font-medium text-white/80">Technology Stack</h2>
          <div className="space-y-4">
            <div>
              <h3 className="mb-1.5 text-sm font-medium text-white/70">Core Framework</h3>
              <ul className="space-y-1 text-sm text-white/60">
                <li>• Next.js 15 (App Router)</li>
                <li>• React 19</li>
                <li>• TypeScript</li>
                <li>• Tailwind CSS</li>
              </ul>
            </div>
            <div>
              <h3 className="mb-1.5 text-sm font-medium text-white/70">Data & Storage</h3>
              <ul className="space-y-1 text-sm text-white/60">
                <li>• Prisma ORM</li>
                <li>• SQLite (local database)</li>
              </ul>
            </div>
            <div>
              <h3 className="mb-1.5 text-sm font-medium text-white/70">Transcription</h3>
              <ul className="space-y-1 text-sm text-white/60">
                <li>• OpenAI Whisper (CPU/MPS modes)</li>
                <li>• MLX Whisper (Apple Silicon optimized)</li>
                <li>• yt-dlp (audio extraction)</li>
                <li>• YouTube captions API (fallback)</li>
              </ul>
            </div>
            <div>
              <h3 className="mb-1.5 text-sm font-medium text-white/70">Design</h3>
              <ul className="space-y-1 text-sm text-white/60">
                <li>• Geist fonts (Sans, Mono, Pixel)</li>
                <li>• Custom greyscale theme with sepia accents</li>
                <li>• Single-page responsive layout</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Evolution */}
        <section className="space-y-3 rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-6">
          <h2 className="text-xl font-medium text-white/80">Changelog & Evolution</h2>
          <div className="space-y-4 text-sm">
            <div>
              <h3 className="mb-1 font-mono text-xs uppercase tracking-wider text-white/45">
                Phase 1: Foundation
              </h3>
              <ul className="space-y-1 text-white/60">
                <li>• Built initial Next.js app with Prisma and SQLite</li>
                <li>• Integrated YouTube caption fetching</li>
                <li>• Added local Whisper transcription as fallback</li>
                <li>• Implemented transcript storage and search</li>
              </ul>
            </div>
            <div>
              <h3 className="mb-1 font-mono text-xs uppercase tracking-wider text-white/45">
                Phase 2: Performance & Reliability
              </h3>
              <ul className="space-y-1 text-white/60">
                <li>• Added MLX backend for 3-5x faster transcription on Apple Silicon</li>
                <li>• Implemented automatic fallback chain (captions → MLX → OpenAI CPU)</li>
                <li>• Added memory safety guards and process cleanup</li>
                <li>• Built queue system for batch processing</li>
              </ul>
            </div>
            <div>
              <h3 className="mb-1 font-mono text-xs uppercase tracking-wider text-white/45">
                Phase 3: UI/UX Redesign
              </h3>
              <ul className="space-y-1 text-white/60">
                <li>• Redesigned with single-page layout (capture + library + viewer)</li>
                <li>• Refined greyscale aesthetic with vintage sepia tones</li>
                <li>• Added tiles/list view toggle for library</li>
                <li>• Implemented auto-cleanup of completed queue items</li>
                <li>• Polished hover states and transitions throughout</li>
              </ul>
            </div>
            <div>
              <h3 className="mb-1 font-mono text-xs uppercase tracking-wider text-white/45">
                Phase 4: Open Source
              </h3>
              <ul className="space-y-1 text-white/60">
                <li>• Prepared for public release</li>
                <li>• Added documentation and setup instructions</li>
                <li>• Made available on GitHub for the community</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Links */}
        <section className="space-y-3 rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-6">
          <h2 className="text-xl font-medium text-white/80">Open Source</h2>
          <p className="text-sm leading-relaxed text-white/60">
            This project is open source and available on GitHub. Feel free to use it, modify it, or contribute improvements. If you find it useful, consider giving it a star.
          </p>
          <a
            href="https://github.com/lifesized/youtube-transcriber"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-full border border-white/20 bg-white/10 px-6 py-2.5 text-sm font-medium text-white transition-all hover:border-white/40 hover:bg-white/15"
          >
            View on GitHub →
          </a>
        </section>
      </div>
    </div>
  );
}
