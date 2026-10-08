/**
 * LinkedIn URL parsing: lib/url-parser.ts (server) and extension/linkedin-url.js
 * (extension) must agree on every post, feed, activity and event URL.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const LinkedInUrl = require("../extension/linkedin-url.js");
const { parseContentUrl, extractLinkedInContentId } = await import("../lib/url-parser.ts");

const CASES = [
  // [url, contentId, pageKind]
  [
    "https://www.linkedin.com/posts/the-mathworks_2_what-is-mathworks-cloud-center-activity-7151241570371948544-4Gu7",
    "linkedin:7151241570371948544",
    "post",
  ],
  [
    "https://www.linkedin.com/posts/mishalkhawaja_sendinblueviews-toronto-digitalmarketing-ugcPost-6850898786781339649-mM20/?trk=public_post",
    "linkedin:6850898786781339649",
    "post",
  ],
  [
    "https://www.linkedin.com/feed/update/urn:li:activity:7016901149999955968/?utm_source=share&utm_medium=member_desktop",
    "linkedin:7016901149999955968",
    "post",
  ],
  [
    "https://www.linkedin.com/feed/update/urn%3Ali%3Aactivity%3A7016901149999955968/",
    "linkedin:7016901149999955968",
    "post",
  ],
  [
    "https://www.linkedin.com/feed/?highlightedUpdateUrn=urn%3Ali%3Aactivity%3A7151241570371948544",
    "linkedin:7151241570371948544",
    "post",
  ],
  ["https://www.linkedin.com/feed/", null, "feed"],
  ["https://www.linkedin.com/feed", null, "feed"],
  ["https://www.linkedin.com/in/jane-doe/recent-activity/all/", null, "feed"],
  ["https://www.linkedin.com/in/jane-doe/recent-activity/videos/", null, "feed"],
  ["https://www.linkedin.com/company/mathworks/posts/?feedView=videos", null, "feed"],
  [
    "https://www.linkedin.com/events/7512647010907250689/",
    "linkedin:event-7512647010907250689",
    "event",
  ],
  [
    "https://www.linkedin.com/events/7084656651378536448/comments/",
    "linkedin:event-7084656651378536448",
    "event",
  ],
  [
    "https://www.linkedin.com/events/27-02energyfreedombyenergyclub7295762520814874625/comments/",
    "linkedin:event-7295762520814874625",
    "event",
  ],
  ["https://linkedin.com/events/7512647010907250689", "linkedin:event-7512647010907250689", "event"],
  ["https://www.linkedin.com/events/", null, null],
  ["https://www.linkedin.com/in/jane-doe/", null, null],
  ["https://www.linkedin.com/jobs/view/4000000000/", null, null],
  ["https://www.linkedin.com.evil.example/posts/x-activity-7151241570371948544-4Gu7", null, null],
  ["https://notlinkedin.com/feed/update/urn:li:activity:7016901149999955968/", null, null],
  ["not a url", null, null],
];

test("server and extension derive the same LinkedIn content IDs", () => {
  for (const [url, contentId] of CASES) {
    assert.equal(extractLinkedInContentId(url), contentId, `server: ${url}`);
    assert.equal(LinkedInUrl.contentId(url), contentId, `extension: ${url}`);
  }
});

test("extension classifies LinkedIn posts, feed/activity pages and events", () => {
  for (const [url, , kind] of CASES) {
    assert.equal(LinkedInUrl.pageKind(url), kind, url);
  }
  assert.equal(LinkedInUrl.panelVideoId("https://www.linkedin.com/feed/"), "linkedin:feed");
  assert.equal(
    LinkedInUrl.panelVideoId("https://www.linkedin.com/events/7512647010907250689/"),
    "linkedin:event-7512647010907250689"
  );
  assert.equal(LinkedInUrl.panelVideoId("https://www.linkedin.com/jobs/"), null);
});

test("parseContentUrl routes LinkedIn posts and events to the linkedin platform", () => {
  const event = parseContentUrl("https://www.linkedin.com/events/7512647010907250689/");
  assert.equal(event.platform, "linkedin");
  assert.equal(event.contentId, "linkedin:event-7512647010907250689");

  const post = parseContentUrl(
    "https://www.linkedin.com/feed/update/urn:li:activity:7016901149999955968/"
  );
  assert.equal(post.platform, "linkedin");
  assert.equal(post.contentId, "linkedin:7016901149999955968");

  // A bare feed has no single post: stays on the generic path.
  assert.equal(parseContentUrl("https://www.linkedin.com/feed/").platform, "generic");
  assert.equal(parseContentUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ").platform, "youtube");
});

test("media CDN check accepts only https *.licdn.com", () => {
  assert.ok(LinkedInUrl.isMediaCdnUrl("https://dms.licdn.com/playlist/vid/v2/X/mp4-360p-30fp-crf28/Y/0/1?e=1&t=x"));
  assert.ok(!LinkedInUrl.isMediaCdnUrl("http://dms.licdn.com/playlist/vid/v2/X/mp4-360p/Y"));
  assert.ok(!LinkedInUrl.isMediaCdnUrl("https://dms.licdn.com.evil.example/x.mp4"));
  assert.ok(!LinkedInUrl.isMediaCdnUrl("https://evillicdn.com/x.mp4"));
  assert.ok(!LinkedInUrl.isMediaCdnUrl("https://user:pass@dms.licdn.com/x.mp4"));
  assert.ok(!LinkedInUrl.isMediaCdnUrl("blob:https://www.linkedin.com/abc"));
});

test("media CDN check rejects URLs that aren't already in URL-parser form", () => {
  for (const url of [
    "https://dms.licdn.com\\@127.0.0.1:8443/x.mp4",
    "https://dms.licdn\u3002com/x.mp4",
    "https://dms.\u217Cicdn.com/x.mp4",
    " https://dms.licdn.com/x.mp4",
    "https://dms.licdn.com/x.mp4 ",
  ]) {
    assert.ok(!LinkedInUrl.isMediaCdnUrl(url), JSON.stringify(url));
  }
  assert.ok(LinkedInUrl.isMediaCdnUrl("https://dms.licdn.com/x.mp4"));
});
