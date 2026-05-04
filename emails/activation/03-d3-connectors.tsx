import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { Callout } from "../components/Callout.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "cloud_activation";

export default function ActivationD3Connectors() {
  return (
    <Layout preview="Send transcripts to Notion or Obsidian in one click.">
      <Eyebrow>D+3 · Connectors</Eyebrow>
      <H1>Push transcripts where they belong</H1>
      <Body>
        Stop copy-pasting. Connect once, then any transcript goes to your
        knowledge base from the row's <code>⋯</code> menu.
      </Body>

      <Callout title="Notion" tone="neutral">
        OAuth, encrypted token storage. Works best with a dedicated database
        you share with the integration.
      </Callout>
      <Callout title="Obsidian" tone="neutral">
        Stateless. The extension builds an <code>obsidian://</code> URL on
        your machine. Nothing transcript-related leaves your device.
      </Callout>

      <CTARow>
        <CTA href={utm("/settings/connectors?provider=notion", CAMPAIGN, "d3-notion")}>
          Connect Notion
        </CTA>
        <GhostLink href={utm("/settings/connectors?provider=obsidian", CAMPAIGN, "d3-obsidian")}>
          Connect Obsidian
        </GhostLink>
      </CTARow>
    </Layout>
  );
}

ActivationD3Connectors.PreviewProps = {};
