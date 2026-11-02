import assert from "node:assert/strict";
import test from "node:test";
import { extractSpotifyEpisodeId, parseContentUrl } from "../lib/url-parser.js";

const VIDEO_PODCAST_ID = "2Cc8LDSoGmgL8sBkt4hSlt";

const SPOTIFY_URLS = [
  `https://open.spotify.com/episode/${VIDEO_PODCAST_ID}`,
  `https://open.spotify.com/episode/${VIDEO_PODCAST_ID}/`,
  `https://open.spotify.com/episode/${VIDEO_PODCAST_ID}?si=abc123`,
  `https://open.spotify.com/intl-en/episode/${VIDEO_PODCAST_ID}`,
  `https://open.spotify.com/intl-en/episode/${VIDEO_PODCAST_ID}?si=share`,
  `https://open.spotify.com/intl-de/episode/${VIDEO_PODCAST_ID}`,
  `https://open.spotify.com/intl-pt-br/episode/${VIDEO_PODCAST_ID}`,
  `https://open.spotify.com/embed/episode/${VIDEO_PODCAST_ID}`,
  `https://open.spotify.com/embed-podcast/episode/${VIDEO_PODCAST_ID}`,
];

test("extractSpotifyEpisodeId reads video-podcast episode URLs including intl and query strings", () => {
  for (const url of SPOTIFY_URLS) {
    assert.equal(
      extractSpotifyEpisodeId(url),
      VIDEO_PODCAST_ID,
      `failed for ${url}`
    );
  }
});

test("parseContentUrl routes Spotify episode URLs to the spotify platform, not generic yt-dlp", () => {
  for (const url of SPOTIFY_URLS) {
    const parsed = parseContentUrl(url);
    assert.equal(parsed.platform, "spotify", `platform for ${url}`);
    assert.equal(parsed.contentId, VIDEO_PODCAST_ID, `id for ${url}`);
    assert.equal(parsed.originalUrl, url);
  }
});

test("parseContentUrl rejects Spotify show/home URLs instead of sending them to yt-dlp", () => {
  assert.throws(
    () => parseContentUrl("https://open.spotify.com/show/46hnFSg40wwEBFZvnUHHJ5"),
    /episode/i
  );
  assert.throws(
    () => parseContentUrl("https://open.spotify.com/"),
    /episode/i
  );
});
