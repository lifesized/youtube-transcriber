import assert from "node:assert/strict";
import test from "node:test";

const { authTest, postSlackThreadReply, addSlackReaction } = await import(
  "../lib/tusk/web-api.ts"
);

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("auth.test and reactions.add post to Slack without extra fields", async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (String(url).includes("auth.test")) {
      return jsonResponse({ ok: true, team: "Personal", user: "tusk" });
    }
    return jsonResponse({ ok: true });
  };
  try {
    const auth = await authTest("xoxb-token");
    assert.equal(auth.ok, true);
    await addSlackReaction({
      botToken: "xoxb-token",
      channel: "C123",
      timestamp: "1.2",
      name: "eyes",
    });
    await postSlackThreadReply({
      botToken: "xoxb-token",
      channel: "C123",
      threadTs: "1.1",
      text: "summary",
    });
    assert.equal(calls[0].url, "https://slack.com/api/auth.test");
    assert.equal(calls[1].url, "https://slack.com/api/reactions.add");
    assert.equal(calls[2].url, "https://slack.com/api/chat.postMessage");
  } finally {
    globalThis.fetch = original;
  }
});

test("refuses a file upload_url that is not https://files.slack.com", async () => {
  const { uploadSlackThreadFile } = await import("../lib/tusk/web-api.ts");
  const original = globalThis.fetch;
  const uploads = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("files.getUploadURLExternal")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          upload_url: "https://evil.example/upload",
          file_id: "F1",
        }),
      };
    }
    uploads.push(String(url));
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  try {
    const result = await uploadSlackThreadFile({
      botToken: "xoxb-token",
      channel: "C123",
      threadTs: "1.1",
      filename: "t.txt",
      title: "t",
      content: "hi",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_upload_url");
    assert.deepEqual(uploads, []);
  } finally {
    globalThis.fetch = original;
  }
});
