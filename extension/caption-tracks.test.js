"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isAsrTrack,
  selectCaptionTrack,
  isSameOriginYoutubeTimedText,
  withCaptionFmt,
  parseJson3,
  parseVtt,
  timedtextWithinLimit,
  tracksMatchCurrentVideo,
  MAX_TIMEDTEXT_BYTES,
  MAX_TIMEDTEXT_SEGMENTS,
} = require("./caption-tracks.js");

test("selectCaptionTrack prefers a manual track over ASR", () => {
  const tracks = [
    { languageCode: "en", vssId: "a.en", kind: "asr", baseUrl: "https://www.youtube.com/api/timedtext?v=a&kind=asr" },
    { languageCode: "en", vssId: ".en", baseUrl: "https://www.youtube.com/api/timedtext?v=m" },
    { languageCode: "es", vssId: ".es", baseUrl: "https://www.youtube.com/api/timedtext?v=es" },
  ];
  const picked = selectCaptionTrack(tracks, ["en"]);
  assert.equal(picked.vssId, ".en");
  assert.equal(isAsrTrack(picked), false);
  const es = selectCaptionTrack(tracks, ["fr", "es"]);
  assert.equal(es.languageCode, "es");
  const asrOnly = selectCaptionTrack(
    [tracks[0]],
    ["en"]
  );
  assert.equal(asrOnly.kind, "asr");
});

test("isSameOriginYoutubeTimedText allows only youtube timedtext", () => {
  assert.equal(
    isSameOriginYoutubeTimedText("https://www.youtube.com/api/timedtext?v=x"),
    true
  );
  assert.equal(
    isSameOriginYoutubeTimedText("https://m.youtube.com/api/timedtext?v=x"),
    true
  );
  assert.equal(
    isSameOriginYoutubeTimedText("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    false
  );
  assert.equal(
    isSameOriginYoutubeTimedText("https://evil.example/api/timedtext"),
    false
  );
  assert.equal(
    isSameOriginYoutubeTimedText("https://user:pass@www.youtube.com/api/timedtext"),
    false
  );
  assert.equal(
    isSameOriginYoutubeTimedText("https://www.youtube.com:8443/api/timedtext"),
    false
  );
});

test("parseJson3 and parseVtt produce start/duration/text segments", () => {
  const json3 = {
    events: [
      { tStartMs: 0, dDurationMs: 1200, segs: [{ utf8: "Hello" }] },
      { tStartMs: 1200, dDurationMs: 800, segs: [{ utf8: " " }, { utf8: "world" }] },
      { tStartMs: 2000, segs: [{ utf8: "\n" }] },
    ],
  };
  const fromJson = parseJson3(JSON.stringify(json3));
  assert.deepEqual(fromJson, [
    { start: 0, duration: 1.2, text: "Hello" },
    { start: 1.2, duration: 0.8, text: "world" },
  ]);

  const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.200
Hello

00:00:01.200 --> 00:00:02.000
world
`;
  const fromVtt = parseVtt(vtt);
  assert.equal(fromVtt.length, 2);
  assert.equal(fromVtt[0].text, "Hello");
  assert.equal(fromVtt[1].text, "world");
  assert.ok(Math.abs(fromVtt[1].start - 1.2) < 0.001);

  const fmtUrl = withCaptionFmt("https://www.youtube.com/api/timedtext?v=x", "json3");
  assert.match(fmtUrl, /fmt=json3/);
});

test("tracksMatchCurrentVideo requires an exact video id", () => {
  assert.equal(
    tracksMatchCurrentVideo({ videoId: "dQw4w9WgXcQ", tracks: [{}] }, "dQw4w9WgXcQ"),
    true
  );
  assert.equal(
    tracksMatchCurrentVideo({ videoId: "aaaaaaaaaaa", tracks: [{}] }, "dQw4w9WgXcQ"),
    false
  );
  assert.equal(tracksMatchCurrentVideo({ tracks: [{}] }, "dQw4w9WgXcQ"), false);
  assert.equal(tracksMatchCurrentVideo({ videoId: "dQw4w9WgXcQ" }, null), false);
});

test("timedtext body is capped at ~5 MB and parsers stop at the segment limit", () => {
  assert.equal(MAX_TIMEDTEXT_BYTES, 5 * 1024 * 1024);
  assert.equal(MAX_TIMEDTEXT_SEGMENTS, 20_000);
  assert.equal(timedtextWithinLimit("ok"), true);
  assert.equal(timedtextWithinLimit("x".repeat(MAX_TIMEDTEXT_BYTES)), true);
  assert.equal(timedtextWithinLimit("x".repeat(MAX_TIMEDTEXT_BYTES + 1)), false);
  assert.equal(timedtextWithinLimit(null), false);

  const events = [];
  for (let i = 0; i < MAX_TIMEDTEXT_SEGMENTS + 40; i++) {
    events.push({ tStartMs: i * 100, dDurationMs: 100, segs: [{ utf8: `s${i}` }] });
  }
  const parsed = parseJson3({ events });
  assert.equal(parsed.length, MAX_TIMEDTEXT_SEGMENTS);
  assert.equal(parsed[0].text, "s0");
  assert.equal(parsed[parsed.length - 1].text, `s${MAX_TIMEDTEXT_SEGMENTS - 1}`);
});
