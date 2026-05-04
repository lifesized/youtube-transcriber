import * as React from "react";
import { Button, Section, Link } from "@react-email/components";
import { brand, fonts, sizing } from "./brand.js";

type CTAProps = {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
};

export function CTA({ href, children, variant = "primary" }: CTAProps) {
  const style = variant === "primary" ? primary : secondary;
  return (
    <Button href={href} style={style}>
      {children}
    </Button>
  );
}

export function CTARow({ children }: { children: React.ReactNode }) {
  return <Section style={row}>{children}</Section>;
}

export function GhostLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={ghost}>
      {children}
    </Link>
  );
}

const base: React.CSSProperties = {
  display: "inline-block",
  fontFamily: fonts.heading,
  fontSize: 14,
  fontWeight: 500,
  borderRadius: sizing.radiusSm,
  padding: "12px 20px",
  textDecoration: "none",
  textAlign: "center",
};

const primary: React.CSSProperties = {
  ...base,
  backgroundColor: brand.accent,
  color: brand.bg,
  border: `1px solid ${brand.accent}`,
};

const secondary: React.CSSProperties = {
  ...base,
  backgroundColor: "transparent",
  color: brand.text,
  border: `1px solid ${brand.borderStrong}`,
};

const row: React.CSSProperties = {
  margin: "8px 0 24px 0",
  textAlign: "left",
};

const ghost: React.CSSProperties = {
  fontFamily: fonts.heading,
  fontSize: 13,
  fontWeight: 500,
  color: brand.muted,
  textDecoration: "underline",
  textUnderlineOffset: 2,
  marginLeft: 16,
};
