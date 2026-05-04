import * as React from "react";
import { Section, Text } from "@react-email/components";
import { brand, fonts } from "./brand.js";

export function UsageBar({
  used,
  total,
  label = "Free transcripts used",
}: {
  used: number;
  total: number;
  label?: string;
}) {
  const pct = Math.min(100, Math.round((used / total) * 100));
  const tone = pct >= 100 ? brand.danger : pct >= 80 ? brand.accent : brand.muted;
  return (
    <Section style={{ margin: "16px 0 24px 0" }}>
      <Text style={meta}>
        {label} · <span style={{ color: tone }}>{used}/{total}</span>
      </Text>
      <div style={track}>
        <div style={{ ...fill, width: `${pct}%`, backgroundColor: tone }} />
      </div>
    </Section>
  );
}

const meta: React.CSSProperties = {
  fontFamily: fonts.heading,
  fontSize: 12,
  color: brand.muted2,
  margin: "0 0 8px 0",
  letterSpacing: "0.02em",
};

const track: React.CSSProperties = {
  width: "100%",
  height: 6,
  backgroundColor: brand.panel,
  border: `1px solid ${brand.border}`,
  borderRadius: 4,
  overflow: "hidden",
};

const fill: React.CSSProperties = {
  height: "100%",
  borderRadius: 4,
};
