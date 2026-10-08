import { test } from "node:test";
import assert from "node:assert/strict";

const { parseNotionId, chunkRichText, buildPageBody, saveVideoToNotion } =
  await import("../lib/notion-save.ts");

test("parseNotionId accepts UUID and Notion URLs", () => {
  assert.equal(
    parseNotionId("0123456789abcdef0123456789abcdef"),
    "01234567-89ab-cdef-0123-456789abcdef"
  );
  assert.equal(
    parseNotionId(
      "https://www.notion.so/workspace/0123456789abcdef0123456789abcdef?v=1"
    ),
    "01234567-89ab-cdef-0123-456789abcdef"
  );
  assert.equal(parseNotionId("not-an-id"), null);
});

test("chunkRichText stays at or under 2000 chars", () => {
  const chunks = chunkRichText("a".repeat(4500));
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((c) => c.length <= 2000));
});

test("buildPageBody puts summary then transcript and respects block limits", () => {
  const blocks = buildPageBody("short summary", "t".repeat(2500));
  assert.ok(blocks.length >= 3);
  assert.ok(
    blocks.every((b) => b.paragraph.rich_text[0].text.content.length <= 2000)
  );
});

test("saveVideoToNotion adds missing properties and creates a row (mock HTTP)", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes("/databases/") && init.method === "GET") {
      return {
        ok: true,
        json: async () => ({
          properties: { Name: { type: "title" } },
        }),
      };
    }
    if (url.includes("/databases/") && init.method === "PATCH") {
      return { ok: true, json: async () => ({ object: "database" }) };
    }
    if (url.endsWith("/pages") && init.method === "POST") {
      return { ok: true, json: async () => ({ id: "page-1" }) };
    }
    if (url.includes("/blocks/") && init.method === "PATCH") {
      return { ok: true, json: async () => ({ object: "list" }) };
    }
    return { ok: false, status: 404, json: async () => ({ message: "unexpected " + url }) };
  };

  const result = await saveVideoToNotion({
    token: "secret_test_token",
    databaseIdOrUrl: "0123456789abcdef0123456789abcdef",
    video: {
      title: "Video Title",
      author: "Channel Name",
      videoUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
      createdAt: "2026-10-07T00:00:00.000Z",
      baseSummary: "A summary",
      transcript: "word ".repeat(500),
    },
    fetchImpl,
  });
  assert.equal(result.pageId, "page-1");
  assert.equal(result.parentType, "database");

  const patchDb = calls.find(
    (c) => c.url.includes("/databases/") && c.method === "PATCH"
  );
  assert.ok(patchDb);
  assert.ok(patchDb.body.properties.Channel);
  assert.ok(patchDb.body.properties["Video URL"]);
  assert.ok(patchDb.body.properties.Published);
  assert.ok(patchDb.body.properties.Saved);

  const create = calls.find((c) => c.url.endsWith("/v1/pages"));
  assert.equal(create.body.parent.database_id, "01234567-89ab-cdef-0123-456789abcdef");
  assert.equal(create.body.properties.Name.title[0].text.content, "Video Title");
  assert.equal(create.body.properties.Channel.rich_text[0].text.content, "Channel Name");
  assert.equal(
    create.body.properties["Video URL"].url,
    "https://www.youtube.com/watch?v=aaaaaaaaaaa"
  );
  assert.ok(create.body.children.length <= 100);
  assert.equal(JSON.stringify(create.body).includes("secret_test_token"), false);
});

test("saveVideoToNotion falls back to a page parent when database GET fails", async () => {
  const fetchImpl = async (url, init) => {
    if (url.includes("/databases/") && init.method === "GET") {
      return { ok: false, status: 404, json: async () => ({ message: "not a database" }) };
    }
    if (url.endsWith("/pages")) {
      const body = JSON.parse(init.body);
      assert.equal(body.parent.page_id, "01234567-89ab-cdef-0123-456789abcdef");
      return { ok: true, json: async () => ({ id: "page-2" }) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const result = await saveVideoToNotion({
    token: "secret_test_token",
    databaseIdOrUrl: "0123456789abcdef0123456789abcdef",
    video: {
      title: "Page child",
      author: "Ch",
      videoUrl: "https://youtu.be/x",
      createdAt: new Date("2026-01-01"),
      transcript: "hi",
    },
    fetchImpl,
  });
  assert.equal(result.parentType, "page");
  assert.equal(result.pageId, "page-2");
});

test("long transcripts append extra block batches", async () => {
  let appends = 0;
  const fetchImpl = async (url, init) => {
    if (url.includes("/databases/") && init.method === "GET") {
      return {
        ok: true,
        json: async () => ({ properties: { Name: { type: "title" }, Channel: { type: "rich_text" }, "Video URL": { type: "url" }, Published: { type: "date" }, Saved: { type: "date" } } }),
      };
    }
    if (url.endsWith("/pages")) {
      const body = JSON.parse(init.body);
      assert.equal(body.children.length, 100);
      return { ok: true, json: async () => ({ id: "page-3" }) };
    }
    if (url.includes("/blocks/page-3/children")) {
      appends += 1;
      const body = JSON.parse(init.body);
      assert.ok(body.children.length <= 100);
      return { ok: true, json: async () => ({}) };
    }
    return { ok: false, status: 500, json: async () => ({ message: url }) };
  };
  await saveVideoToNotion({
    token: "secret_test_token",
    databaseIdOrUrl: "0123456789abcdef0123456789abcdef",
    video: {
      title: "Long",
      author: "Ch",
      videoUrl: "https://youtu.be/x",
      createdAt: "2026-10-07",
      transcript: "x".repeat(2000 * 120),
    },
    fetchImpl,
  });
  assert.ok(appends >= 1);
});
