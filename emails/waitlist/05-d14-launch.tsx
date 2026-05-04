import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { UpgradeCallout } from "../components/UpgradeCallout.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "waitlist_nurture";

export default function WaitlistD14Launch() {
  return (
    <Layout preview="We're live. 25% off Pro for waitlist members.">
      <Eyebrow>D+14 · Launch</Eyebrow>
      <H1>Cloud is open. 25% off, just for you.</H1>
      <Body>
        Thanks for waiting. As a waitlist member, your first month of Pro is
        25% off — applied automatically when you upgrade in the next 7 days.
      </Body>

      <UpgradeCallout
        ctaHref={utm("/upgrade?promo=WAITLIST25", CAMPAIGN, "d14-claim")}
        ctaLabel="Claim 25% off →"
        priceLabel="Pro · $6.75 first month"
        features={[
          "Unlimited cloud transcripts",
          "Whisper audio for caption-less videos",
          "Notion + Obsidian connectors",
          "Cancel any time",
        ]}
      />

      <CTARow>
        <GhostLink href={utm("/signup", CAMPAIGN, "d14-free")}>
          Or start on the free tier
        </GhostLink>
      </CTARow>
    </Layout>
  );
}

WaitlistD14Launch.PreviewProps = {};
