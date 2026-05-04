import * as React from "react";
import { Layout } from "../components/Layout.js";
import { Eyebrow, H1, Body, Muted } from "../components/Heading.js";
import { CTA, CTARow, GhostLink } from "../components/CTA.js";
import { utm } from "../components/brand.js";

const CAMPAIGN = "waitlist_nurture";

export default function WaitlistD0Welcome() {
  return (
    <Layout
      preview="You're on the list. Here's what's coming."
      footerNote="You're getting this because you joined the Transcribed waitlist."
    >
      <Eyebrow>D+0 · You're in</Eyebrow>
      <H1>You're on the list.</H1>
      <Body>
        We'll email you the moment cloud is open. In the meantime, the local
        version is open source and works today — same engine, runs on your
        machine.
      </Body>
      <CTARow>
        <CTA href={utm("/self-host", CAMPAIGN, "d0")}>Self-host now</CTA>
        <GhostLink href="https://github.com/lifesized/youtube-transcriber">
          Star on GitHub
        </GhostLink>
      </CTARow>
      <Muted>
        Reply to this email if you have questions or want to share what you'll
        use it for.
      </Muted>
    </Layout>
  );
}

WaitlistD0Welcome.PreviewProps = {};
