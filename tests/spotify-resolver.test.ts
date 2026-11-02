import assert from "node:assert/strict";
import test from "node:test";
import {
  findItunesEpisode,
  findMatchingEpisode,
  parseRssFeed,
  sanitizeSpotifyTitleHint,
} from "../lib/spotify.js";

const VIDEO_PODCAST_TITLE = "Why the Self Became Our God | Tara Isabella Burton";

const AUDIO_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss><channel>
  <item>
    <title><![CDATA[Why the Self Became Our God | Tara Isabella Burton]]></title>
    <enclosure url="https://anchor.fm/s/105e5b1a8/podcast/play/128497027/https%3A%2F%2Fcdn.example/ep.mp3" length="67049847" type="audio/mpeg"/>
    <itunes:duration>01:09:50</itunes:duration>
  </item>
  <item>
    <title>Unrelated Episode</title>
    <enclosure url="https://cdn.example/other.mp3" type="audio/mpeg"/>
    <itunes:duration>00:10:00</itunes:duration>
  </item>
</channel></rss>`;

const VIDEO_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:media="http://search.yahoo.com/mrss/" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
  <item>
    <title><![CDATA[Why the Self Became Our God | Tara Isabella Burton]]></title>
    <itunes:duration>4190</itunes:duration>
    <media:content url="https://cdn.example/video-podcast.mp4" type="video/mp4" medium="video" fileSize="250000000"/>
  </item>
</channel></rss>`;

const MIXED_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <item>
    <title>Why the Self Became Our God | Tara Isabella Burton</title>
    <enclosure type="video/mp4" url="https://cdn.example/video-only.mp4" length="250000000"/>
    <itunes:duration>01:09:50</itunes:duration>
  </item>
</channel></rss>`;

test("parseRssFeed reads CDATA titles and audio enclosures from a video podcast's public feed", () => {
  const episodes = parseRssFeed(AUDIO_RSS);
  assert.equal(episodes.length, 2);
  assert.equal(episodes[0].title, VIDEO_PODCAST_TITLE);
  assert.match(episodes[0].audioUrl, /ep\.mp3$/);
  assert.equal(episodes[0].durationMs, (1 * 3600 + 9 * 60 + 50) * 1000);
});

test("parseRssFeed falls back to media:content for video-podcast episodes without an enclosure", () => {
  const episodes = parseRssFeed(VIDEO_RSS);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].title, VIDEO_PODCAST_TITLE);
  assert.equal(episodes[0].audioUrl, "https://cdn.example/video-podcast.mp4");
});

test("parseRssFeed accepts video/mp4 enclosures as the download URL", () => {
  const episodes = parseRssFeed(MIXED_RSS);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].audioUrl, "https://cdn.example/video-only.mp4");
});

test("findMatchingEpisode matches the Philosophy Everyday video-podcast title", () => {
  const episodes = parseRssFeed(AUDIO_RSS);
  const matched = findMatchingEpisode(episodes, VIDEO_PODCAST_TITLE, 4190000);
  assert.ok(matched);
  assert.equal(matched.title, VIDEO_PODCAST_TITLE);
});

test("sanitizeSpotifyTitleHint strips the browser tab suffix", () => {
  assert.equal(
    sanitizeSpotifyTitleHint(
      "Why the Self Became Our God | Tara Isabella Burton | Philosophy Everyday | Spotify"
    ),
    "Why the Self Became Our God | Tara Isabella Burton | Philosophy Everyday"
  );
  assert.equal(sanitizeSpotifyTitleHint("  "), null);
});

test("findItunesEpisode matches a video-podcast episode from iTunes search results", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    assert.match(url, /itunes\.apple\.com\/search/);
    assert.match(url, /entity=podcastEpisode/);
    return new Response(
      JSON.stringify({
        resultCount: 1,
        results: [
          {
            trackName: VIDEO_PODCAST_TITLE,
            collectionName: "Philosophy Everyday",
            episodeUrl:
              "https://anchor.fm/s/105e5b1a8/podcast/play/128497027/https%3A%2F%2Fcdn.example/ep.mp3",
            feedUrl: "https://anchor.fm/s/105e5b1a8/podcast/rss",
            trackTimeMillis: 4190000,
            artworkUrl600: "https://cdn.example/art.jpg",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await findItunesEpisode(VIDEO_PODCAST_TITLE);
    assert.ok(result);
    assert.equal(result.title, VIDEO_PODCAST_TITLE);
    assert.equal(result.collectionName, "Philosophy Everyday");
    assert.match(result.audioUrl, /ep\.mp3$/);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
