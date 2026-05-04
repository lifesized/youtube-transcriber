import * as React from "react";
import { Section, Text } from "@react-email/components";
import { brand, fonts, sizing } from "./brand.js";

type CalloutProps = {
  title?: string;
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "danger";
};

export function Callout({ title, children, tone = "neutral" }: CalloutProps) {
  const palette = tones[tone];
  return (
    <Section
      style={{
        backgroundColor: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: sizing.radius,
        padding: 20,
        margin: "16px 0 24px 0",
      }}
    >
      {title ? <Text style={{ ...titleStyle, color: palette.title }}>{title}</Text> : null}
      <div style={{ color: brand.muted, fontSize: 14, lineHeight: 1.6 }}>{children}</div>
    </Section>
  );
}

const tones = {
  neutral: { bg: brand.panel, border: brand.border, title: brand.text },
  accent: { bg: "#1a1410", border: brand.accentDim, title: brand.accent },
  danger: { bg: "#1f1212", border: "#3a1f1f", title: brand.danger },
};

const titleStyle: React.CSSProperties = {
  fontFamily: fonts.heading,
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "-0.01em",
  margin: "0 0 8px 0",
};
