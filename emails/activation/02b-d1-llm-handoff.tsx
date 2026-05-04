import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { Callout } from "../components/Callout.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "cloud_activation";

type Props = { firstName?: string; transcriptCount?: number };

export default function ActivationD1LlmHandoff({ firstName, transcriptCount = 1 }: Props = {}) {
  return (
    <Layout preview="Try the LLM handoff — one click to ChatGPT or Claude.">
      <Eyebrow>D+1 · Power feature</Eyebrow>
      <H1>{firstName ? `Nice work, ${firstName}.` : "Nice work."}</H1>
      <Body>
        You've already got {transcriptCount} transcript{transcriptCount === 1 ? "" : "s"}.
        Here's the feature most people miss in week one.
      </Body>

      <Callout title="One-click summary" tone="accent">
        From any transcript, hit <em>Summarize</em> to hand it off to Claude or
        ChatGPT with the prompt pre-filled. ChatGPT auto-submits. Claude opens
        a fresh chat ready to paste.
      </Callout>

      <Body>
        Best workflow: transcribe a 90-min podcast, ask Claude for the 10
        bullet takeaways, ship them to your team in three minutes.
      </Body>

      <CTARow>
        <CTA href={utm("/library", CAMPAIGN, "d1-summarize")}>Summarize a transcript</CTA>
        <GhostLink href={utm("/docs/llm-handoff", CAMPAIGN, "d1-tips")}>
          Read tips
        </GhostLink>
      </CTARow>
    </Layout>
  );
}

ActivationD1LlmHandoff.PreviewProps = {
  firstName: "Sam",
  transcriptCount: 3,
} satisfies Props;
