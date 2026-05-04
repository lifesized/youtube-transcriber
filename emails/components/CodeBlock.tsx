import * as React from "react";
import { Section } from "@react-email/components";
import { brand, fonts, sizing } from "./brand.js";

export function CodeBlock({ children }: { children: string }) {
  return (
    <Section style={wrap}>
      <pre style={pre}>{children}</pre>
    </Section>
  );
}

const wrap: React.CSSProperties = {
  margin: "12px 0 20px 0",
};

const pre: React.CSSProperties = {
  backgroundColor: brand.panel2,
  border: `1px solid ${brand.border}`,
  borderRadius: sizing.radiusSm,
  color: brand.muted,
  fontFamily: fonts.mono,
  fontSize: 12.5,
  lineHeight: 1.6,
  padding: 16,
  margin: 0,
  overflowX: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
