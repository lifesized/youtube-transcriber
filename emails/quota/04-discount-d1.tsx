import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body } from "../components/Heading.js";
import { CTA, CTARow } from "../components/CTA.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "quota_upgrade";

type Props = { promoCode?: string };

export default function DiscountD1({ promoCode = "WAITLIST25" }: Props = {}) {
  return (
    <Layout preview="Last day for 25% off Pro.">
      <Eyebrow>Last day</Eyebrow>
      <H1>Last day for 25% off</H1>
      <Body>
        Code <strong>{promoCode}</strong> expires tonight at midnight. After
        that, Pro is $9/month — no exceptions.
      </Body>

      <CTARow>
        <CTA href={utm(`/upgrade?promo=${promoCode}`, CAMPAIGN, "discount-d1")}>
          Upgrade now
        </CTA>
      </CTARow>
    </Layout>
  );
}

DiscountD1.PreviewProps = { promoCode: "WAITLIST25" } satisfies Props;
