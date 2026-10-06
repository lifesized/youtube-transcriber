import type { Metadata } from "next";
import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { GeistPixelSquare } from "geist/font/pixel";
import { LocalApiAuth } from "@/components/local-api-auth";
import { ensureLocalApiToken } from "@/lib/local-api-token.js";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Transcriber",
  description: "Capture and store video transcripts",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const token = ensureLocalApiToken();
  return (
    <html lang="en">
      <body
        className={`${GeistSans.className} ${GeistMono.variable} ${GeistPixelSquare.variable} min-h-screen bg-[hsl(var(--bg))] text-[hsl(var(--text))] antialiased`}
      >
        <LocalApiAuth token={token} />
        {children}
      </body>
    </html>
  );
}
