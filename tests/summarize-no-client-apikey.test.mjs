import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const core = require(path.join(repoRoot, "lib/local-summary-core.js"));

test("rejectClientApiKey blocks non-empty client apiKey", () => {
  assert.equal(core.rejectClientApiKey({}), null);
  assert.equal(core.rejectClientApiKey({ transcriptId: "x" }), null);
  assert.equal(core.rejectClientApiKey({ apiKey: "" }), null);
  assert.equal(core.rejectClientApiKey({ apiKey: "   " }), null);
  assert.match(core.rejectClientApiKey({ apiKey: "sk-attacker" }), /not allowed/i);
});

test("requestLocalSummary uses only the provided server key toward OpenRouter", async () => {
  let requestedUrl = "";
  let auth = "";
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    requestedUrl = String(url);
    auth = /** @type {Record<string,string>} */ (init?.headers).Authorization;
    return new Response(
      JSON.stringify({
        model: core.LOCAL_SUMMARY_MODEL,
        choices: [{ message: { content: "## Key points\n- Useful idea" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200 }
    );
  };

  const transcript = core.formatTranscriptForSummary([
    { startMs: 61000, durationMs: 1000, text: "Useful idea", speaker: "Ada" },
  ]);
  const result = await core.requestLocalSummary({
    apiKey: "server-key-only",
    title: "Example",
    transcript,
    fetchImpl,
  });

  assert.equal(requestedUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(auth, "Bearer server-key-only");
  assert.match(transcript, /\[01:01\] Ada: Useful idea/);
  assert.equal(result.summary, "## Key points\n- Useful idea");
});

test("forged client apiKey never reaches OpenRouter when gate fires", async () => {
  const blocked = core.rejectClientApiKey({
    provider: "openai",
    apiKey: "sk-forged-attacker-key",
  });
  assert.ok(blocked);
  let called = false;
  if (!blocked) {
    await core.requestLocalSummary({
      apiKey: "sk-forged-attacker-key",
      title: "x",
      transcript: "y",
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });
  }
  assert.equal(called, false);
});

test("summarize HTTP routes reject client apiKey and use server key helpers", () => {
  for (const rel of [
    "app/api/summaries/route.ts",
    "app/api/transcripts/[id]/summarize/route.ts",
  ]) {
    const src = readFileSync(path.join(repoRoot, rel), "utf8");
    assert.match(src, /rejectClientApiKey/);
    assert.match(src, /getOpenRouterKey/);
    assert.doesNotMatch(src, /callOpenAI|callAnthropic/);
    assert.doesNotMatch(
      src,
      /if \(!apiKey \|\| typeof apiKey !== "string"\)/
    );
  }
  const summaries = readFileSync(path.join(repoRoot, "app/api/summaries/route.ts"), "utf8");
  assert.match(summaries, /promptOverride:\s*promptOverride/);
  const summarizeCall = summaries.slice(summaries.indexOf("await summarize("), summaries.indexOf("await summarize(") + 400);
  assert.match(summarizeCall, /promptOverride/);
});

test("MCP summarize_transcript no longer accepts or forwards apiKey", () => {
  const src = readFileSync(
    path.join(repoRoot, "mcp-server/src/index.ts"),
    "utf8"
  );
  const toolStart = src.indexOf('"summarize_transcript"');
  assert.ok(toolStart > 0);
  const toolChunk = src.slice(toolStart, toolStart + 1200);
  assert.doesNotMatch(toolChunk, /apiKey:\s*z\./);
  assert.match(toolChunk, /\/api\/summaries/);
  assert.doesNotMatch(toolChunk, /JSON\.stringify\(\{\s*provider,\s*apiKey/);
});

test("LOCAL_SUMMARY_MODEL is pinned", () => {
  assert.equal(core.LOCAL_SUMMARY_MODEL, "google/gemini-2.5-flash-lite");
});
