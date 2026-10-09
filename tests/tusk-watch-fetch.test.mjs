import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { fetchYoutubeFeed, resolveRedirect } = require(path.join(root, "electron/tusk/watch-fetch.js"));

const CHANNEL = "UCuAXFkgsw1L7xaCfnd5JJOw";
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`;
const VIDEO = "dQw4w9WgXcQ";
const ATOM = `<?xml version="1.0"?><feed><entry><yt:videoId>${VIDEO}</yt:videoId><title>Hi</title></entry></feed>`;

function fakeResponse({ status = 200, headers = {}, body = ATOM } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] ?? null;
      },
    },
    async arrayBuffer() {
      return Buffer.from(body, "utf8");
    },
    async text() {
      return body;
    },
  };
}

test("same-host videos.xml redirects are followed; other hosts are refused", () => {
  const ok = resolveRedirect(FEED, `/feeds/videos.xml?channel_id=${CHANNEL}`);
  assert.equal(ok.ok, true);
  assert.equal(ok.url, FEED);
  assert.equal(resolveRedirect(FEED, "https://evil.example/feeds/videos.xml?channel_id=" + CHANNEL).ok, false);
  assert.equal(resolveRedirect(FEED, "https://www.youtube.com/watch?v=" + VIDEO).ok, false);
});

test("fetchYoutubeFeed sends ETag / If-Modified-Since and treats 304 as not modified", async () => {
  const calls = [];
  const result = await fetchYoutubeFeed(FEED, {
    etag: '"abc"',
    lastModified: "Wed, 21 Oct 2015 07:28:00 GMT",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return fakeResponse({ status: 304 });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.notModified, true);
  assert.equal(calls[0].init.redirect, "manual");
  assert.ok(calls[0].init.signal, "fetch must time out");
  assert.equal(calls[0].init.headers["If-None-Match"], '"abc"');
  assert.equal(calls[0].init.headers["If-Modified-Since"], "Wed, 21 Oct 2015 07:28:00 GMT");
});

test("fetchYoutubeFeed parses Atom and rebuilds watch URLs", async () => {
  const result = await fetchYoutubeFeed(FEED, {
    fetchImpl: async () =>
      fakeResponse({
        headers: { etag: '"v1"', "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT" },
      }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.entries[0].url, `https://www.youtube.com/watch?v=${VIDEO}`);
  assert.equal(result.etag, '"v1"');
});

test("fetchYoutubeFeed refuses a body over the size cap", async () => {
  const result = await fetchYoutubeFeed(FEED, {
    maxBytes: 32,
    fetchImpl: async () => fakeResponse({ body: ATOM.repeat(20) }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "too_large");
});

test("fetchYoutubeFeed refuses a Content-Length over the size cap", async () => {
  const result = await fetchYoutubeFeed(FEED, {
    maxBytes: 32,
    fetchImpl: async () =>
      fakeResponse({
        headers: { "content-length": "999999" },
        body: ATOM,
      }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "too_large");
});

test("readCappedBody cancels a streaming reader past 512 KB", async () => {
  const { readCappedBody } = require(path.join(root, "electron/tusk/watch-fetch.js"));
  let cancelled = false;
  const chunk = Buffer.alloc(200 * 1024, 97);
  let reads = 0;
  const res = {
    headers: { get: () => null },
    body: {
      getReader() {
        return {
          async read() {
            reads += 1;
            if (reads > 4) return { done: true, value: undefined };
            return { done: false, value: chunk };
          },
          async cancel() {
            cancelled = true;
          },
          releaseLock() {},
        };
      },
    },
  };
  const result = await readCappedBody(res, 512 * 1024);
  assert.equal(result.ok, false);
  assert.equal(result.error, "too_large");
  assert.equal(cancelled, true);
});

test("fetchYoutubeFeed refuses a non-feed URL", async () => {
  const result = await fetchYoutubeFeed("https://www.youtube.com/watch?v=" + VIDEO, {
    fetchImpl: async () => {
      throw new Error("must not fetch");
    },
  });
  assert.equal(result.ok, false);
});
