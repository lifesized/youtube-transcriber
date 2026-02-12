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
      <body className={`${GeistSans.className} ${GeistMono.variable} ${GeistPixelSquare.variable} min-h-screen bg-gray-50 text-gray-900`}>
        <nav className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-semibold text-gray-900">
              Transcript Capture
            </Link>
            <div className="flex items-center gap-4">
              <Link
                href="/library"
                className="text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Library
              </Link>
            </div>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
