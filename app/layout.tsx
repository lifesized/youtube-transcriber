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
        className={`${GeistSans.className} ${GeistMono.variable} ${GeistPixelSquare.variable} min-h-screen bg-[hsl(var(--bg))] text-[hsl(var(--text))] antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
