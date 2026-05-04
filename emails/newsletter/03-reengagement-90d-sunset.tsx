import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body, Muted } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "re_engagement";

export default function ReengagementSunset() {
  return (
    <Layout preview="Still want these emails?">
      <Eyebrow>One question</Eyebrow>
      <H1>Still want these?</H1>
      <Body>
        You haven't opened a Transcribed email in 90 days. That's fine — but
        we'd rather not clutter your inbox if you're not reading.
      </Body>
      <Body>
        Click below to stay on the list. If we don't hear back in 14 days,
        we'll unsubscribe you automatically. No hard feelings.
      </Body>

      <CTARow>
        <CTA href={utm("/email-preferences?confirm=stay", CAMPAIGN, "sunset-stay")}>
          Yes, keep me on the list
        </CTA>
        <GhostLink href={utm("/unsubscribe", CAMPAIGN, "sunset-bye")}>
          Unsubscribe me
        </GhostLink>
      </CTARow>

      <Muted>Either way, thanks for trying Transcribed.</Muted>
    </Layout>
  );
}

ReengagementSunset.PreviewProps = {};
