"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  youtubeVideoId,
  findYouTubeTabByVideoId,
} = require("./youtube-video-id.js");

const VID = "dQw4w9WgXcQ";

test("youtubeVideoId reads watch, youtu.be, shorts, and embed", () => {
  assert.equal(youtubeVideoId(`https://www.youtube.com/watch?v=${VID}`), VID);
  assert.equal(youtubeVideoId(`https://youtube.com/watch?v=${VID}&t=12`), VID);
  assert.equal(youtubeVideoId(`https://m.youtube.com/watch?v=${VID}`), VID);
  assert.equal(youtubeVideoId(`https://youtu.be/${VID}`), VID);
  assert.equal(youtubeVideoId(`https://youtu.be/${VID}?t=90`), VID);
  assert.equal(youtubeVideoId(`https://www.youtube.com/shorts/${VID}`), VID);
  assert.equal(youtubeVideoId(`https://www.youtube.com/embed/${VID}`), VID);
  assert.equal(youtubeVideoId("https://www.youtube.com/feed/subscriptions"), null);
  assert.equal(youtubeVideoId("https://example.com/watch?v=" + VID), null);
});

test("findYouTubeTabByVideoId matches id, not exact URL", () => {
  const tabs = [
    { id: 1, url: `https://www.youtube.com/watch?v=${VID}&list=PLxx` },
    { id: 2, url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" },
    { id: 3, url: `https://youtu.be/${VID}` },
  ];
  const fromShare = findYouTubeTabByVideoId(
    tabs,
    `https://youtu.be/${VID}?si=abc`
  );
  assert.equal(fromShare && fromShare.id, 1);
  const fromWatch = findYouTubeTabByVideoId(
    tabs,
    `https://www.youtube.com/watch?v=${VID}`
  );
  assert.equal(fromWatch && fromWatch.id, 1);
  assert.equal(
    findYouTubeTabByVideoId(tabs, "https://www.youtube.com/watch?v=bbbbbbbbbbb"),
    null
  );
  assert.equal(findYouTubeTabByVideoId(tabs, "https://example.com/"), null);
});
