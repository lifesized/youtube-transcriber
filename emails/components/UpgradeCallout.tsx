import * as React from "react";
import { Section, Text, Row, Column } from "@react-email/components";
import { brand, fonts, sizing } from "./brand.js";
import { CTA } from "./CTA.js";

type Props = {
  ctaHref: string;
  ctaLabel?: string;
  features?: string[];
  priceLabel?: string;
};

const DEFAULT_FEATURES = [
  "Unlimited cloud transcripts",
  "Whisper audio for caption-less videos",
  "Notion + Obsidian connectors",
  "Searchable cloud library",
];

export function UpgradeCallout({
  ctaHref,
  ctaLabel = "Upgrade to Pro",
  features = DEFAULT_FEATURES,
  priceLabel = "Pro · $9/mo",
}: Props) {
  return (
    <Section style={wrap}>
      <Text style={tier}>{priceLabel}</Text>
      <ul style={list}>
        {features.map((f) => (
          <li key={f} style={item}>
            <span style={dot}>·</span> {f}
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 16 }}>
        <CTA href={ctaHref}>{ctaLabel}</CTA>
      </div>
    </Section>
  );
}

const wrap: React.CSSProperties = {
  backgroundColor: brand.panel,
  border: `1px solid ${brand.accentDim}`,
  borderRadius: sizing.radius,
  padding: 20,
  margin: "16px 0 24px 0",
};

const tier: React.CSSProperties = {
  fontFamily: fonts.heading,
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: brand.accent,
  margin: "0 0 12px 0",
};

const list: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const item: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.65,
  color: brand.muted,
  margin: 0,
};

const dot: React.CSSProperties = {
  color: brand.accent,
  marginRight: 6,
};
