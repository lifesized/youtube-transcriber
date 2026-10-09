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
  const starred = formatDigestMessage([{ title: "foo*bar_baz", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }], 400);
  assert.match(starred, /\*foo\\\*bar\\_baz\*/);
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

test("a revoked token pauses the digest after one summary and does not call the LLM again", async () => {
  const { seen, cleanup } = seenInDir();
  try {
    seen.rememberVideos([{ videoId: VIDEO, title: "Demo", published: "2026-10-09T00:00:00Z" }]);
    const summarized = [];
    const pauses = [];
    const digest = createWatchDigest({
      seen,
      now: () => 10_000,
      slackApi: {
        postMessage: async () => {
          const err = new Error("Slack API error (token_revoked)");
          err.slackError = "token_revoked";
          throw err;
        },
      },
      localClient: {
        createTranscript: async () => ({
          id: "vid-1",
          title: "Demo",
          platform: "youtube",
          source: "youtube",
        }),
        createSummary: async (id) => {
          summarized.push(id);
          return { summary_md: "A short public summary." };
        },
      },
      onPause: (info) => pauses.push(info),
      config: {
        enabled: true,
        botToken: "xoxb-test",
        watchFeeds: [{ url: FEED }],
        digestChannel: "C01234567",
        channelAllowlist: ["C01234567"],
        digestIntervalMs: 1,
      },
    });
    const first = await digest.digestOnce({ force: true });
    assert.equal(first.ok, false);
    assert.equal(first.error, "token_revoked");
    assert.equal(first.paused, true);
    assert.equal(summarized.length, 1);
    assert.equal(seen.isPosted(VIDEO), false);
    assert.ok(seen.getCachedSummary(VIDEO));
    assert.equal(digest.isStopped(), true);
    assert.equal(pauses[0].reason, "token_revoked");
    assert.match(pauses[0].message, /revoked/i);
    const second = await digest.digestOnce({ force: true });
    assert.equal(second.skipped, "paused");
    assert.equal(summarized.length, 1, "cached summary must not call the LLM again");
  } finally {
    cleanup();
  }
});

test("tick always clears the running flag after a thrown poll", async () => {
  const { seen, cleanup } = seenInDir();
  try {
    let polls = 0;
    const digest = createWatchDigest({
      seen,
      timers: { setTimeout: () => 1, clearTimeout: () => {} },
      fetchFeed: async () => {
        polls += 1;
        throw new Error("boom");
      },
      config: {
        enabled: true,
        watchFeeds: [{ url: FEED }],
        digestChannel: "C01234567",
        channelAllowlist: ["C01234567"],
      },
    });
    digest.start();
    await digest.tick();
    await digest.tick();
    assert.equal(polls, 2, "a thrown feed must not stick the running flag or skip later ticks");
    digest.stop();
  } finally {
    cleanup();
  }
});

test("a transcript failure is retried at most 3 times then dropped", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tusk-digest-"));
  let clock = 10_000;
  const seen = createWatchSeen({ stateDir: dir, now: () => clock });
  try {
    seen.rememberVideos([{ videoId: VIDEO, title: "Demo", published: "2026-10-09T00:00:00Z" }]);
    let transcripts = 0;
    const digest = createWatchDigest({
      seen,
      now: () => clock,
      localClient: {
        createTranscript: async () => {
          transcripts += 1;
          throw new Error("whisper failed");
        },
        createSummary: async () => {
          throw new Error("must not summarize");
        },
      },
      slackApi: { postMessage: async () => ({ ok: true }) },
      config: {
        enabled: true,
        botToken: "xoxb-test",
        digestChannel: "C01234567",
        channelAllowlist: ["C01234567"],
        digestIntervalMs: 1,
      },
    });
    for (let i = 0; i < 3; i += 1) {
      const result = await digest.digestOnce({ force: true });
      assert.equal(result.skipped, "no_items");
      clock += 2 * 60 * 60 * 1000;
    }
    assert.equal(transcripts, 3);
    assert.equal(seen.isPosted(VIDEO), true);
    assert.equal(seen.videoAttempts(VIDEO), 3);
    const again = await digest.digestOnce({ force: true });
    assert.equal(again.skipped, "empty");
    assert.equal(transcripts, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a summary failure is retried at most 3 times then dropped", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tusk-digest-"));
  let clock = 10_000;
  const seen = createWatchSeen({ stateDir: dir, now: () => clock });
  try {
    seen.rememberVideos([{ videoId: VIDEO, title: "Demo", published: "2026-10-09T00:00:00Z" }]);
    let summaries = 0;
    const digest = createWatchDigest({
      seen,
      now: () => clock,
      localClient: {
        createTranscript: async () => ({
          id: "vid-1",
          title: "Demo",
          platform: "youtube",
          source: "youtube",
        }),
        createSummary: async () => {
          summaries += 1;
          throw new Error("llm failed");
        },
      },
      slackApi: { postMessage: async () => ({ ok: true }) },
      config: {
        enabled: true,
        botToken: "xoxb-test",
        digestChannel: "C01234567",
        channelAllowlist: ["C01234567"],
        digestIntervalMs: 1,
      },
    });
    for (let i = 0; i < 3; i += 1) {
      const result = await digest.digestOnce({ force: true });
      assert.equal(result.skipped, "no_items");
      clock += 2 * 60 * 60 * 1000;
    }
    assert.equal(summaries, 3);
    assert.equal(seen.isPosted(VIDEO), true);
    const again = await digest.digestOnce({ force: true });
    assert.equal(again.skipped, "empty");
    assert.equal(summaries, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("llm caps across more than 3 digests do not consume a video try", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tusk-digest-"));
  const seen = createWatchSeen({ stateDir: dir });
  try {
    seen.rememberVideos([{ videoId: VIDEO, title: "Demo", published: "2026-10-09T00:00:00Z" }]);
    const caps = [
      Object.assign(new Error("Tusk hit the hourly summary cap. Try again in a bit."), {
        code: "llm_hourly_cap",
        status: 429,
      }),
      Object.assign(new Error("Tusk hit the daily summary cap. Try again tomorrow."), {
        code: "llm_daily_cap",
        status: 429,
      }),
      Object.assign(new Error("Hourly prompt-override cap reached"), {
        status: 429,
        payload: { code: "override_hourly_cap", error: "override cap" },
      }),
      Object.assign(new Error("hourly summary cap exceeded"), { status: 429 }),
    ];
    let summaries = 0;
    const digest = createWatchDigest({
      seen,
      localClient: {
        createTranscript: async () => ({
          id: "vid-1",
          title: "Demo",
          platform: "youtube",
          source: "youtube",
        }),
        createSummary: async () => {
          const err = caps[summaries] || caps[0];
          summaries += 1;
          throw err;
        },
      },
      slackApi: {
        postMessage: async () => {
          throw new Error("must not post");
        },
      },
      config: {
        enabled: true,
        botToken: "xoxb-test",
        digestChannel: "C01234567",
        channelAllowlist: ["C01234567"],
        digestIntervalMs: 1,
      },
    });
    for (let i = 0; i < 4; i += 1) {
      const result = await digest.digestOnce({ force: true });
      assert.equal(result.skipped, "no_items");
    }
    assert.equal(summaries, 4);
    assert.equal(seen.videoAttempts(VIDEO), 0);
    assert.equal(seen.isPosted(VIDEO), false);
    assert.equal(seen.unpublished().some((row) => row.videoId === VIDEO), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("queue-full and failed transcripts stay unpublished for a later retry", async () => {
  const { seen, cleanup } = seenInDir();
  try {
    seen.rememberVideos([
      { videoId: VIDEO, title: "Demo", published: "2026-10-09T00:00:00Z" },
      { videoId: "oHg5SJYRHA0", title: "Fail", published: "2026-10-09T00:01:00Z" },
    ]);
    const digest = createWatchDigest({
      seen,
      runJob: async (key) => {
        if (key.includes(VIDEO)) return { skipped: "queue_full" };
        throw new Error("transcript failed");
      },
      slackApi: {
        postMessage: async () => {
          throw new Error("must not post");
        },
      },
      config: {
        enabled: true,
        botToken: "xoxb-test",
        digestChannel: "C01234567",
        channelAllowlist: ["C01234567"],
        digestIntervalMs: 1,
      },
    });
    const result = await digest.digestOnce({ force: true });
    assert.equal(result.skipped, "no_items");
    assert.equal(seen.isPosted(VIDEO), false);
    assert.equal(seen.isPosted("oHg5SJYRHA0"), false);
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

test("first poll reports a corrupt reseed once, then clears the flag", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tusk-reseed-"));
  try {
    require("node:fs").writeFileSync(path.join(dir, "tusk-watch-seen.json"), "{not json", "utf8");
    const seen = createWatchSeen({ stateDir: dir, now: () => 3 });
    assert.equal(seen.wasCorruptReseed(), true);
    const notices = [];
    const digest = createWatchDigest({
      seen,
      onStatus: (next) => notices.push(next),
      fetchFeed: async () => ({ ok: true, notModified: true }),
      config: {
        enabled: true,
        watchFeeds: [{ url: FEED }],
        digestChannel: "C01234567",
        channelAllowlist: ["C01234567"],
      },
    });
    const first = await digest.pollOnce();
    assert.equal(first.results[0].reseeds, true);
    assert.match(notices[0].digest.message, /corrupt/);
    assert.equal(seen.wasCorruptReseed(), false);
    const second = await digest.pollOnce();
    assert.equal(second.results.some((row) => row.reseeds), false);
    assert.equal(notices.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a timed-out feed does not skip later feeds or the digest", async () => {
  const { seen, cleanup } = seenInDir();
  try {
    const FEED_B = "https://www.youtube.com/feeds/videos.xml?playlist_id=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf";
    seen.rememberVideos([{ videoId: VIDEO, title: "Demo", published: "2026-10-09T00:00:00Z" }]);
    const fetched = [];
    const posted = [];
    const digest = createWatchDigest({
      seen,
      now: () => 10_000,
      fetchFeed: async (url) => {
        fetched.push(url);
        if (url === FEED) throw new Error("timeout");
        return { ok: true, notModified: true };
      },
      slackApi: {
        postMessage: async (args) => {
          posted.push(args);
          return { ok: true };
        },
      },
      localClient: {
        createTranscript: async () => ({
          id: "vid-1",
          title: "Demo",
          platform: "youtube",
          source: "youtube",
        }),
        createSummary: async () => ({ summary_md: "A short public summary." }),
      },
      config: {
        enabled: true,
        botToken: "xoxb-test",
        watchFeeds: [{ url: FEED }, { url: FEED_B }],
        digestChannel: "C01234567",
        channelAllowlist: ["C01234567"],
        digestIntervalMs: 1,
      },
    });
    const poll = await digest.pollOnce();
    assert.equal(poll.ok, true);
    assert.equal(poll.results.find((row) => row.url === FEED).error, "timeout");
    assert.equal(poll.results.find((row) => row.url === FEED_B).notModified, true);
    assert.deepEqual(fetched, [FEED, FEED_B]);
    const result = await digest.digestOnce({ force: true });
    assert.equal(result.ok, true);
    assert.equal(posted.length, 1);
    assert.equal(seen.isPosted(VIDEO), true);
  } finally {
    cleanup();
  }
});

test("start resends a persisted pause and does not schedule a poll", () => {
  const { seen, cleanup } = seenInDir();
  try {
    seen.pauseDigest("not_in_channel");
    const pauses = [];
    const timers = [];
    const digest = createWatchDigest({
      seen,
      onPause: (info) => pauses.push(info),
      timers: {
        setTimeout: (fn, ms) => {
          const id = { fn, ms };
          timers.push(id);
          return id;
        },
        clearTimeout: () => {},
      },
      config: {
        enabled: true,
        watchFeeds: [{ url: FEED }],
        digestChannel: "C01234567",
        channelAllowlist: ["C01234567"],
      },
    });
    digest.start();
    assert.equal(pauses.length, 1);
    assert.equal(pauses[0].reason, "not_in_channel");
    assert.match(pauses[0].message, /not in that channel/);
    assert.equal(digest.isPaused(), true);
    assert.equal(digest.hasPollScheduled(), false);
    assert.equal(timers.length, 0);
    digest.stop();
  } finally {
    cleanup();
  }
});

test("no LLM key pauses the digest instead of spending video tries", async () => {
  const { LocalApiError } = require(path.join(root, "electron/tusk/local-client.js"));
  const dir = mkdtempSync(path.join(tmpdir(), "tusk-digest-nokey-"));
  const seen = createWatchSeen({ stateDir: dir });
  try {
    seen.rememberVideos([{ videoId: VIDEO, title: "Demo", published: "2026-10-09T00:00:00Z" }]);
    let summaries = 0;
    const pauses = [];
    const digest = createWatchDigest({
      seen,
      onPause: (info) => pauses.push(info),
      localClient: {
        createTranscript: async () => ({
          id: "vid-1",
          title: "Demo",
          platform: "youtube",
          source: "youtube",
        }),
        createSummary: async () => {
          summaries += 1;
          throw new LocalApiError({
            status: 503,
            message: "Choose Anthropic or OpenAI in Settings and add an API key, or set an OpenRouter key.",
          });
        },
      },
      slackApi: {
        postMessage: async () => {
          throw new Error("must not post");
        },
      },
      config: {
        enabled: true,
        botToken: "xoxb-test",
        digestChannel: "C01234567",
        channelAllowlist: ["C01234567"],
        digestIntervalMs: 1,
      },
    });
    for (let i = 0; i < 4; i += 1) {
      const result = await digest.digestOnce({ force: true });
      assert.equal(result.skipped, "paused");
      assert.equal(result.reason, "no_llm");
    }
    assert.equal(summaries, 1);
    assert.equal(seen.videoAttempts(VIDEO), 0);
    assert.equal(seen.isPosted(VIDEO), false);
    assert.equal(seen.isDigestPaused(), true);
    assert.equal(seen.digestPauseReason(), "no_llm");
    assert.equal(pauses[0].reason, "no_llm");
    assert.match(pauses[0].message, /AI key/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("digest pauses for a missing AI key before calling summarize", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tusk-digest-haskey-"));
  const seen = createWatchSeen({ stateDir: dir });
  try {
    seen.rememberVideos([{ videoId: VIDEO, title: "Demo", published: "2026-10-09T00:00:00Z" }]);
    let transcripts = 0;
    const digest = createWatchDigest({
      seen,
      hasLlmKey: () => false,
      localClient: {
        createTranscript: async () => {
          transcripts += 1;
          throw new Error("must not transcribe");
        },
        createSummary: async () => {
          throw new Error("must not summarize");
        },
      },
      slackApi: {
        postMessage: async () => {
          throw new Error("must not post");
        },
      },
      config: {
        enabled: true,
        botToken: "xoxb-test",
        digestChannel: "C01234567",
        channelAllowlist: ["C01234567"],
        digestIntervalMs: 1,
      },
    });
    const result = await digest.digestOnce({ force: true });
    assert.equal(result.skipped, "paused");
    assert.equal(result.reason, "no_llm");
    assert.equal(transcripts, 0);
    assert.equal(seen.videoAttempts(VIDEO), 0);
    assert.equal(seen.isDigestPaused(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
