import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body, Muted } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "waitlist_nurture";

export default function WaitlistD5Why() {
  return (
    <Layout preview="Why we're building Transcribed.">
      <Eyebrow>D+5 · Why this exists</Eyebrow>
      <H1>The hour I lost</H1>
      <Body>
        I tried to find a 90-second clip in a two-hour podcast last month. I
        scrubbed for an hour. The transcript would have taken 30 seconds.
      </Body>
      <Body>
        Every existing tool either uploaded my files somewhere I didn't trust,
        or wanted $30/month for a feature ChatGPT could already do — given a
        transcript. So we built the bridge.
      </Body>
      <Body>
        Local-first. Open source. Cloud for the people who don't want to set up
        Whisper. That's it.
      </Body>
      <CTARow>
        <CTA href={utm("/feedback", CAMPAIGN, "d5-vote")}>Vote on next feature</CTA>
        <GhostLink href="mailto:hello@transcribed.dev?subject=Feature%20request">
          Reply with a feature
        </GhostLink>
      </CTARow>
      <Muted>— James, building Transcribed</Muted>
    </Layout>
  );
}

WaitlistD5Why.PreviewProps = {};
