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
          <h1 className="text-xl font-semibold text-white/90">About YouTube Transcriber</h1>
          <p className="mt-3 text-base leading-relaxed text-white/60">
            A local-first tool for converting YouTube videos into LLM-ready transcripts. No API costs, no rate limits, no cloud dependencies.
          </p>
        </div>

        {/* Main Content */}
        <section className="space-y-6 rounded-2xl border border-white/10 bg-[hsl(var(--panel))] hover:border-white/30 transition-colors duration-200 p-6">
          {/* Personal Note */}
          <div className="space-y-3">
            <h2 className="text-xl font-medium text-white/80">Why I Built This</h2>
            <p className="text-sm leading-relaxed text-white/60">
              I built this because I kept hitting credit limits on paid transcription services. My workflow is simple: paste YouTube transcripts into Claude or ChatGPT to quickly extract insights, ask questions, and learn faster than watching videos. After burning through yet another subscription in a week, I decided to build a local alternative that I could use unlimited, forever, for free.
            </p>
          </div>

          {/* Why This Matters */}
          <div className="space-y-3 pt-4 border-t border-white/10">
            <h2 className="text-xl font-medium text-white/80">Why This Matters</h2>
            <p className="text-sm leading-relaxed text-white/60">
              Most AI workflows involve extracting knowledge from video content. Even major providers like Google, OpenAI, and AssemblyAI charge for transcription services with usage limits and ongoing costs. This tool runs entirely on your machine using OpenAI Whisper, giving you unlimited transcriptions with no recurring fees.
            </p>
          </div>

          {/* Technical Highlights */}
          <div className="space-y-3 pt-4 border-t border-white/10">
            <h2 className="text-xl font-medium text-white/80">Technical Highlights</h2>
            <ul className="space-y-2 text-sm text-white/60">
              <li>• <strong className="text-white/70">Local-first architecture</strong> — All processing happens on your machine. No data leaves your computer.</li>
              <li>• <strong className="text-white/70">MLX Whisper optimization</strong> — 3-5x faster transcription on Apple Silicon using Apple's MLX framework.</li>
              <li>• <strong className="text-white/70">Automatic fallback chain</strong> — YouTube captions → MLX Whisper → OpenAI Whisper, ensuring you always get a transcript.</li>
              <li>• <strong className="text-white/70">Modern stack</strong> — Next.js 15, React 19, TypeScript, Prisma with SQLite.</li>
              <li>• <strong className="text-white/70">AI agent integration</strong> — Built-in skills for Claude Code and OpenClaw, making it easy to integrate into agentic workflows.</li>
            </ul>
          </div>

          {/* Use Cases */}
          <div className="space-y-3 pt-4 border-t border-white/10">
            <h2 className="text-xl font-medium text-white/80">Use Cases</h2>
            <ul className="space-y-2 text-sm text-white/60">
              <li>• <strong className="text-white/70">Research & learning</strong> — Extract key insights from educational content without watching entire videos.</li>
              <li>• <strong className="text-white/70">Content analysis</strong> — Feed transcripts to LLMs for summarization, Q&A, or deeper analysis.</li>
              <li>• <strong className="text-white/70">Documentation</strong> — Convert tutorial videos or talks into searchable, reusable text.</li>
              <li>• <strong className="text-white/70">Accessibility</strong> — Generate accurate transcripts for videos lacking proper captions.</li>
            </ul>
          </div>
        </section>

        {/* Footer */}
        <section className="space-y-6 rounded-2xl border border-white/10 bg-[hsl(var(--panel))] hover:border-white/30 transition-colors duration-200 p-6">
          {/* Built With AI */}
          <div>
            <h2 className="text-xl font-medium text-white/80 mb-3">Built With AI</h2>
            <p className="text-sm leading-relaxed text-white/60 mb-4">
              This project was built in ~7 hours using modern AI coding assistants and tools:
            </p>
            <ul className="space-y-2 text-sm text-white/60">
              <li>
                • <a href="https://www.augmentcode.com/intent" target="_blank" rel="noopener noreferrer" className="text-white/75 underline decoration-blue-400 hover:text-white hover:decoration-blue-300">Intent by Augment</a> — AI-powered coding assistant
              </li>
              <li>
                • <a href="https://cursor.sh" target="_blank" rel="noopener noreferrer" className="text-white/75 underline decoration-blue-400 hover:text-white hover:decoration-blue-300">Cursor</a> — AI-first code editor
              </li>
              <li>
                • <a href="https://openai.com/index/openai-codex/" target="_blank" rel="noopener noreferrer" className="text-white/75 underline decoration-blue-400 hover:text-white hover:decoration-blue-300">Codex</a> — OpenAI's code generation model
              </li>
              <li>
                • <a href="https://github.com/anthropics/claude-code" target="_blank" rel="noopener noreferrer" className="text-white/75 underline decoration-blue-400 hover:text-white hover:decoration-blue-300">Claude Code</a> — Anthropic's AI coding assistant
              </li>
              <li>
                • <a href="https://ghostty.org" target="_blank" rel="noopener noreferrer" className="text-white/75 underline decoration-blue-400 hover:text-white hover:decoration-blue-300">Ghostty</a> — Fast, native terminal emulator
              </li>
            </ul>
          </div>

          {/* Open Source */}
          <div className="pt-4 border-t border-white/10">
            <h2 className="text-xl font-medium text-white/80 mb-3">Open Source</h2>
            <p className="text-sm leading-relaxed text-white/60 mb-4">
              This project is open source and available on GitHub. Feel free to use it, modify it, or contribute improvements. If you find it useful, consider giving it a star.
            </p>
            <a
              href="https://github.com/lifesized/youtube-transcriber"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/35 transition-colors hover:text-white/60"
              title="View on GitHub"
            >
              <svg
                className="h-5 w-5"
                fill="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                  clipRule="evenodd"
                />
              </svg>
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
