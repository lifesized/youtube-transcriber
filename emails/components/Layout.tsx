import * as React from "react";
import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
  Link,
  Hr,
  Font,
} from "@react-email/components";
import { brand, fonts, sizing, APP_URL } from "./brand.js";

type LayoutProps = {
  preview: string;
  children: React.ReactNode;
  preferencesUrl?: string;
  unsubscribeUrl?: string;
  footerNote?: string;
};

const senderAddress = "Transcribed · Brooklyn, NY";

export function Layout({
  preview,
  children,
  preferencesUrl = `${APP_URL}/email-preferences`,
  unsubscribeUrl = `${APP_URL}/unsubscribe`,
  footerNote,
}: LayoutProps) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="dark light" />
        <meta name="supported-color-schemes" content="dark light" />
        <Font
          fontFamily="Outfit"
          fallbackFontFamily="Helvetica"
          webFont={{
            url: "https://fonts.gstatic.com/s/outfit/v11/QGYvz_MVcBeNP4NJtEtq.woff2",
            format: "woff2",
          }}
          fontWeight={400}
          fontStyle="normal"
        />
        <Font
          fontFamily="Outfit"
          fallbackFontFamily="Helvetica"
          webFont={{
            url: "https://fonts.gstatic.com/s/outfit/v11/QGYvz_MVcBeNP4NJtEtq.woff2",
            format: "woff2",
          }}
          fontWeight={600}
          fontStyle="normal"
        />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brandHeader}>
            <Text style={brandWordmark}>
              <span style={{ color: brand.text }}>Transcribed</span>
              <span style={{ color: brand.accent, marginLeft: 4 }}>·</span>
              <span style={{ color: brand.muted2, marginLeft: 4 }}>dev</span>
            </Text>
          </Section>

          <Section style={content}>{children}</Section>

          <Hr style={divider} />

          <Section style={footer}>
            {footerNote ? <Text style={footerCopy}>{footerNote}</Text> : null}
            <Text style={footerCopy}>
              <Link href={preferencesUrl} style={footerLink}>
                Email preferences
              </Link>
              <span style={footerSep}>·</span>
              <Link href={unsubscribeUrl} style={footerLink}>
                Unsubscribe
              </Link>
            </Text>
            <Text style={footerAddress}>{senderAddress}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: brand.bg,
  color: brand.text,
  fontFamily: fonts.body,
  margin: 0,
  padding: "32px 16px",
  WebkitFontSmoothing: "antialiased",
};

const container: React.CSSProperties = {
  width: "100%",
  maxWidth: sizing.containerWidth,
  margin: "0 auto",
  backgroundColor: brand.bg,
};

const brandHeader: React.CSSProperties = {
  paddingBottom: 24,
};

const brandWordmark: React.CSSProperties = {
  fontFamily: fonts.heading,
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: "-0.01em",
  margin: 0,
};

const content: React.CSSProperties = {
  paddingBottom: 32,
};

const divider: React.CSSProperties = {
  borderColor: brand.border,
  borderWidth: 0,
  borderTopWidth: 1,
  borderStyle: "solid",
  margin: "0 0 24px 0",
};

const footer: React.CSSProperties = {
  textAlign: "left",
};

const footerCopy: React.CSSProperties = {
  fontSize: 12,
  color: brand.muted2,
  margin: "0 0 8px 0",
  lineHeight: 1.5,
};

const footerLink: React.CSSProperties = {
  color: brand.muted,
  textDecoration: "underline",
  textUnderlineOffset: 2,
};

const footerSep: React.CSSProperties = {
  color: brand.borderStrong,
  margin: "0 8px",
};

const footerAddress: React.CSSProperties = {
  fontSize: 11,
  color: brand.borderStrong,
  margin: 0,
};
