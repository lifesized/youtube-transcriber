import type { Metadata } from "next";
import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { GeistPixelSquare } from "geist/font/pixel";
import "./globals.css";

export const metadata: Metadata = {
  title: "YouTube Transcript Capture",
  description: "Capture and store YouTube video transcripts",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${GeistSans.className} ${GeistMono.variable} ${GeistPixelSquare.variable} flex min-h-screen flex-col bg-[hsl(var(--bg))] text-[hsl(var(--text))] antialiased`}
      >
        <main className="flex-1">{children}</main>
        <footer className="border-t border-white/10 bg-[hsl(var(--bg))]/70">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
            <span className="text-xs text-white/35">
              <Link href="/about" className="text-white/60 hover:text-white">
                about
              </Link>{" "}
              this project by{" "}
              <a
                href="https://github.com/lifesized"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/60 hover:text-white"
              >
                lifesized
              </a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
