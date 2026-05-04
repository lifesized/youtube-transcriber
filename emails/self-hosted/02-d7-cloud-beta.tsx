import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body, Muted } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { Callout } from "../components/Callout.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "self_hosted_crosssell";

export default function SelfHostedD7CloudBeta() {
  return (
    <Layout preview="Cloud beta is open if you want it. Honest comparison inside.">
      <Eyebrow>D+7 · Cloud is open</Eyebrow>
      <H1>Cloud is open if you want it</H1>
      <Body>
        Self-hosting works great. Cloud is for the cases it doesn't.
      </Body>

      <Callout title="Stay self-hosted when" tone="neutral">
        You want everything local. Audio never leaves your machine. You don't
        mind installing yt-dlp + Whisper. Free forever.
      </Callout>

      <Callout title="Try cloud when" tone="accent">
        You want the extension on a second machine. You're tired of pip
        errors. You want Whisper audio without setting up MLX. You want a
        searchable cloud library across devices.
      </Callout>

      <Body>
        Same code. Same engine. Same brain. Pick the friction you'd rather
        eat.
      </Body>

      <CTARow>
        <CTA href={utm("/signup?ref=self-hosted", CAMPAIGN, "d7-beta")}>
          Get a cloud invite
        </CTA>
        <GhostLink href="https://github.com/lifesized/youtube-transcriber">
          Stay self-hosted
        </GhostLink>
      </CTARow>

      <Muted>No upsell pressure. Either choice is the right choice.</Muted>
    </Layout>
  );
}

SelfHostedD7CloudBeta.PreviewProps = {};
