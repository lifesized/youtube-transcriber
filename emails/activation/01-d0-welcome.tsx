import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body, Muted } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { Callout } from "../components/Callout.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "cloud_activation";

type Props = { firstName?: string; apiKey?: string };

export default function ActivationD0Welcome({ firstName, apiKey }: Props = {}) {
  return (
    <Layout
      preview="Welcome to Transcribed. Here's how to start."
      footerNote="Account confirmation — sent because you signed up at transcribed.dev."
    >
      <Eyebrow>D+0 · Welcome</Eyebrow>
      <H1>{firstName ? `Welcome, ${firstName}.` : "Welcome to Transcribed."}</H1>
      <Body>
        Your account's confirmed. You've got 30 free transcripts a month, no
        card required. Here's the fastest way to your first one.
      </Body>

      <CTARow>
        <CTA href="https://chromewebstore.google.com/detail/transcribed">
          Install the extension
        </CTA>
        <GhostLink href={utm("/dashboard", CAMPAIGN, "d0-dash")}>
          Open dashboard
        </GhostLink>
      </CTARow>

      {apiKey ? (
        <Callout title="Your API key" tone="neutral">
          {apiKey}
          <br />
          Use it for the MCP server, REST API, or extension self-hosted mode.
        </Callout>
      ) : null}

      <Muted>
        Reply to this email if anything's broken. A real human reads these.
      </Muted>
    </Layout>
  );
}

ActivationD0Welcome.PreviewProps = {
  firstName: "Sam",
  apiKey: "ttd_live_••••••••••••••••a3f9",
} satisfies Props;
