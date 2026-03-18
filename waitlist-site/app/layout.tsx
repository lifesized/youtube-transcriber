import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "YouTube Transcriber — Cloud Waitlist",
  description: "Transcribe any YouTube video in seconds. No install. No Python. No local setup.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0a" }}>{children}</body>
    </html>
  );
}
