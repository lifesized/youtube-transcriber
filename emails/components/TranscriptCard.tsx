import * as React from "react";
import { Link, Section, Text, Img } from "@react-email/components";
import { brand, fonts, sizing } from "./brand.js";

type Props = {
  title: string;
  channel: string;
  duration?: string;
  href: string;
  thumbnailUrl?: string;
  summary?: string;
};

export function TranscriptCard({ title, channel, duration, href, thumbnailUrl, summary }: Props) {
  return (
    <Section style={card}>
      {thumbnailUrl ? (
        <Img src={thumbnailUrl} alt="" width={120} height={68} style={thumb} />
      ) : null}
      <Text style={meta}>
        {channel}
        {duration ? <span style={{ color: brand.borderStrong }}> · {duration}</span> : null}
      </Text>
      <Link href={href} style={titleLink}>
        {title}
      </Link>
      {summary ? <Text style={summaryStyle}>{summary}</Text> : null}
    </Section>
  );
}

const card: React.CSSProperties = {
  backgroundColor: brand.panel,
  border: `1px solid ${brand.border}`,
  borderRadius: sizing.radius,
  padding: 16,
  margin: "0 0 12px 0",
};

const thumb: React.CSSProperties = {
  borderRadius: sizing.radiusSm,
  marginBottom: 12,
  display: "block",
};

const meta: React.CSSProperties = {
  fontFamily: fonts.heading,
  fontSize: 11,
  color: brand.muted2,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  margin: "0 0 6px 0",
};

const titleLink: React.CSSProperties = {
  fontFamily: fonts.heading,
  fontSize: 15,
  fontWeight: 600,
  lineHeight: 1.35,
  color: brand.text,
  textDecoration: "none",
  display: "block",
  margin: "0 0 8px 0",
};

const summaryStyle: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  color: brand.muted,
  margin: 0,
};
