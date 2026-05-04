import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, H2, Body, Muted } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { CodeBlock } from "../components/CodeBlock.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "self_hosted_crosssell";

export default function SelfHostedD0Docs() {
  return (
    <Layout preview="Docs you probably missed.">
      <Eyebrow>D+0 · For self-hosters</Eyebrow>
      <H1>Docs you probably missed</H1>
      <Body>
        You're running the local version. Here are three integrations that
        most people skip past on first install.
      </Body>

      <H2>MCP server for Claude Code</H2>
      <Muted>Already configured if you cloned the repo. Just open Claude Code in the project.</Muted>
      <CodeBlock>{`> ts https://youtube.com/watch?v=...
> summarize https://youtube.com/watch?v=...`}</CodeBlock>

      <H2>Skill (no server needed)</H2>
      <Muted>Lite skill works with just yt-dlp. Install once, paste a URL anywhere.</Muted>
      <CodeBlock>{`cp contrib/claude-code/SKILL-lite.md \\
  ~/.claude/skills/youtube-transcriber/SKILL.md`}</CodeBlock>

      <H2>REST API</H2>
      <Muted>Same engine, callable from anything that does HTTP.</Muted>
      <CodeBlock>{`curl -X POST http://localhost:19720/api/transcripts \\
  -H 'Content-Type: application/json' \\
  -d '{"url": "https://youtube.com/watch?v=..."}'`}</CodeBlock>

      <CTARow>
        <CTA href={utm("/docs/mcp", CAMPAIGN, "d0-mcp")}>Try MCP setup</CTA>
        <GhostLink href={utm("/docs/api", CAMPAIGN, "d0-api")}>Read API docs</GhostLink>
      </CTARow>
    </Layout>
  );
}

SelfHostedD0Docs.PreviewProps = {};
