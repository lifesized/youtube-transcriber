import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { Callout } from "../components/Callout.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "waitlist_nurture";

export default function WaitlistD9Shipped() {
  return (
    <Layout preview="What shipped this week.">
      <Eyebrow>D+9 · Changelog</Eyebrow>
      <H1>What shipped this week</H1>
      <Body>
        Three things you'll see when cloud opens — already live in the
        open-source version.
      </Body>

      <Callout title="Snappier extension boot">
        Optimistic first paint, SWR caches. The side panel feels instant in
        cloud mode now.
      </Callout>

      <Callout title="Connectors redesign">
        Official logos, toggle switches, and a fix for the Obsidian re-enable
        bug.
      </Callout>

      <Callout title="In-panel auth">
        No more bouncing to a new tab to sign in. YouTube stays visible the
        whole time.
      </Callout>

      <CTARow>
        <CTA href="https://github.com/lifesized/youtube-transcriber/blob/main/CHANGELOG.md">
          See full changelog
        </CTA>
        <GhostLink href={utm("/self-host", CAMPAIGN, "d9")}>Try locally</GhostLink>
      </CTARow>
    </Layout>
  );
}

WaitlistD9Shipped.PreviewProps = {};
