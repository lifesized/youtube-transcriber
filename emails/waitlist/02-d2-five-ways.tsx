import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, H2, Body, Muted } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { CodeBlock } from "../components/CodeBlock.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "waitlist_nurture";

export default function WaitlistD2FiveWays() {
  return (
    <Layout preview="Five ways power users transcribe with AI.">
      <Eyebrow>D+2 · Workflow</Eyebrow>
      <H1>Five ways to transcribe with AI</H1>
      <Body>
        While you wait for cloud, here's how people are using the local version
        with their AI tools.
      </Body>

      <H2>1. Drop a URL into Claude Code</H2>
      <Muted>The MCP server gives Claude a transcribe tool. Just paste a link.</Muted>
      <CodeBlock>{`> summarize https://youtube.com/watch?v=...`}</CodeBlock>

      <H2>2. Batch a playlist with the queue</H2>
      <Muted>Run 30 episodes overnight, search them tomorrow.</Muted>

      <H2>3. Spotify podcast → markdown notes</H2>
      <Muted>Same flow works for Spotify episodes via the public RSS feed.</Muted>

      <H2>4. One-click summary in ChatGPT or Claude</H2>
      <Muted>The browser extension hands the transcript over with a single click.</Muted>

      <H2>5. Pipe it into Obsidian</H2>
      <Muted>Connectors push transcripts to your vault — keep the link, drop the video.</Muted>

      <CTARow>
        <CTA href={utm("/self-host", CAMPAIGN, "d2")}>Try it free locally</CTA>
        <GhostLink href={utm("/docs", CAMPAIGN, "d2-docs")}>Read the docs</GhostLink>
      </CTARow>
    </Layout>
  );
}

WaitlistD2FiveWays.PreviewProps = {};
