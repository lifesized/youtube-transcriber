import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { UsageBar } from "../components/UsageBar.js";
import { UpgradeCallout } from "../components/UpgradeCallout.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "quota_upgrade";

type Props = { total?: number; resetDate?: string };

export default function Quota100({ total = 30, resetDate }: Props = {}) {
  return (
    <Layout
      preview="Free tier reached. Upgrade or wait until reset."
      footerNote="Transactional notice — sent because you hit your free tier limit."
    >
      <Eyebrow>Free tier reached</Eyebrow>
      <H1>You've used all {total} free transcripts</H1>
      <Body>
        Transcription paused on your account until {resetDate ?? "your next monthly reset"}.
        Upgrade to Pro for unlimited cloud transcripts and Whisper audio.
      </Body>

      <UsageBar used={total} total={total} />

      <UpgradeCallout
        ctaHref={utm("/upgrade", CAMPAIGN, "q100")}
        ctaLabel="Upgrade to Pro"
      />

      <CTARow>
        <GhostLink href={utm("/dashboard", CAMPAIGN, "q100-wait")}>
          Wait for reset on {resetDate ?? "the 1st"}
        </GhostLink>
      </CTARow>
    </Layout>
  );
}

Quota100.PreviewProps = { total: 30, resetDate: "May 1" } satisfies Props;
