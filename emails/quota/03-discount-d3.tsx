import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { Callout } from "../components/Callout.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "quota_upgrade";

type Props = { expiresLabel?: string; promoCode?: string };

export default function DiscountD3({ expiresLabel = "Friday", promoCode = "WAITLIST25" }: Props = {}) {
  return (
    <Layout preview={`Your 25% off expires ${expiresLabel}.`}>
      <Eyebrow>Reminder · 3 days left</Eyebrow>
      <H1>Your 25% off expires {expiresLabel}</H1>
      <Body>
        Heads up — the welcome discount on Pro runs out in three days. After
        that, it's full price for everyone.
      </Body>

      <Callout title={`Code: ${promoCode}`} tone="accent">
        Applied automatically when you upgrade. 25% off your first month.
      </Callout>

      <CTARow>
        <CTA href={utm(`/upgrade?promo=${promoCode}`, CAMPAIGN, "discount-d3")}>
          Claim before {expiresLabel}
        </CTA>
        <GhostLink href={utm("/pricing", CAMPAIGN, "discount-d3-plans")}>
          See plans
        </GhostLink>
      </CTARow>
    </Layout>
  );
}

DiscountD3.PreviewProps = {
  expiresLabel: "Friday",
  promoCode: "WAITLIST25",
} satisfies Props;
