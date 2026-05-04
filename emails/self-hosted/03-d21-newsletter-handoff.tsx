import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body, Muted } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "self_hosted_crosssell";

export default function SelfHostedD21Newsletter() {
  return (
    <Layout preview="You're now on the monthly digest.">
      <Eyebrow>D+21 · Welcome to the digest</Eyebrow>
      <H1>You're on the monthly digest</H1>
      <Body>
        That's the end of the welcome series. Once a month from now on, you'll
        get a short digest: what shipped, what people transcribed, and one
        prompt or workflow worth stealing.
      </Body>
      <Body>
        No filler. If a month is quiet, the email is short. If a month is
        loud, it's still short.
      </Body>

      <CTARow>
        <CTA href="https://github.com/lifesized/youtube-transcriber/blob/main/CHANGELOG.md">
          Read the changelog
        </CTA>
        <GhostLink href={utm("/email-preferences", CAMPAIGN, "d21-prefs")}>
          Email preferences
        </GhostLink>
      </CTARow>

      <Muted>Don't want a monthly digest? One click in the footer.</Muted>
    </Layout>
  );
}

SelfHostedD21Newsletter.PreviewProps = {};
