import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { Callout } from "../components/Callout.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "re_engagement";

type Props = { firstName?: string };

export default function ReengagementD60({ firstName }: Props = {}) {
  return (
    <Layout preview="Here's what you missed.">
      <Eyebrow>Long time</Eyebrow>
      <H1>{firstName ? `${firstName}, here's what you missed` : "Here's what you missed"}</H1>
      <Body>
        It's been a couple months. Three things you'll want to know about.
      </Body>

      <Callout title="Whisper audio is faster">
        Caption-less videos transcribe in under 30 seconds for most lengths.
      </Callout>
      <Callout title="Spotify podcast support">
        Same paste-and-go flow now works for Spotify episodes.
      </Callout>
      <Callout title="Notion + Obsidian connectors">
        One-click push from any transcript to your knowledge base.
      </Callout>

      <CTARow>
        <CTA href={utm("/dashboard", CAMPAIGN, "60d")}>Open Transcribed</CTA>
        <GhostLink href={utm("/email-preferences", CAMPAIGN, "60d-prefs")}>
          Email preferences
        </GhostLink>
      </CTARow>
    </Layout>
  );
}

ReengagementD60.PreviewProps = { firstName: "Sam" } satisfies Props;
