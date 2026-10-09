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

test("corrupt seen file is refused so a digest is not posted blindly", () => {
  withDir((dir) => {
    writeFileSync(path.join(dir, FILE_NAME), "{not json", "utf8");
    const seen = createWatchSeen({ stateDir: dir });
    assert.throws(() => seen.load(), /corrupt/);
  });
});

test("feed meta stores etag for the next poll", () => {
  withDir((dir) => {
    const seen = createWatchSeen({ stateDir: dir, now: () => 50 });
    const url = "https://www.youtube.com/feeds/videos.xml?channel_id=UCuAXFkgsw1L7xaCfnd5JJOw";
    seen.setFeedMeta(url, { etag: '"v1"', lastModified: "Wed, 21 Oct 2015 07:28:00 GMT" });
    assert.equal(seen.getFeedMeta(url).etag, '"v1"');
  });
});
