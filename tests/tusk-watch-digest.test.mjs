import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createWatchDigest, formatDigestMessage, digestChannelAllowed } = require(
  path.join(root, "electron/tusk/watch-digest.js")
);
const { createWatchSeen } = require(path.join(root, "electron/tusk/watch-seen.js"));
const { escapeSlackMrkdwn } = require(path.join(root, "electron/tusk/format.js"));

const CHANNEL = "UCuAXFkgsw1L7xaCfnd5JJOw";
const VIDEO = "dQw4w9WgXcQ";
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`;
const HOSTILE = "<!channel> <@Uevil> <https://evil|Click>";

function seenInDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "tusk-digest-"));
  return {
    seen: createWatchSeen({ stateDir: dir }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("digest channel must be on the allowlist", () => {
  assert.equal(digestChannelAllowed("C01234567", ["C01234567"]), true);
  assert.equal(digestChannelAllowed("C01234567", []), false);
  assert.equal(digestChannelAllowed("C99999999", ["C01234567"]), false);
  assert.equal(digestChannelAllowed("", ["C01234567"]), false);
});

test("digest titles and URLs are escaped; hostile titles cannot ping", () => {
  const text = formatDigestMessage(
    [
      {
        title: HOSTILE,
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        summary: "Uses <https://evil|click>",
      },
    ],
    400
  );
  assert.match(text, /\*Tusk watch digest\*/);
  assert.equal(text.includes(escapeSlackMrkdwn(HOSTILE)), true);
  assert.doesNotMatch(text, /<!channel>/);
  assert.doesNotMatch(text, /<@Uevil>/);
  assert.doesNotMatch(text, /<https:\/\/evil\|Click>/);
  assert.match(text, /https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ/);
});

test("first poll seeds seen videos and does not digest them", async () => {
  const { seen, cleanup } = seenInDir();
  try {
    const posted = [];
    const digest = createWatchDigest({
      seen,
      now: () => 1_000,
      slackApi: {
        postMessage: async (args) => {
          posted.push(args);
          return { ok: true, ts: "1.2" };
        },
      },
      localClient: {
        createTranscript: async () => {
          throw new Error("must not transcribe seeded videos");
        },
        createSummary: async () => {
          throw new Error("must not summarize seeded videos");
        },
      },
      fetchFeed: async () => ({
        ok: true,
        entries: [{ videoId: VIDEO, title: "Demo", url: `https://www.youtube.com/watch?v=${VIDEO}` }],
      }),
      config: {
        enabled: true,
        botToken: "xoxb-test",
        watchFeeds: [{ url: FEED }],
        digestChannel: "C01234567",
        channelAllowlist: ["C01234567"],
        digestIntervalMs: 1,
      },
    });
    const poll = await digest.pollOnce();
    assert.equal(poll.ok, true);
    assert.equal(poll.results[0].seeded, true);
    assert.equal(seen.isPosted(VIDEO), true);
    const result = await digest.digestOnce({ force: true });
    assert.equal(result.skipped, "empty");
    assert.equal(posted.length, 0);
  } finally {
    cleanup();
  }
});

test("digest posts new public YouTube videos and skips signed-in cache hits", async () => {
  const { seen, cleanup } = seenInDir();
  try {
    seen.rememberVideos([
      { videoId: VIDEO, title: "Demo", published: "2026-10-09T00:00:00Z" },
      { videoId: "oHg5SJYRHA0", title: "Scrape", published: "2026-10-09T00:01:00Z" },
    ]);
    const posted = [];
    const summarized = [];
    const digest = createWatchDigest({
      seen,
      now: () => 10_000,
      slackApi: {
        postMessage: async (args) => {
          posted.push(args);
          return { ok: true, ts: "1.2" };
        },
      },
      localClient: {
        createTranscript: async (url, extra) => {
          assert.equal(extra.jobTag, "tusk");
          assert.equal(typeof extra.jobId, "string");
          assert.ok(extra.jobId.length >= 8);
          if (url.includes("oHg5SJYRHA0")) {
            return {
              id: "scrape-1",
              title: "Scrape",
              platform: "youtube",
              source: "client_panel_scrape",
            };
          }
          return { id: "vid-1", title: "Demo", platform: "youtube", source: "youtube" };
        },
        createSummary: async (id, extra) => {
          summarized.push({ id, extra });
          return { summary_md: "A short public summary." };
        },
      },
      config: {
        enabled: true,
        botToken: "xoxb-test",
        watchFeeds: [{ url: FEED }],
        digestChannel: "C01234567",
        channelAllowlist: ["C01234567"],
        digestIntervalMs: 1,
        maxVideos: 5,
      },
    });
    const result = await digest.digestOnce({ force: true });
    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].botToken, "xoxb-test");
    assert.equal(posted[0].channel, "C01234567");
    assert.match(posted[0].text, /Demo/);
    assert.doesNotMatch(posted[0].text, /Scrape/);
    assert.equal(summarized.length, 1);
    assert.match(summarized[0].extra.promptOverride, /Demo/);
    assert.equal(summarized[0].extra.jobTag, "tusk");
    assert.equal(typeof summarized[0].extra.jobId, "string");
    assert.equal(seen.isPosted(VIDEO), true);
    assert.equal(seen.isPosted("oHg5SJYRHA0"), true);
  } finally {
    cleanup();
  }
});

test("digest refuses to post when the destination is not allowlisted", async () => {
  const { seen, cleanup } = seenInDir();
  try {
    seen.rememberVideos([{ videoId: VIDEO, title: "Demo", published: "2026-10-09T00:00:00Z" }]);
    const digest = createWatchDigest({
      seen,
      slackApi: {
        postMessage: async () => {
          throw new Error("must not post");
        },
      },
      localClient: {
        createTranscript: async () => ({ id: "vid-1", title: "Demo", platform: "youtube" }),
        createSummary: async () => ({ summary_md: "x" }),
      },
      config: {
        enabled: true,
        botToken: "xoxb-test",
        digestChannel: "C01234567",
        channelAllowlist: [],
        digestIntervalMs: 1,
      },
    });
    const result = await digest.digestOnce({ force: true });
    assert.equal(result.skipped, "channel");
  } finally {
    cleanup();
  }
});
