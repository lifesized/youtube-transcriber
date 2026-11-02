const test = require("node:test");
const assert = require("node:assert/strict");
const { extractPageContentId } = require("./page-id.js");

const VIDEO_PODCAST_ID = "2Cc8LDSoGmgL8sBkt4hSlt";

test("extractPageContentId detects Spotify video-podcast episode URLs", () => {
  const urls = [
    `https://open.spotify.com/episode/${VIDEO_PODCAST_ID}`,
    `https://open.spotify.com/episode/${VIDEO_PODCAST_ID}?si=abc`,
    `https://open.spotify.com/intl-en/episode/${VIDEO_PODCAST_ID}`,
    `https://open.spotify.com/intl-pt-br/episode/${VIDEO_PODCAST_ID}?si=x`,
    `https://open.spotify.com/embed/episode/${VIDEO_PODCAST_ID}`,
  ];
  for (const url of urls) {
    assert.equal(extractPageContentId(url), VIDEO_PODCAST_ID, url);
  }
});

test("extractPageContentId ignores Spotify show/home pages", () => {
  assert.equal(extractPageContentId("https://open.spotify.com/show/46hnFSg40wwEBFZvnUHHJ5"), null);
  assert.equal(extractPageContentId("https://open.spotify.com/"), null);
});

test("popup.js delegates page ID detection to page-id.js", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const popup = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "popup.html"), "utf8");
  assert.match(popup, /extractPageContentId/);
  assert.match(html, /page-id\.js/);
});
