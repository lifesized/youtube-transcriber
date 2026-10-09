import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createPipeline } = require(path.join(root, "electron/tusk/pipeline.js"));
const { createJobGate } = require(path.join(root, "electron/tusk/jobs.js"));
const { COPY, classifyLocalFailure } = require(path.join(root, "electron/tusk/errors.js"));
const { LocalApiError } = require(path.join(root, "electron/tusk/local-client.js"));

const BOT = "xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUv";
const VIDEO = {
  id: "vid-1",
  videoId: "dQw4w9WgXcQ",
  title: "Demo",
  transcript: JSON.stringify([{ text: "hello from ci", startMs: 0, durationMs: 1500 }]),
  videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
};

function event(extra = {}) {
  return {
    channel: "C01234567",
    ts: "1710000000.000100",
    threadTs: "1710000000.000100",
    text: extra.text || "https://youtu.be/dQw4w9WgXcQ",
    urls: extra.urls || [
      {
        platform: "youtube",
        contentId: "dQw4w9WgXcQ",
        videoId: "dQw4w9WgXcQ",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
    ],
    ...extra,
  };
}

function mocks(localOverrides = {}, slackOverrides = {}) {
  const slack = {
    calls: [],
    addReaction: async (args) => {
      slack.calls.push(["reaction", args]);
      return { ok: true };
    },
    postMessage: async (args) => {
      slack.calls.push(["post", args]);
      return { ok: true, ts: "1710000000.000200" };
    },
    updateMessage: async (args) => {
      slack.calls.push(["update", args]);
      return { ok: true, ts: args.ts };
    },
    uploadThreadFile: async (args) => {
      slack.calls.push(["upload", args]);
      return { ok: true };
    },
    ...slackOverrides,
  };
  const local = {
    createTranscript: async () => VIDEO,
    createSummary: async () => ({
      summary_md: "*✦ Summary*\nAdds Slack OAuth support.",
      cached: false,
    }),
    ...localOverrides,
  };
  const pipeline = createPipeline({ slackApi: slack, localClient: local, botToken: BOT });
  return { slack, local, pipeline };
}

function stages(slack) {
  return slack.calls
    .filter(([kind]) => kind === "post" || kind === "update")
    .map(([, args]) => args.text);
}

test("local calls are only transcribe and summarize with the rebuilt URL", async () => {
  const urls = [];
  const { slack, pipeline } = mocks({
    createTranscript: async (url) => {
      urls.push(url);
      return VIDEO;
    },
  });
  await pipeline.handleSupportedLink(
    event({
      urls: [
        {
          platform: "youtube",
          contentId: "dQw4w9WgXcQ",
          videoId: "dQw4w9WgXcQ",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        },
      ],
    })
  );
  assert.deepEqual(urls, ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"]);
  assert.equal(
    slack.calls.every(([, args]) => !args.channel || args.channel === "C01234567"),
    true
  );
  assert.equal(
    slack.calls
      .filter(([kind]) => kind === "post")
      .every(([, args]) => args.threadTs === "1710000000.000100"),
    true
  );
});

test("happy path: eyes, progress card updates, then formatted summary", async () => {
  const { slack, pipeline } = mocks();
  const result = await pipeline.handleSupportedLink(event());
  assert.equal(result.ok, true);
  assert.equal(result.mode, "summary");
  assert.equal(slack.calls[0][0], "reaction");
  assert.equal(slack.calls[0][1].name, "eyes");
  const texts = stages(slack);
  assert.match(texts[0], /Queued/);
  assert.match(texts[1], /checking captions/i);
  assert.match(texts[2], /Summarizing/i);
  const last = slack.calls[slack.calls.length - 1];
  assert.equal(last[0], "update");
  assert.match(last[1].text, /✦ Summary/);
  assert.match(last[1].text, /Demo/);
  assert.equal(JSON.stringify(slack.calls).includes(BOT), true);
});

test("cache hit still renders and reports cached", async () => {
  const { pipeline } = mocks({
    createSummary: async () => ({
      summary_md: "*✦ Summary*\nCached notes.",
      cached: true,
    }),
  });
  const result = await pipeline.handleSupportedLink(event());
  assert.equal(result.ok, true);
  assert.equal(result.cached, true);
});

test("no LLM configured uploads the transcript and shows the setup hint", async () => {
  const { slack, pipeline } = mocks({
    createSummary: async () => {
      throw new LocalApiError({
        status: 503,
        message: "No OpenRouter or Anthropic API key configured for summaries",
      });
    },
  });
  const result = await pipeline.handleSupportedLink(event());
  assert.equal(result.reason, "no_llm");
  const upload = slack.calls.find(([kind]) => kind === "upload");
  assert.ok(upload);
  assert.match(upload[1].content, /hello from ci/);
  assert.match(upload[1].content, /\[0:00\]/);
  const last = slack.calls.filter(([kind]) => kind === "update").pop();
  assert.match(last[1].text, /Settings › Summaries/);
  assert.equal(last[1].text.includes(BOT), false);
});

test("hostile video titles are escaped in the Slack file comment", async () => {
  const hostile = "<!channel> <@Uevil> <https://evil.example|Click>";
  const { slack, pipeline } = mocks({
    createTranscript: async () => ({ ...VIDEO, title: hostile }),
  });
  const result = await pipeline.handleSupportedLink(
    event({ text: "transcript https://youtu.be/dQw4w9WgXcQ" })
  );
  assert.equal(result.mode, "transcript");
  const upload = slack.calls.find(([kind]) => kind === "upload");
  assert.ok(upload);
  assert.equal(upload[1].initialComment.includes("<!channel>"), false);
  assert.equal(upload[1].initialComment.includes("<@Uevil>"), false);
  assert.equal(upload[1].initialComment.includes("<https://evil.example|Click>"), false);
  assert.match(upload[1].initialComment, /&lt;!channel&gt;/);
  assert.match(upload[1].initialComment, /&lt;@Uevil&gt;/);
});

test("failure detail is escaped before it is posted to Slack", async () => {
  const { slack, pipeline } = mocks({
    createTranscript: async () => {
      throw new LocalApiError({
        status: 422,
        message: "<!channel> captions <https://evil.example|no>",
      });
    },
  });
  await pipeline.handleSupportedLink(event());
  const last = slack.calls.filter((c) => c[0] === "update" || c[0] === "post").pop();
  assert.equal(last[1].text.includes("<!channel>"), false);
  assert.equal(last[1].text.includes("<https://evil.example|no>"), false);
});

test("transcript-file mode uploads via getUploadURLExternal helper", async () => {
  const { slack, local, pipeline } = mocks();
  let summarized = false;
  local.createSummary = async () => {
    summarized = true;
    return { summary_md: "nope" };
  };
  const result = await pipeline.handleSupportedLink(
    event({ text: "transcript https://youtu.be/dQw4w9WgXcQ" })
  );
  assert.equal(result.mode, "transcript");
  assert.equal(summarized, false);
  assert.ok(slack.calls.some(([kind]) => kind === "upload"));
});

test("error mapping for local API failures", async () => {
  const cases = [
    [new LocalApiError({ message: "fetch failed", code: "ECONNREFUSED" }), "unreachable"],
    [Object.assign(new Error("Refusing to call"), { code: "LOCAL_AUTH_REQUIRED" }), "unauthorized"],
    [new LocalApiError({ status: 401, message: "Unauthorized" }), "unauthorized"],
    [new LocalApiError({ status: 404, message: "Captions are disabled" }), "no_captions"],
    [new LocalApiError({ status: 413, message: "too long" }), "too_long"],
    [new LocalApiError({ status: 429, message: "rate-limiting requests" }), "rate_limit"],
  ];
  for (const [err, code] of cases) {
    assert.equal(classifyLocalFailure(err).code, code, code);
    const { slack, pipeline } = mocks({
      createTranscript: async () => {
        throw err;
      },
    });
    const result = await pipeline.handleSupportedLink(event());
    assert.equal(result.ok, false);
    assert.equal(result.error, code);
    const last = slack.calls.filter((c) => c[0] === "update" || c[0] === "post").pop();
    assert.ok(last[1].text);
    assert.equal(last[1].text.includes("at Object"), false);
    assert.equal(last[1].text.includes(BOT), false);
  }
});

test("error copy never includes tokens or stacks", () => {
  const err = new LocalApiError({
    status: 500,
    message: `Bearer ${BOT} exploded\n    at pipeline.js:1`,
  });
  const mapped = classifyLocalFailure(err);
  assert.equal(mapped.message.includes(BOT), false);
  assert.equal(mapped.message.includes("pipeline.js"), false);
  assert.equal(mapped.message, COPY.generic);
});

test("thread Q&A answers only from the thread's own transcript id", async () => {
  const summaryIds = [];
  const { slack, pipeline } = mocks({
    createSummary: async (id) => {
      summaryIds.push(id);
      return { summary_md: "*✦ Summary*\nThe decision was to ship Tusk.\n<script>" };
    },
  });
  await pipeline.handleSupportedLink(event());
  const qa = await pipeline.handleThreadQuestion({
    channel: "C01234567",
    ts: "1710000000.000300",
    threadTs: "1710000000.000100",
    text: "<@Ubot> what was the decision?",
    botUserId: "Ubot",
  });
  assert.equal(qa.ok, true);
  assert.deepEqual(summaryIds, ["vid-1", "vid-1"]);
  const last = slack.calls.filter(([kind]) => kind === "post").pop();
  assert.equal(last[1].channel, "C01234567");
  assert.equal(last[1].threadTs, "1710000000.000100");
  assert.match(last[1].text, /decision was to ship Tusk/);
  assert.match(last[1].text, /&lt;script&gt;/);
});

test("thread Q&A without a remembered video does not call the local API", async () => {
  let summarized = false;
  const { slack, pipeline } = mocks({
    createSummary: async () => {
      summarized = true;
      return { summary_md: "nope" };
    },
  });
  const result = await pipeline.handleThreadQuestion({
    channel: "C01234567",
    threadTs: "1710000000.000100",
    text: "<@Ubot> what happened?",
    botUserId: "Ubot",
  });
  assert.equal(result.skipped, "no_thread_video");
  assert.equal(summarized, false);
  const last = slack.calls.filter(([kind]) => kind === "post").pop();
  assert.match(last[1].text, /Paste a supported link first/);
});

test("real slack-api.js sends Bearer botToken, hands off ts, and throws on ok:false", async () => {
  const slackApi = require(path.join(root, "electron/tusk/slack-api.js"));
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const path = String(url);
    if (path.includes("chat.postMessage")) {
      return { ok: true, status: 200, json: async () => ({ ok: true, ts: "1710000000.000200" }) };
    }
    if (path.includes("chat.update")) {
      const body = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ ok: true, ts: body.ts }) };
    }
    if (path.includes("reactions.add")) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  try {
    const pipeline = createPipeline({
      slackApi,
      localClient: {
        createTranscript: async () => VIDEO,
        createSummary: async () => ({
          summary_md: "*✦ Summary*\nAdds Slack OAuth support.",
          cached: false,
        }),
      },
      botToken: BOT,
    });
    const result = await pipeline.handleSupportedLink(event());
    assert.equal(result.ok, true);
    const posted = calls.find((c) => c.url.includes("chat.postMessage"));
    assert.ok(posted);
    assert.equal(posted.init.headers.Authorization, `Bearer ${BOT}`);
    assert.equal(posted.init.headers.Authorization.includes("undefined"), false);
    const updated = calls.filter((c) => c.url.includes("chat.update"));
    assert.ok(updated.length >= 1);
    for (const call of updated) {
      assert.equal(call.init.headers.Authorization, `Bearer ${BOT}`);
      assert.equal(JSON.parse(call.init.body).ts, "1710000000.000200");
    }

    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, error: "invalid_auth" }),
    });
    await assert.rejects(
      () => slackApi.postMessage({ botToken: BOT, channel: "C01234567", text: "hi" }),
      (err) => err && err.slackError === "invalid_auth"
    );
    await assert.rejects(
      () => slackApi.updateMessage({ botToken: BOT, channel: "C01234567", ts: "1.2", text: "hi" }),
      (err) => err && err.slackError === "invalid_auth"
    );
    await assert.rejects(
      () =>
        slackApi.uploadThreadFile({
          botToken: BOT,
          channel: "C01234567",
          threadTs: "1.1",
          filename: "t.txt",
          title: "t",
          content: "hi",
        }),
      (err) => err && err.slackError === "invalid_auth"
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("job gate dedupes one in-flight job per message and caps concurrency at 2", async () => {
  const gate = createJobGate({ concurrency: 2, timeoutMs: 5_000 });
  let started = 0;
  let maxRunning = 0;
  let running = 0;
  const work = (ms) => async () => {
    started += 1;
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await delay(ms);
    running -= 1;
    return started;
  };
  const a = gate.run("C1:1", work(40));
  const a2 = gate.run("C1:1", work(40));
  const b = gate.run("C1:2", work(40));
  const c = gate.run("C1:3", work(10));
  const [ra, ra2, rb] = await Promise.all([a, a2, b]);
  assert.equal(ra2.skipped, "deduped");
  await c;
  assert.equal(started, 3);
  assert.ok(maxRunning <= 2);
  assert.equal(typeof rb, "number");
});
