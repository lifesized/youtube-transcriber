import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { UsageBar } from "../components/UsageBar.js";
import { UpgradeCallout } from "../components/UpgradeCallout.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "quota_upgrade";

type Props = { used?: number; total?: number; resetDate?: string };

export default function Quota80({ used = 24, total = 30, resetDate }: Props = {}) {
  return (
    <Layout preview={`You're at ${used}/${total} transcripts this month.`}>
      <Eyebrow>Usage update</Eyebrow>
      <H1>You're at {used}/{total} transcripts</H1>
      <Body>
        You're using Transcribed every day — nice. Heads up that you're nearing
        the free tier limit{resetDate ? ` (resets ${resetDate})` : ""}.
      </Body>

      <UsageBar used={used} total={total} />

      <UpgradeCallout
        ctaHref={utm("/upgrade", CAMPAIGN, "q80")}
        ctaLabel="Upgrade to Pro"
      />

      <CTARow>
        <GhostLink href={utm("/dashboard/usage", CAMPAIGN, "q80-view")}>
          View usage
        </GhostLink>
      </CTARow>
    </Layout>
  );
}

Quota80.PreviewProps = { used: 24, total: 30, resetDate: "May 1" } satisfies Props;
