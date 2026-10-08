import { test } from "node:test";
import assert from "node:assert/strict";

test("callLlmProvider posts to Anthropic with mock HTTP", async () => {
  const { callLlmProvider } = await import("../lib/llm-provider.ts");
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(url);
    const body = JSON.parse(init.body);
    assert.equal(body.model, "claude-sonnet-4-5");
    assert.ok(Array.isArray(body.messages));
    return {
      ok: true,
      json: async () => ({ content: [{ text: "Anthropic summary" }] }),
    };
  };
  const text = await callLlmProvider({
    provider: "anthropic",
    apiKey: "sk-ant-test",
    title: "Talk",
    transcriptText: "hello world",
    fetchImpl,
  });
  assert.equal(text, "Anthropic summary");
  assert.equal(urls[0], "https://api.anthropic.com/v1/messages");
});

test("callLlmProvider posts to OpenAI with mock HTTP", async () => {
  const { callLlmProvider } = await import("../lib/llm-provider.ts");
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(url);
    const body = JSON.parse(init.body);
    assert.equal(body.model, "gpt-4o-mini");
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "OpenAI summary" } }],
      }),
    };
  };
  const text = await callLlmProvider({
    provider: "openai",
    apiKey: "sk-test",
    title: "Talk",
    transcriptText: "hello world",
    fetchImpl,
  });
  assert.equal(text, "OpenAI summary");
  assert.equal(urls[0], "https://api.openai.com/v1/chat/completions");
});
