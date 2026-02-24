import { Metadata } from "next";

export const metadata: Metadata = {
  title: "About YouTube Transcriber",
  description: "Learn about why this project exists and how it works",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-[800px]">
      <div className="space-y-6 sm:space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold text-white/90">About</h1>
        </div>

        {/* Main Content */}
        <section className="space-y-6 rounded-2xl border border-white/10 bg-[hsl(var(--panel))] hover:border-white/30 transition-colors duration-200 p-4 sm:p-6">
          {/* Personal Note */}
          <div className="space-y-3">
            <h2 className="text-base font-medium text-white/75">Why I Built This</h2>
            <p className="text-sm leading-relaxed text-white/40">
              I built this because I kept hitting credit limits on paid transcription services. My workflow is simple: paste YouTube transcripts into Claude or ChatGPT to quickly extract insights, ask questions, and learn faster than watching videos. After burning through yet another subscription in a week, I decided to build a local alternative for free.
            </p>
          </div>

          {/* Why This Matters */}
          <div className="space-y-3">
            <h2 className="text-base font-medium text-white/75">Why This Matters</h2>
            <p className="text-sm leading-relaxed text-white/40">
              Extracting knowledge from video content can help with speeding up your learning and sense making of knowledge and the world out there. This tool attempts to extract existing YouTube captions directly, the fastest and most reliable option. When captions aren&apos;t available, it can use cloud Whisper (Groq or OpenAI, bring your own API key) or fall back to local Whisper transcription. All data stays on your machine, with zero usage limits on local transcription.
            </p>
          </div>

          {/* How to Use */}
          <div className="space-y-3">
            <h2 className="text-base font-medium text-white/75">How to Use</h2>
            <ul className="space-y-3 text-sm text-white/40">
              <li>
                <strong className="text-white/70">Browser app</strong> — Run <code className="rounded bg-white/10 px-1.5 py-0.5 text-[13px] text-white/70">npm run dev</code> in your terminal and open{" "}
                <code className="rounded bg-white/10 px-1.5 py-0.5 text-[13px] text-white/70">localhost:19720</code> in your browser. Paste a YouTube URL to extract its transcript.
              </li>
              <li>
                <strong className="text-white/70">Summarize with...</strong> — Hover over any transcript in the library and click the &quot;Summarize with&quot; button to send it directly to ChatGPT or Claude for instant analysis.
              </li>
              <li>
                <strong className="text-white/70">OpenClaw agent</strong> — Install the included{" "}
                <a href="https://github.com/lifesized/youtube-transcriber/tree/main/contrib/openclaw" target="_blank" rel="noopener noreferrer" className="text-white/75 underline decoration-blue-400 hover:text-white hover:decoration-blue-300">OpenClaw skill</a> and ask your agent:{" "}
                <code className="block mt-2 wrap-break-word rounded bg-white/10 px-3 py-2 text-[13px] italic text-white/70">&quot;summarize https://youtube.com/watch?v=...&quot;</code>
              </li>
              <li>
                <strong className="text-white/70">Claude Code agent (full)</strong> — With the Claude Code skill installed, just paste a URL or type:{" "}
                <code className="block mt-2 wrap-break-word rounded bg-white/10 px-3 py-2 text-[13px] italic text-white/70">&quot;ts https://youtube.com/watch?v=...&quot;</code>
                <span className="mt-1 block text-[12px] text-white/40">Requires the service running. Gives you local + cloud Whisper transcription, speaker diarization, and a persistent library.</span>
              </li>
              <li>
                <strong className="text-white/70">Claude Code agent (lite)</strong> — Zero-setup option that works with just <code className="rounded bg-white/10 px-1.5 py-0.5 text-[13px] text-white/70">yt-dlp</code> installed — no server needed. Extracts YouTube subtitles directly. Automatically upgrades to the full service when detected.
                <span className="mt-1 block text-[12px] text-white/40">See the{" "}
                  <a href="https://github.com/lifesized/youtube-transcriber" target="_blank" rel="noopener noreferrer" className="text-white/50 underline decoration-blue-400/50 hover:text-white/70 hover:decoration-blue-300">GitHub README</a> for setup.
                </span>
              </li>
              <li>
                <strong className="text-white/70">Claude Desktop / Cursor</strong> — An optional MCP server is included. Choose to install it during{" "}
                <code className="rounded bg-white/10 px-1.5 py-0.5 text-[13px] text-white/70">npm run setup</code>, then add the config snippet to your client. Run{" "}
                <code className="rounded bg-white/10 px-1.5 py-0.5 text-[13px] text-white/70">npm run mcp:config</code> to get it.
              </li>
            </ul>
          </div>

          {/* Technical Highlights */}
          <div className="space-y-3">
            <h2 className="text-base font-medium text-white/75">Technical Highlights</h2>
            <ul className="space-y-2 text-sm text-white/40">
              <li>• <strong className="text-white/70">Local-first architecture</strong> — All processing happens on your machine. No data leaves your computer.</li>
              <li>• <strong className="text-white/70">MLX Whisper optimization</strong> — 3-5x faster transcription on Apple Silicon using Apple's MLX framework.</li>
              <li>• <strong className="text-white/70">Automatic fallback chain</strong> — YouTube captions → Cloud Whisper (BYOK) → MLX Whisper → OpenAI Whisper, ensuring you always get a transcript.</li>
              <li>• <strong className="text-white/70">Multi-language captions</strong> — Request captions in any language YouTube supports via the <code className="rounded bg-white/10 px-1.5 py-0.5 text-[13px] text-white/70">lang</code> parameter or <code className="rounded bg-white/10 px-1.5 py-0.5 text-[13px] text-white/70">YTT_CAPTION_LANGS</code> env var.</li>
              <li>• <strong className="text-white/70">Modern stack</strong> — Next.js 15, React 19, TypeScript, Prisma with SQLite.</li>
              <li>• <strong className="text-white/70">AI agent integration</strong> — Full and lite skills for Claude Code and OpenClaw, plus an MCP server for Claude Desktop and Cursor.</li>
            </ul>
          </div>

          {/* Use Cases */}
          <div className="space-y-3">
            <h2 className="text-base font-medium text-white/75">Use Cases</h2>
            <ul className="space-y-2 text-sm text-white/40">
              <li>• <strong className="text-white/70">Research & learning</strong> — Extract key insights from educational content without watching entire videos.</li>
              <li>• <strong className="text-white/70">Content analysis</strong> — Feed transcripts to LLMs for summarization, Q&A, or deeper analysis.</li>
              <li>• <strong className="text-white/70">Documentation</strong> — Convert tutorial videos or talks into searchable, reusable text.</li>
              <li>• <strong className="text-white/70">Accessibility</strong> — Generate accurate transcripts for videos lacking proper captions.</li>
            </ul>
          </div>
        </section>

        {/* Footer */}
        <section className="space-y-6 rounded-2xl border border-white/10 bg-[hsl(var(--panel))] hover:border-white/30 transition-colors duration-200 p-4 sm:p-6">
          {/* Built With AI */}
          <div>
            <h2 className="text-base font-medium text-white/75 mb-3">Tools</h2>
            <p className="text-sm leading-relaxed text-white/40 mb-4">
              This project was built using:
            </p>
            <ul className="space-y-2 text-sm text-white/40">
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
            </ul>
          </div>

          {/* Open Source */}
          <div className="">
            <h2 className="text-base font-medium text-white/75 mb-3">Open Source</h2>
            <p className="text-sm leading-relaxed text-white/40 mb-4">
              This project is open source under the MIT License and available on GitHub. Feel free to use it, modify it, or contribute improvements. If you find it useful, consider giving it a star.
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
    </div>
  );
}
