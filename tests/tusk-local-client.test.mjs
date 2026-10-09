import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createLocalClient } = require(path.join(root, "electron/tusk/local-client.js"));

function clientWithCapture() {
  const calls = [];
  const client = createLocalClient({
    port: 19720,
    token: "test-token",
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        method: init.method,
        body: init.body ? JSON.parse(init.body) : null,
      });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, id: "vid-1" }),
      };
    },
  });
  return { client, calls };
}

test("Tusk local client tags transcript and summary requests with a job id", async () => {
  const { client, calls } = clientWithCapture();
  await client.createTranscript("https://youtu.be/dQw4w9WgXcQ", { jobId: "tusk-job-01" });
  await client.createSummary("vid-1", { jobId: "tusk-job-01", promptOverride: "summarize" });
  assert.equal(calls[0].body.jobId, "tusk-job-01");
  assert.equal(calls[0].body.jobTag, "tusk");
  assert.equal(calls[1].body.jobId, "tusk-job-01");
  assert.equal(calls[1].body.jobTag, "tusk");
  assert.equal(calls[1].body.promptOverride, "summarize");
});

test("Tusk cancel posts a job id, or tag=tusk for stop()", async () => {
  const { client, calls } = clientWithCapture();
  await client.cancelInFlight({ jobId: "tusk-job-01", tag: "tusk" });
  await client.cancelInFlight({ tag: "tusk" });
  assert.match(calls[0].url, /\/api\/jobs\/cancel$/);
  assert.deepEqual(calls[0].body, { jobId: "tusk-job-01", tag: "tusk" });
  assert.deepEqual(calls[1].body, { tag: "tusk" });
});
