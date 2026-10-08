/**
 * LinkedIn content-script context detection against page fixtures
 * (tests/fixtures/linkedin), plus the background's validation of its reply
 * and the loopback request it builds.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures", "linkedin");

const LinkedIn = require("../extension/content-linkedin.js");
const sendUrl = require("../extension/send-url.js");
globalThis.buildLocalSendRequest = sendUrl.buildLocalSendRequest;
globalThis.buildTokenlessDevSendRequest = sendUrl.buildTokenlessDevSendRequest;
const capture = require("../extension/linkedin-capture.js");

const VIEWPORT = { width: 1200, height: 900 };
const EVENT_URL = "https://www.linkedin.com/events/7512647010907250689/";
const TOKEN = "t".repeat(64);

/** Parse a fixture; data-fixture-top / data-fixture-playing stand in for layout and playback. */
function loadFixture(name) {
  const { document } = parseHTML(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
  for (const video of document.querySelectorAll("video")) {
    placeVideo(video, Number(video.closest("[data-fixture-top]")?.getAttribute("data-fixture-top") ?? -10000));
    video.paused = video.getAttribute("data-fixture-playing") !== "true";
  }
  return document;
}

function placeVideo(video, top) {
  video.getBoundingClientRect = () => ({ top, bottom: top + 400, left: 0, right: 700 });
}

function find(doc, href, networkUrls = []) {
  return LinkedIn.findMedia(doc, href, networkUrls, VIEWPORT);
}

test("past event: takes the recording from page data, smallest progressive stream", () => {
  const result = find(loadFixture("event-past.html"), EVENT_URL);
  assert.equal(result.ok, true);
  assert.equal(result.pageUrl, EVENT_URL);
  assert.match(result.mediaUrl, /^https:\/\/dms\.licdn\.com\/playlist\/vid\/v2\/D4E10AQ_EVENT\/mp4-360p/);
  assert.match(result.mediaUrl, /t=FAKE_360_SIG$/);
  assert.equal(result.title, "Building local-first apps");
});

test("past event: slugged and /comments/ event URLs resolve the same recording", () => {
  const href = "https://www.linkedin.com/events/buildinglocal-firstapps7512647010907250689/comments/";
  const result = find(loadFixture("event-past.html"), href);
  assert.equal(result.ok, true);
  assert.match(result.mediaUrl, /FAKE_360_SIG/);
});

test("event page data for a different event is ignored (in-app navigation)", () => {
  const result = find(loadFixture("event-past.html"), "https://www.linkedin.com/events/7000000000000000001/");
  assert.deepEqual(result, { ok: false, reason: "reload" });
});

test("upcoming, live and recording-less events return clear reasons", () => {
  assert.deepEqual(find(loadFixture("event-upcoming.html"), EVENT_URL), { ok: false, reason: "event_upcoming" });
  assert.deepEqual(find(loadFixture("event-live.html"), EVENT_URL), { ok: false, reason: "event_live" });
  assert.deepEqual(find(loadFixture("event-no-recording.html"), EVENT_URL), {
    ok: false,
    reason: "event_no_recording",
  });
});

test("feed: picks the playing video's post, not the first one", () => {
  const result = find(loadFixture("feed.html"), "https://www.linkedin.com/feed/");
  assert.equal(result.ok, true);
  assert.equal(result.pageUrl, "https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000333/");
  assert.match(result.mediaUrl, /FAKE_333_SIG/);
  assert.equal(result.author, "Ben Playing");
  assert.equal(result.title, "How we cut our build time in half with three small changes.");
});

test("feed: with nothing playing, the most visible video wins", () => {
  const doc = loadFixture("feed.html");
  for (const video of doc.querySelectorAll("video")) video.paused = true;
  const result = find(doc, "https://www.linkedin.com/feed/");
  assert.equal(result.pageUrl, "https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000222/");
  assert.match(result.mediaUrl, /FAKE_222_SIG/);
});

test("feed: a MediaSource (blob:) video asks for the post page instead of guessing", () => {
  const doc = loadFixture("feed.html");
  const videos = doc.querySelectorAll("video");
  for (const video of videos) video.paused = true;
  const blobVideo = videos[videos.length - 1];
  placeVideo(blobVideo, 300);
  blobVideo.paused = false;
  assert.deepEqual(find(doc, "https://www.linkedin.com/feed/"), { ok: false, reason: "open_post" });
});

test("activity page uses feed detection", () => {
  const result = find(loadFixture("feed.html"), "https://www.linkedin.com/in/ben/recent-activity/videos/");
  assert.equal(result.pageUrl, "https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000333/");
});

test("highlighted feed post: the playing video's own post wins over the address bar", () => {
  const href = "https://www.linkedin.com/feed/?highlightedUpdateUrn=urn%3Ali%3Aactivity%3A7300000000000000222";
  const result = find(loadFixture("feed.html"), href);
  assert.equal(result.pageUrl, "https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000333/");
});

test("single post page: blob player falls back to the post's page data", () => {
  const href = "https://www.linkedin.com/posts/jane-doe_local-first-activity-7151241570371948544-4Gu7";
  const result = find(loadFixture("post-single.html"), href);
  assert.equal(result.ok, true);
  assert.equal(result.pageUrl, "https://www.linkedin.com/feed/update/urn:li:activity:7151241570371948544/");
  assert.match(result.mediaUrl, /FAKE_SINGLE_360_SIG/);
  assert.equal(result.author, "Jane Doe");
  assert.equal(result.title, "Local-first is back: why we moved our app off the cloud.");
});

test("single post after in-app navigation: post from its link, media from network entries", () => {
  const href = "https://www.linkedin.com/feed/update/urn:li:activity:7299999999999999999/";
  const progressive =
    "https://dms.licdn.com/playlist/vid/v2/D4E05AQ_SPA/mp4-360p-30fp-crf28/B4EZ_SPA/0/1759000000900?e=1760000000&v=beta&t=FAKE_SPA_SIG";
  const network = [
    "https://media.licdn.com/dms/image/v2/D4E05AQ_SPA/videocover-high/0/1?e=1&t=x",
    progressive,
    "https://dms.licdn.com/playlist/vid/v2/D4E05AQ_SPA/hls-720p-30fp/B4EZ_SPA/0/segment-12.ts?e=1&t=x",
    "https://static.licdn.com/aero-v1/sc/h/player.js",
  ];
  const result = find(loadFixture("post-spa.html"), href, network);
  assert.equal(result.ok, true);
  assert.equal(result.pageUrl, href);
  assert.equal(result.mediaUrl, progressive);
  assert.equal(result.author, "Raj Patel");

  assert.deepEqual(find(loadFixture("post-spa.html"), href, network.filter((url) => url !== progressive)), {
    ok: false,
    reason: "reload",
  });
});

test("LinkedIn pages without videos say so", () => {
  assert.deepEqual(find(loadFixture("event-no-recording.html"), "https://www.linkedin.com/jobs/"), {
    ok: false,
    reason: "no_video",
  });
});

test("network capture keeps only progressive files and HLS manifests on licdn.com", () => {
  assert.ok(LinkedIn.isNetworkMediaUrl("https://dms.licdn.com/playlist/vid/v2/X/mp4-720p-30fp-crf28/Y/0/1?e=1&t=x"));
  assert.ok(LinkedIn.isNetworkMediaUrl("https://dms.licdn.com/playlist/vid/v2/X/hls-master/Y/0/1.m3u8?e=1"));
  assert.ok(!LinkedIn.isNetworkMediaUrl("https://dms.licdn.com/playlist/vid/v2/X/hls-720p/Y/0/seg-1.ts"));
  assert.ok(!LinkedIn.isNetworkMediaUrl("https://media.licdn.com/dms/image/v2/X/mp4-cover/0/1"));
  assert.ok(!LinkedIn.isNetworkMediaUrl("https://cdn.example.com/video/mp4-720p/a.mp4"));
  assert.ok(!LinkedIn.isNetworkMediaUrl("http://dms.licdn.com/playlist/vid/v2/X/mp4-720p/Y"));
});

test("background rejects content-script replies it can't trust", () => {
  const good = {
    ok: true,
    pageUrl: EVENT_URL,
    mediaUrl: "https://dms.licdn.com/playlist/vid/v2/X/mp4-360p-30fp-crf28/Y/0/1?e=1&t=x",
    title: "  Building local-first apps  ",
    author: "",
  };
  assert.deepEqual(capture.parseLinkedInMedia(good), { ...good, title: "Building local-first apps" });
  assert.equal(capture.parseLinkedInMedia({ ...good, mediaUrl: "https://evil.example/a.mp4" }).reason, "reload");
  assert.equal(capture.parseLinkedInMedia({ ...good, pageUrl: "https://www.linkedin.com/feed/" }).reason, "reload");
  assert.equal(capture.parseLinkedInMedia({ ok: false, reason: "event_live" }).reason, "event_live");
  assert.equal(capture.parseLinkedInMedia({ ok: false, reason: "<b>server says</b>" }).reason, "reload");
  assert.equal(capture.parseLinkedInMedia(null).reason, "reload");
});

test("LinkedIn loopback request carries page URL + media URL, never the token", () => {
  const media = capture.parseLinkedInMedia({
    ok: true,
    pageUrl: EVENT_URL,
    mediaUrl: "https://dms.licdn.com/playlist/vid/v2/X/mp4-360p-30fp-crf28/Y/0/1?e=1&v=beta&t=sig",
    title: "Building local-first apps",
    author: "Transcriber Club",
  });
  const request = capture.buildLinkedInSendRequest(media, TOKEN, "http://127.0.0.1:19721");
  assert.equal(request.ok, true);
  assert.equal(request.url, "http://127.0.0.1:19721/api/transcripts");
  assert.equal(request.headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(JSON.parse(request.body), {
    url: EVENT_URL,
    mediaUrl: media.mediaUrl,
    title: "Building local-first apps",
    author: "Transcriber Club",
  });
  assert.ok(!request.body.includes(TOKEN));
  assert.equal(capture.buildLinkedInSendRequest(media, TOKEN, "https://cloud.example.com").ok, false);

  const tokenless = capture.buildLinkedInSendRequest(media, undefined, "http://127.0.0.1:19720");
  assert.equal(tokenless.ok, true);
  assert.equal(tokenless.url, "http://127.0.0.1:19720/api/transcripts");
  assert.equal(tokenless.headers.Authorization, undefined);
  assert.equal(JSON.parse(tokenless.body).mediaUrl, media.mediaUrl);
});

test("LinkedIn page send prefers the token and goes tokenless only to the dev server", async () => {
  const media = capture.parseLinkedInMedia({
    ok: true,
    pageUrl: EVENT_URL,
    mediaUrl: "https://dms.licdn.com/playlist/vid/v2/X/mp4-360p-30fp-crf28/Y/0/1?e=1&v=beta&t=sig",
  });
  const postUrl = "https://www.linkedin.com/feed/update/urn:li:activity:7016901149999955968/";
  globalThis.chrome = { tabs: { query: async () => [] } };
  const builders = {
    event: (token, apiBase) => capture.buildLinkedInSendRequest(media, token, apiBase),
    "post without its tab": (token, apiBase) => capture.prepareLinkedInSend(postUrl, token, apiBase),
  };
  for (const [name, build] of Object.entries(builders)) {
    for (const apiBase of ["http://127.0.0.1:19720", "http://127.0.0.1:19721"]) {
      const withToken = await build(TOKEN, apiBase);
      assert.equal(withToken.ok, true, `${name} ${apiBase}`);
      assert.equal(withToken.url, `${apiBase}/api/transcripts`);
      assert.equal(withToken.headers.Authorization, `Bearer ${TOKEN}`);
      assert.equal("credentials" in withToken, false);
    }
    const dev = await build(undefined, "http://127.0.0.1:19720");
    assert.equal(dev.ok, true, `${name}: dev without a token`);
    assert.equal(dev.url, "http://127.0.0.1:19720/api/transcripts");
    assert.equal(dev.headers.Authorization, undefined);
    assert.equal("credentials" in dev, false);
    for (const apiBase of ["http://127.0.0.1:19721", "https://cloud.example.com", undefined]) {
      assert.deepEqual(await build(undefined, apiBase), { ok: false }, `${name}: no token for ${apiBase}`);
      assert.deepEqual(await build(null, apiBase), { ok: false }, `${name}: null token for ${apiBase}`);
    }
  }
});

test("prepareLinkedInSend: asks the tab, injects the content script once if it isn't loaded", async () => {
  const sent = [];
  const injected = [];
  let replies = [null, { ok: true, pageUrl: EVENT_URL, mediaUrl: "https://dms.licdn.com/v/mp4-360p/a?t=s", title: "T" }];
  globalThis.chrome = {
    tabs: { query: async () => [{ id: 7, url: EVENT_URL, active: true }] },
    scripting: { executeScript: async (details) => injected.push(details) },
  };
  globalThis.sendMessageWithTimeout = async (tabId, message) => {
    sent.push({ tabId, message });
    return replies.shift();
  };

  const request = await capture.prepareLinkedInSend(EVENT_URL, TOKEN, "http://127.0.0.1:19720");
  assert.equal(request.ok, true);
  assert.equal(JSON.parse(request.body).mediaUrl, "https://dms.licdn.com/v/mp4-360p/a?t=s");
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], { tabId: 7, message: { type: "LINKEDIN_GET_MEDIA" } });
  assert.deepEqual(injected, [{ target: { tabId: 7 }, files: ["linkedin-url.js", "content-linkedin.js"] }]);

  replies = [{ ok: false, reason: "event_upcoming" }];
  assert.deepEqual(await capture.prepareLinkedInSend(EVENT_URL, TOKEN, "http://127.0.0.1:19720"), {
    ok: false,
    error: capture.LINKEDIN_ERRORS.event_upcoming,
  });
});

test("prepareLinkedInSend without the tab: posts go to the server, events need the tab", async () => {
  globalThis.chrome = { tabs: { query: async () => [] } };
  const postUrl = "https://www.linkedin.com/feed/update/urn:li:activity:7016901149999955968/";
  const post = await capture.prepareLinkedInSend(postUrl, TOKEN, "http://127.0.0.1:19720");
  assert.equal(post.ok, true);
  assert.deepEqual(JSON.parse(post.body), { url: postUrl });

  assert.deepEqual(await capture.prepareLinkedInSend(EVENT_URL, TOKEN, "http://127.0.0.1:19720"), {
    ok: false,
    error: capture.LINKEDIN_ERRORS.reload,
  });
});
