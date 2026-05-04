import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, H2, Body, Muted } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { Callout } from "../components/Callout.js";
import { TranscriptCard } from "../components/TranscriptCard.js";
import { CodeBlock } from "../components/CodeBlock.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "monthly_digest";

type Transcript = {
  title: string;
  channel: string;
  duration?: string;
  href: string;
  thumbnailUrl?: string;
  summary?: string;
};

type Props = {
  monthLabel?: string;
  theme?: string;
  shipped?: string[];
  transcripts?: Transcript[];
  tipTitle?: string;
  tipBody?: string;
  tipCode?: string;
};

const DEFAULT_PROPS: Required<Props> = {
  monthLabel: "April 2026",
  theme: "Faster panel, smarter handoff, fewer tabs.",
  shipped: [
    "Snappy cloud-mode panel boot — optimistic first paint",
    "In-panel auth — no more tab-switching to sign in",
    "Connectors redesign with official logos",
  ],
  transcripts: [
    {
      title: "How to think about distribution as a solo founder",
      channel: "Lenny's Podcast",
      duration: "1h 24m",
      href: "https://transcribed.dev/t/example-1",
      summary: "On finding the unfair channel before scaling content marketing.",
    },
    {
      title: "What we learned shipping AI to 5M users",
      channel: "Latent Space",
      duration: "58m",
      href: "https://transcribed.dev/t/example-2",
      summary: "Eval pipelines, latency tradeoffs, and the cost curve everyone misses.",
    },
    {
      title: "Why we ditched our entire design system",
      channel: "Design Details",
      duration: "42m",
      href: "https://transcribed.dev/t/example-3",
      summary: "Sometimes the right move is throwing the playbook out.",
    },
  ],
  tipTitle: "Prompt: turn any transcript into a tweet thread",
  tipBody: "Paste this after your transcript when you hand it to Claude. Works on any podcast over 30 minutes.",
  tipCode: `Pull the 5 most counterintuitive ideas from this transcript.
For each, give me a single tweet (under 240 chars) that
makes a strong claim. No emojis. No hashtags.`,
};

export default function MonthlyDigest(props: Props = {}) {
  const p = { ...DEFAULT_PROPS, ...props };
  return (
    <Layout
      preview={`${p.monthLabel} digest — ${p.theme}`}
      footerNote={`Monthly digest · ${p.monthLabel}`}
    >
      <Eyebrow>{p.monthLabel} · Digest</Eyebrow>
      <H1>{p.theme}</H1>

      <H2>What shipped</H2>
      {p.shipped.map((line, i) => (
        <Callout key={i}>{line}</Callout>
      ))}
      <CTARow>
        <CTA href="https://github.com/lifesized/youtube-transcriber/blob/main/CHANGELOG.md">
          Full changelog
        </CTA>
      </CTARow>

      <H2>Top transcripts this month</H2>
      <Body>The most-read public transcripts on Transcribed in {p.monthLabel}.</Body>
      {p.transcripts.map((t) => (
        <TranscriptCard key={t.href} {...t} />
      ))}

      <H2>{p.tipTitle}</H2>
      <Muted>{p.tipBody}</Muted>
      <CodeBlock>{p.tipCode}</CodeBlock>
      <CTARow>
        <GhostLink href={utm("/library", CAMPAIGN, "tip")}>
          Try this prompt
        </GhostLink>
      </CTARow>
    </Layout>
  );
}

MonthlyDigest.PreviewProps = {} satisfies Props;
