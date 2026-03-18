"use client";

import { SettingsPanel } from "@/components/settings-panel";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-[800px]">
        <div className="space-y-6 sm:space-y-8">
          <div>
            <h1 className="text-base font-semibold text-white/90">Settings</h1>
            <p className="mt-1 text-sm text-white/40">
              Configure transcription providers and preferences
            </p>
          </div>

          <section className="space-y-8 rounded-2xl border border-white/10 bg-[hsl(var(--panel))] p-4 sm:p-6">
            <SettingsPanel />
          </section>

          <p className="text-center text-xs text-white/20">
            Enjoying it?{" "}
            <a
              href="https://github.com/lifesized/youtube-transcriber"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/30 underline decoration-white/10 transition-colors hover:text-white/50 hover:decoration-white/30"
            >
              ⭐ Star on GitHub
            </a>{" "}
            — it helps others find the project.
          </p>
        </div>
      </div>
    </div>
  );
}
