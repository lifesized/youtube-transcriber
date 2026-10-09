import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createWatchSeen, FILE_NAME } = require(path.join(root, "electron/tusk/watch-seen.js"));

function withDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "tusk-seen-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("new videos are unpublished until markPosted, and survive reload", () => {
  withDir((dir) => {
    const seen = createWatchSeen({ stateDir: dir, now: () => 1000 });
    const fresh = seen.rememberVideos([
      { videoId: "dQw4w9WgXcQ", title: "Rick", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", published: "2009-10-25T00:00:00Z" },
      { videoId: "dQw4w9WgXcQ", title: "dup" },
      { videoId: "bad", title: "nope" },
    ]);
    assert.equal(fresh.length, 1);
    assert.equal(seen.unpublished().length, 1);
    assert.equal(seen.isPosted("dQw4w9WgXcQ"), false);
    seen.markPosted(["dQw4w9WgXcQ"]);
    assert.equal(seen.unpublished().length, 0);
    assert.equal(seen.isPosted("dQw4w9WgXcQ"), true);

    const again = createWatchSeen({ stateDir: dir });
    assert.equal(again.isPosted("dQw4w9WgXcQ"), true);
    assert.equal(again.unpublished().length, 0);
    const disk = readFileSync(path.join(dir, FILE_NAME), "utf8");
    assert.match(disk, /dQw4w9WgXcQ/);
    assert.equal((statSync(path.join(dir, FILE_NAME)).mode & 0o777), 0o600);
  });
});

test("corrupt seen file is moved aside and reseeds without a first-run flood", () => {
  withDir((dir) => {
    const notices = [];
    writeFileSync(path.join(dir, FILE_NAME), "{not json", "utf8");
    const seen = createWatchSeen({
      stateDir: dir,
      now: () => 77,
      onCorrupt: (info) => notices.push(info),
    });
    const state = seen.load();
    assert.equal(state.version, 1);
    assert.deepEqual(state.videos, {});
    assert.equal(seen.wasCorruptReseed(), true);
    assert.equal(notices[0].message.includes("reseeding"), true);
    assert.ok(require("node:fs").existsSync(path.join(dir, `${FILE_NAME}.corrupt-77`)));
    assert.equal(seen.unpublished().length, 0);
  });
});

test("clearDigestPause drops a persisted pause so a later load is not paused", () => {
  withDir((dir) => {
    const seen = createWatchSeen({ stateDir: dir });
    seen.pauseDigest("not_in_channel");
    assert.equal(seen.isDigestPaused(), true);
    assert.equal(seen.digestPauseReason(), "not_in_channel");
    seen.clearDigestPause();
    assert.equal(seen.isDigestPaused(), false);
    assert.equal(seen.digestPauseReason(), "");
    const again = createWatchSeen({ stateDir: dir });
    assert.equal(again.isDigestPaused(), false);
  });
});

test("feed meta stores etag for the next poll and strips CR/LF", () => {
  withDir((dir) => {
    const seen = createWatchSeen({ stateDir: dir, now: () => 50 });
    const url = "https://www.youtube.com/feeds/videos.xml?channel_id=UCuAXFkgsw1L7xaCfnd5JJOw";
    seen.setFeedMeta(url, { etag: '"v1"\r\nX-Injected: 1', lastModified: "Wed, 21 Oct 2015 07:28:00 GMT\n" });
    assert.equal(seen.getFeedMeta(url).etag.includes("\r"), false);
    assert.equal(seen.getFeedMeta(url).etag.includes("\n"), false);
    assert.equal(seen.getFeedMeta(url).lastModified.includes("\n"), false);
    assert.match(seen.getFeedMeta(url).etag, /v1/);
  });
});

test("getFeedMeta sanitizes a dirty etag that was already on disk", () => {
  withDir((dir) => {
    const url = "https://www.youtube.com/feeds/videos.xml?channel_id=UCuAXFkgsw1L7xaCfnd5JJOw";
    writeFileSync(
      path.join(dir, FILE_NAME),
      JSON.stringify({
        version: 1,
        videos: {},
        feeds: {
          [url]: { etag: '"v1"\r\nX-Injected: 1', lastModified: "Wed, 21 Oct 2015 07:28:00 GMT\n", polledAt: 9 },
        },
        lastDigestAt: 0,
        digestPaused: false,
        digestPauseReason: "",
      }),
      "utf8"
    );
    const seen = createWatchSeen({ stateDir: dir });
    const meta = seen.getFeedMeta(url);
    assert.equal(meta.etag.includes("\r"), false);
    assert.equal(meta.etag.includes("\n"), false);
    assert.equal(meta.lastModified.includes("\n"), false);
    assert.match(meta.etag, /v1/);
  });
});

test("load clamps attempts to 0-3 and rejects a bad nextAttemptAt", () => {
  withDir((dir) => {
    writeFileSync(
      path.join(dir, FILE_NAME),
      JSON.stringify({
        version: 1,
        videos: {
          dQw4w9WgXcQ: {
            postedAt: 0,
            attempts: -2,
            nextAttemptAt: "soon",
            title: "neg",
          },
          oHg5SJYRHA0: {
            postedAt: 0,
            attempts: "nope",
            nextAttemptAt: -99,
            title: "nan",
          },
        },
        feeds: {},
        lastDigestAt: 0,
        digestPaused: false,
        digestPauseReason: "",
      }),
      "utf8"
    );
    const seen = createWatchSeen({ stateDir: dir });
    assert.equal(seen.videoAttempts("dQw4w9WgXcQ"), 0);
    assert.equal(seen.load().videos.dQw4w9WgXcQ.nextAttemptAt, 0);
    assert.equal(seen.videoAttempts("oHg5SJYRHA0"), 0);
    assert.equal(seen.load().videos.oHg5SJYRHA0.nextAttemptAt, 0);
    assert.equal(seen.isPosted("dQw4w9WgXcQ"), false);
    assert.equal(seen.unpublished().length, 2);
  });
});

test("getCachedSummary rebuilds the watch URL from the video id", () => {
  withDir((dir) => {
    const seen = createWatchSeen({ stateDir: dir, now: () => 10 });
    seen.rememberVideos([
      { videoId: "dQw4w9WgXcQ", title: "Rick", url: "https://evil.example/watch?v=dQw4w9WgXcQ" },
    ]);
    seen.cacheSummary("dQw4w9WgXcQ", {
      title: "Rick",
      url: "https://evil.example/phish",
      summary: "cached",
    });
    const cached = seen.getCachedSummary("dQw4w9WgXcQ");
    assert.equal(cached.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(cached.summary, "cached");
  });
});

test("wasCorruptReseed clears after it is reported once", () => {
  withDir((dir) => {
    writeFileSync(path.join(dir, FILE_NAME), "{not json", "utf8");
    const seen = createWatchSeen({ stateDir: dir, now: () => 88 });
    assert.equal(seen.wasCorruptReseed(), true);
    seen.clearCorruptReseed();
    assert.equal(seen.wasCorruptReseed(), false);
  });
});
