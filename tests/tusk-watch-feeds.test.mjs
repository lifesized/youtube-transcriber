import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const feeds = require(path.join(root, "electron/tusk/watch-feeds.js"));

const CHANNEL = "UCuAXFkgsw1L7xaCfnd5JJOw";
const PLAYLIST = "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf";
const VIDEO = "dQw4w9WgXcQ";
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`;

test("rebuilds only www.youtube.com/feeds/videos.xml with channel_id or playlist_id", () => {
  assert.equal(feeds.parseWatchFeedInput(CHANNEL).url, FEED);
  assert.equal(
    feeds.parseWatchFeedInput(`https://www.youtube.com/channel/${CHANNEL}`).url,
    FEED
  );
  assert.equal(feeds.parseWatchFeedInput(FEED).ok, true);
  assert.equal(
    feeds.parseWatchFeedInput(`https://www.youtube.com/playlist?list=${PLAYLIST}`).kind,
    "playlist"
  );
  assert.equal(
    feeds.parseWatchFeedInput(`https://www.youtube.com/feeds/videos.xml?playlist_id=${PLAYLIST}`).ok,
    true
  );
  assert.equal(feeds.parseWatchFeedInput("http://www.youtube.com/feeds/videos.xml?channel_id=" + CHANNEL).ok, false);
  assert.equal(feeds.parseWatchFeedInput("https://evil.example/feeds/videos.xml?channel_id=" + CHANNEL).ok, false);
  assert.equal(
    feeds.parseWatchFeedInput(`https://www.youtube.com:8443/feeds/videos.xml?channel_id=${CHANNEL}`).ok,
    false
  );
  assert.equal(
    feeds.parseWatchFeedInput(`https://user:pass@www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`).ok,
    false
  );
  assert.equal(feeds.parseWatchFeedInput("https://www.youtube.com/feeds/videos.xml").ok, false);
  assert.equal(feeds.parseWatchFeedInput("https://www.youtube.com/@rickastley").ok, false);
  assert.equal(feeds.parseWatchFeedInput(FEED).url, FEED);
  assert.equal(feeds.isValidFeedUrl("https://www.youtube.com/watch?v=" + VIDEO), false);
});

test("parseWatchlistText keeps unique rebuilt feed URLs", () => {
  const list = feeds.parseWatchlistText(`${CHANNEL}\n${FEED}\nhttps://www.youtube.com/playlist?list=${PLAYLIST}\nbad`);
  assert.equal(list.length, 2);
  assert.equal(list[0].kind, "channel");
  assert.equal(list[1].kind, "playlist");
  assert.ok(list.every((item) => item.url.startsWith("https://www.youtube.com/feeds/videos.xml?")));
});

test("Atom parser reads yt:videoId, rebuilds the watch URL, and decodes entities last", () => {
  const xml = `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>yt:video:${VIDEO}</id>
    <yt:videoId>${VIDEO}</yt:videoId>
    <title>Rick &amp; Astley — Never Gonna Give You Up</title>
    <published>2009-10-25T06:57:33+00:00</published>
    <author><name>Rick Astley</name></author>
    <link rel="alternate" href="https://evil.example/watch?v=${VIDEO}"/>
  </entry>
  <entry>
    <id>yt:video:short</id>
    <title>skip</title>
  </entry>
</feed>`;
  const parsed = feeds.parseYoutubeAtom(xml);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].videoId, VIDEO);
  assert.equal(parsed.entries[0].url, `https://www.youtube.com/watch?v=${VIDEO}`);
  assert.equal(parsed.entries[0].title, "Rick & Astley — Never Gonna Give You Up");
  assert.equal(parsed.entries[0].author, "Rick Astley");
});

test("Atom parser refuses oversized XML", () => {
  const huge = `<feed>${"<entry><yt:videoId>dQw4w9WgXcQ</yt:videoId></entry>".repeat(20000)}</feed>`;
  const parsed = feeds.parseYoutubeAtom(huge, { maxBytes: 1024 });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, "too_large");
  assert.deepEqual(parsed.entries, []);
});
