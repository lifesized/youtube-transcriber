import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { Callout } from "../components/Callout.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "dunning";

export default function PaymentFailedD7() {
  return (
    <Layout
      preview="Account moves to free tier in 24 hours."
      footerNote="Transactional notice — final dunning notice before downgrade."
    >
      <Eyebrow>Final notice · 24 hours</Eyebrow>
      <H1>Account moves to free tier in 24 hours</H1>
      <Body>
        We've tried to charge your card for seven days. In 24 hours, your
        account will switch to the free tier (30 transcripts/month, no audio
        Whisper). Your library and history stay intact.
      </Body>

      <Callout title="Last chance to keep Pro" tone="danger">
        Update your payment method in the next 24 hours and we'll restart your
        Pro subscription with no gap.
      </Callout>

      <CTARow>
        <CTA href={utm("/billing", CAMPAIGN, "fail-d7")}>Update payment</CTA>
        <GhostLink href={utm("/dashboard", CAMPAIGN, "fail-d7-stay-free")}>
          Stay on free
        </GhostLink>
      </CTARow>
    </Layout>
  );
}

PaymentFailedD7.PreviewProps = {};
