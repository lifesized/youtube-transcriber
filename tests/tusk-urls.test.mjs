import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const detect = require(path.join(root, "electron/tusk/detect.js"));
const { parseContentUrl, extractLinkedInContentId } = await import("../lib/url-parser.ts");
const { extractYouTubeUrlsFromSlackText } = await import("../lib/tusk/youtube.ts");

test("ported YouTube extractor matches the old Slack tests", () => {
  const canonical = [{ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ" }];
  assert.deepEqual(
    extractYouTubeUrlsFromSlackText("watch this https://www.youtube.com/watch?v=dQw4w9WgXcQ please"),
    canonical
  );
  assert.deepEqual(
    detect.extractYouTubeUrlsFromSlackText("<https://youtu.be/dQw4w9WgXcQ|youtu.be/dQw4w9WgXcQ>"),
    canonical
  );
  assert.deepEqual(
    detect.extractYouTubeUrlsFromSlackText(
      "https://example.com https://youtu.be/dQw4w9WgXcQ https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ),
    canonical
  );
  assert.deepEqual(
    extractYouTubeUrlsFromSlackText(
      "https://example.com https://youtu.be/dQw4w9WgXcQ https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ).map((u) => u.videoId),
    ["dQw4w9WgXcQ"]
  );
});

test("Slack mrkdwn uses only the target and decodes entities with &amp; last", () => {
  assert.deepEqual(
    detect.extractYouTubeUrlsFromSlackText("https://www.youtube.com/watch?share&amp;v=dQw4w9WgXcQ"),
    [{ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ" }]
  );
  assert.deepEqual(
    detect.extractSupportedSlackUrls("<https://evil.example|https://youtu.be/dQw4w9WgXcQ>"),
    []
  );
  assert.deepEqual(
    detect.extractSupportedSlackUrls("<https://youtu.be/dQw4w9WgXcQ|https://evil.example>").map(
      (h) => h.url
    ),
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"]
  );
});

test("supported Slack URLs go through existing validators; arbitrary URLs are ignored", () => {
  const yt = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const spotify = "https://open.spotify.com/episode/7makk4oTQel546B0P8BAVm";
  const linkedin =
    "https://www.linkedin.com/feed/update/urn:li:activity:7016901149999955968/";
  const evil = "https://example.com/watch?v=dQw4w9WgXcQ";
  const js = "javascript://www.linkedin.com/feed/update/urn:li:activity:7016901149999955968/";
  const userinfo = "https://user:pass@www.linkedin.com/feed/update/urn:li:activity:7016901149999955968/";

  const hits = detect.extractSupportedSlackUrls(
    `${yt} ${spotify} ${linkedin} ${evil} ${js} ${userinfo}`
  );
  assert.deepEqual(
    hits.map((h) => h.platform),
    ["youtube", "spotify", "linkedin"]
  );
  assert.equal(parseContentUrl(yt).platform, "youtube");
  assert.equal(parseContentUrl(spotify).platform, "spotify");
  assert.equal(parseContentUrl(linkedin).platform, "linkedin");
  assert.equal(parseContentUrl(linkedin).canonicalUrl, hits[2].canonicalUrl);
  assert.equal(extractLinkedInContentId(js), null);
  assert.equal(extractLinkedInContentId(userinfo), null);
  assert.equal(detect.classifySupportedUrl(evil), null);
  assert.equal(detect.classifySupportedUrl(js), null);
  assert.equal(detect.classifySupportedUrl(userinfo), null);
  assert.equal(detect.classifySupportedUrl("https://www.linkedin.com/feed/"), null);
});
