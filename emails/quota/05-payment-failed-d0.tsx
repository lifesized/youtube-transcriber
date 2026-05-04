import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body, Muted } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { Callout } from "../components/Callout.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "dunning";

type Props = { cardLast4?: string; nextRetryDate?: string };

export default function PaymentFailedD0({ cardLast4, nextRetryDate }: Props = {}) {
  return (
    <Layout
      preview="We couldn't process your payment. Quick fix inside."
      footerNote="Transactional notice — sent because your payment didn't go through."
    >
      <Eyebrow>Payment</Eyebrow>
      <H1>We couldn't process your payment</H1>
      <Body>
        Your Pro renewal failed
        {cardLast4 ? ` on the card ending in ${cardLast4}` : ""}. Stripe will
        retry automatically{nextRetryDate ? ` on ${nextRetryDate}` : " in a few days"},
        but the fastest fix is to update your payment method now.
      </Body>

      <Callout title="What this means" tone="danger">
        Your account stays on Pro for now. If retries keep failing for 7 days,
        we'll move you to the free tier (you won't lose your library).
      </Callout>

      <CTARow>
        <CTA href={utm("/billing", CAMPAIGN, "fail-d0")}>Update payment</CTA>
        <GhostLink href="mailto:support@transcribed.dev">Contact support</GhostLink>
      </CTARow>

      <Muted>Reply to this email if you need help.</Muted>
    </Layout>
  );
}

PaymentFailedD0.PreviewProps = {
  cardLast4: "4242",
  nextRetryDate: "Apr 30",
} satisfies Props;
