import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body, Muted } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { Callout } from "../components/Callout.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "cloud_activation";

export default function ActivationD1NoTranscripts() {
  return (
    <Layout preview="Your first transcript in 30 seconds.">
      <Eyebrow>D+1 · Get started</Eyebrow>
      <H1>Your first transcript in 30 seconds</H1>
      <Body>
        Three steps. No setup. Works on any YouTube or Spotify podcast link.
      </Body>

      <Callout title="1. Open a video">
        Any YouTube video or Spotify podcast episode page.
      </Callout>
      <Callout title="2. Click the Transcribed icon">
        The side panel opens. Stays open as you browse.
      </Callout>
      <Callout title="3. Hit Transcribe">
        Done in seconds. Search, summarize, send to Notion.
      </Callout>

      <CTARow>
        <CTA href={utm("/dashboard", CAMPAIGN, "d1-noop")}>Transcribe a video</CTA>
        <GhostLink href="https://chromewebstore.google.com/detail/transcribed">
          Install extension
        </GhostLink>
      </CTARow>

      <Muted>Stuck? Reply to this email.</Muted>
    </Layout>
  );
}

ActivationD1NoTranscripts.PreviewProps = {};
