import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body, Muted } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { UpgradeCallout } from "../components/UpgradeCallout.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "cloud_activation";

type Props = { resetDate?: string };

export default function ActivationD7ProIntro({ resetDate }: Props = {}) {
  return (
    <Layout preview="Your free tier resets monthly. Here's what Pro unlocks.">
      <Eyebrow>D+7 · Free vs Pro</Eyebrow>
      <H1>Your free tier resets {resetDate ?? "monthly"}</H1>
      <Body>
        30 transcripts per month is plenty for most people. If you're using it
        more, here's what Pro unlocks.
      </Body>

      <UpgradeCallout
        ctaHref={utm("/pricing", CAMPAIGN, "d7-upgrade")}
        ctaLabel="See Pro plans"
      />

      <CTARow>
        <GhostLink href={utm("/dashboard", CAMPAIGN, "d7-stay-free")}>
          Keep using free
        </GhostLink>
      </CTARow>

      <Muted>
        Free tier doesn't expire. We'll only nudge you when you're close to
        your monthly limit.
      </Muted>
    </Layout>
  );
}

ActivationD7ProIntro.PreviewProps = { resetDate: "May 1" } satisfies Props;
