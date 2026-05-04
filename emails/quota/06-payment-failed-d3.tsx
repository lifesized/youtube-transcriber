import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body } from "../components/Heading.js";
import { CTA, CTARow } from "../components/CTA.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "dunning";

export default function PaymentFailedD3() {
  return (
    <Layout
      preview="Reminder: payment is still failing."
      footerNote="Transactional notice — your card declined again."
    >
      <Eyebrow>Reminder · 3 days</Eyebrow>
      <H1>Payment is still failing</H1>
      <Body>
        Stripe retried and the card declined again. No action from you yet,
        but if it doesn't go through in the next four days your account will
        switch to the free tier.
      </Body>
      <Body>
        Most common cause: card expired or address mismatch. Updating payment
        in your account fixes it instantly.
      </Body>

      <CTARow>
        <CTA href={utm("/billing", CAMPAIGN, "fail-d3")}>Update payment</CTA>
      </CTARow>
    </Layout>
  );
}

PaymentFailedD3.PreviewProps = {};
