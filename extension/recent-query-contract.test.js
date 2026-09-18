const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backgroundSource = fs.readFileSync(
  path.join(__dirname, "background.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(__dirname, "..", "app", "api", "transcripts", "route.ts"),
  "utf8"
);
const schemaSource = fs.readFileSync(
  path.join(__dirname, "..", "prisma", "schema.prisma"),
  "utf8"
);

test("extension requests only the transcript rows it needs", () => {
  assert.match(backgroundSource, /\/api\/transcripts\?limit=5/);
  assert.match(
    backgroundSource,
    /\/api\/transcripts\?videoId=\$\{encodeURIComponent\(videoId\)\}&limit=1/
  );
});

test("transcript list API supports bounded recent and video-id queries", () => {
  assert.match(routeSource, /searchParams\.get\("limit"\)/);
  assert.match(routeSource, /searchParams\.get\("videoId"\)/);
  assert.match(routeSource, /take:\s*limit/);
  assert.match(schemaSource, /@@index\(\[createdAt\]\)/);
});
