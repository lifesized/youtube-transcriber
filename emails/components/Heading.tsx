import * as React from "react";
import { Heading as REHeading, Text } from "@react-email/components";
import { brand, fonts } from "./brand.js";

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <Text style={eyebrow}>{children}</Text>;
}

export function H1({ children }: { children: React.ReactNode }) {
  return <REHeading as="h1" style={h1}>{children}</REHeading>;
}

export function H2({ children }: { children: React.ReactNode }) {
  return <REHeading as="h2" style={h2}>{children}</REHeading>;
}

export function Body({ children }: { children: React.ReactNode }) {
  return <Text style={body}>{children}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={muted}>{children}</Text>;
}

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: brand.muted2,
  margin: "0 0 12px 0",
};

const h1: React.CSSProperties = {
  fontFamily: fonts.heading,
  fontSize: 28,
  fontWeight: 600,
  letterSpacing: "-0.025em",
  lineHeight: 1.2,
  color: brand.text,
  margin: "0 0 16px 0",
};

const h2: React.CSSProperties = {
  fontFamily: fonts.heading,
  fontSize: 18,
  fontWeight: 600,
  letterSpacing: "-0.015em",
  lineHeight: 1.3,
  color: brand.text,
  margin: "24px 0 8px 0",
};

const body: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.65,
  color: brand.muted,
  margin: "0 0 16px 0",
};

const muted: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.6,
  color: brand.muted2,
  margin: "0 0 12px 0",
};
