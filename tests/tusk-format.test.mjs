import assert from "node:assert/strict";
import test from "node:test";
import { parseSlackArtifactMarkdown, renderSlackArtifactMarkdown } from "../lib/tusk/format.ts";

test("renders structured primitives into Slack markdown", () => {
  const markdown = renderSlackArtifactMarkdown({
    title: "Slack OAuth walkthrough",
    sourceUrl: "https://youtu.be/dQw4w9WgXcQ",
    tldr: "Adds Slack OAuth and event handling.",
    links: ["https://github.com/acme/transcriber"],
    commands: ["npm run dev"],
    actionItems: ["Create Slack dev app"],
    risks: ["Bot scopes may need security review"],
  });
  assert.match(markdown, /\*Slack OAuth walkthrough\*/);
  assert.match(markdown, /\*✦ Summary\*/);
  assert.match(markdown, /• https:\/\/github.com\/acme\/transcriber/);
  assert.match(markdown, /• npm run dev/);
  assert.match(markdown, /• Create Slack dev app/);
});

test("omits empty sections", () => {
  assert.equal(renderSlackArtifactMarkdown({ tldr: "Only a summary." }), "*✦ Summary*\nOnly a summary.");
});

test("parses a typical LLM markdown response into structured sections", () => {
  const raw = [
    "*✦ Summary*",
    "Adds Slack OAuth support and event handling.",
    "",
    "*↗ Links*",
    "• https://github.com/acme/transcriber",
    "• https://api.slack.com/events",
    "",
    "*→ Next steps*",
    "• Create Slack dev app",
    "• Configure event subscriptions",
  ].join("\n");
  const parsed = parseSlackArtifactMarkdown(raw, {
    title: "Slack OAuth walkthrough",
    sourceUrl: "https://youtu.be/dQw4w9WgXcQ",
  });
  assert.equal(parsed.title, "Slack OAuth walkthrough");
  assert.equal(parsed.tldr, "Adds Slack OAuth support and event handling.");
  assert.deepEqual(parsed.links, [
    "https://github.com/acme/transcriber",
    "https://api.slack.com/events",
  ]);
  assert.deepEqual(parsed.actionItems, [
    "Create Slack dev app",
    "Configure event subscriptions",
  ]);
});

test("renders into Slack markdown ending up under the 3800-char ceiling", () => {
  const parsed = parseSlackArtifactMarkdown(`*✦ Summary*\n${"x".repeat(5000)}`, {
    title: "Long video",
    sourceUrl: "https://youtu.be/long",
  });
  const rendered = renderSlackArtifactMarkdown(parsed);
  assert.ok(rendered.length <= 3800);
});
